# Phase 4: Advanced GPU Pipeline Research Synthesis

**Date**: 2026-01-26
**Goal**: Comprehensive findings for progressive rendering, mipmap refinement, GPU profiling, and interaction-aware rendering

---

## Executive Summary

Research completed across 5 major areas with 18 parallel research agents analyzing both online resources and the Literoom codebase. Key findings:

| Optimization | Expected Impact | Feasibility | Priority |
|-------------|-----------------|-------------|----------|
| **Progressive Rendering** | Responsive UI during editing | HIGH | HIGH |
| **Mipmap-Based Refinement** | Faster initial preview | HIGH | MEDIUM |
| **GPU Timestamp Profiling** | Accurate performance data | HIGH | MEDIUM |
| **Interaction-Aware Rendering** | Smart quality switching | HIGH | HIGH |
| **Memory Management** | Stable performance | MEDIUM | MEDIUM |

---

## 1. Progressive Rendering

### Professional Editor Approaches

#### Adobe Lightroom
- **Tiered preview system**: Minimal → Embedded → Standard → 1:1 previews
- **Smart Previews**: 2540px lossy DNG proxies (~50x compression)
- **Camera Raw Cache**: Caches demosaiced data (5-20GB recommended)
- **Negative Cache**: ~4 images in RAM for instant switching
- **GPU acceleration**: Since Camera Raw 11.4 for slider responsiveness

#### Capture One
- **CPU-based preview generation** with GPU for display
- **Draft rendering during slider drag** (temporary blur ~0.5s)
- **Sequential processing pipeline** with defined stage order
- **Background preloading** of adjacent images

#### DaVinci Resolve
- **Proxy media system**: Independent portable files at 1/2, 1/4, 1/8, 1/16 resolution
- **Timeline Proxy Mode**: On-the-fly resolution reduction (no file creation)
- **RAW debayer quality**: Full, Half, Quarter, Eighth settings
- **Smart Cache**: Auto-renders during 5 seconds of inactivity
- **Performance Mode**: Hardware-adaptive quality adjustment

### Web-Based Approaches

#### Figma (WebGPU)
- **Tile-based rendering** with viewport culling
- **Progressive image loading**: Low-quality for off-screen
- **Batched GPU operations**: Upload uniforms for multiple draw calls
- **Chunked processing**: Split large operations
- **Local edit prioritization**: Instant feel for user actions

#### Canva
- **CSS transforms over JavaScript** for GPU acceleration
- **requestAnimationFrame** for DOM synchronization
- **ThorVG for Lottie**: 80% faster, 70% more efficient

### Implementation Recommendations

**Multi-Resolution Strategy**:
```
INSTANT (50-100ms):
├─ 1/4 resolution decoding
├─ Skip histogram/clipping
└─ Quick JPEG encode

DRAFT (150-300ms):
├─ 1/2 resolution
├─ Basic adjustments + tone curve
└─ Skip expensive mask processing

FULL (500-1000ms):
├─ Full resolution
├─ All adjustments + masks
└─ High-quality output
```

**Progressive Refinement State Machine**:
```
idle → [user input] → interacting
                      → [33ms throttle] → draft render
                      → [no input 400ms] → refining
                                          → full render
                                          → complete → idle
```

---

## 2. Mipmap-Based Refinement

### WebGPU Mipmap Generation

**Key Insight**: WebGPU has NO built-in `generateMipmap()` like WebGL. Must implement manually.

**Memory Overhead**: Mipmaps add exactly **33%** to texture size.

**Generation Approaches**:

1. **Render Pipeline** (simpler):
   - Use bilinear filtering to downsample
   - Good for small textures
   - `webgpu-utils` library provides ready implementation

2. **Compute Shader** (faster for large textures):
   - 29-50% faster for 4K+ textures
   - Can generate multiple mip levels per pass
   - Use workgroup shared memory for cascade

**Recommended Compute Shader Pattern**:
```wgsl
@compute @workgroup_size(8, 8)
fn computeMipMap(@builtin(global_invocation_id) id: vec3<u32>) {
    let offset = vec2<u32>(0, 1);
    let color = (
        textureLoad(previousMipLevel, 2 * id.xy + offset.xx, 0) +
        textureLoad(previousMipLevel, 2 * id.xy + offset.xy, 0) +
        textureLoad(previousMipLevel, 2 * id.xy + offset.yx, 0) +
        textureLoad(previousMipLevel, 2 * id.xy + offset.yy, 0)
    ) * 0.25;
    textureStore(nextMipLevel, id.xy, color);
}
```

**LOD Selection for Photo Editing**:
- Use explicit LOD based on zoom level: `textureSampleLevel(tex, sampler, uv, lodLevel)`
- At 50% zoom → LOD 1 (half resolution)
- At 25% zoom → LOD 2 (quarter resolution)

### Texture Streaming from Game Development

**Unreal Engine Approach**:
- Priority by texel-to-pixel ratio and visibility
- Load order: Visible → Forced → Landscape → Characters
- Drop order: Non-visible → Least-recently-viewed

**Virtual Texturing (Future Consideration)**:
- WebGPU doesn't support sparse textures yet (gpuweb #455)
- Software implementation possible: tile pool + indirection texture
- Far Cry 4: 10km × 10km at 10 texels/cm in 220MB VRAM

---

## 3. GPU Timestamp Profiling

### WebGPU Timestamp Query API

**Feature Detection**:
```javascript
const canTimestamp = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({
  requiredFeatures: canTimestamp ? ['timestamp-query'] : [],
});
```

**Modern Pattern** (timestampWrites in pass descriptor):
```javascript
const pass = encoder.beginComputePass({
  timestampWrites: {
    querySet,
    beginningOfPassWriteIndex: 0,
    endOfPassWriteIndex: 1,
  },
});
```

**Reading Results**:
```javascript
// Resolve to buffer
encoder.resolveQuerySet(querySet, 0, 2, resolveBuffer, 0);
encoder.copyBufferToBuffer(resolveBuffer, 0, resultBuffer, 0, 16);

// Read asynchronously (use BigUint64Array for nanoseconds)
await resultBuffer.mapAsync(GPUMapMode.READ);
const times = new BigUint64Array(resultBuffer.getMappedRange());
const durationMs = Number(times[1] - times[0]) / 1_000_000;
```

**Important Limitations**:
- Default 100μs quantization (security)
- Enable `chrome://flags/#enable-webgpu-developer-features` for full precision
- Results are implementation-defined (debugging only)
- Cannot compare across different GPUs

### Profiling Tools

**Browser Extensions**:
- **WebGPU Inspector**: Frame capture, live shader editing, buffer inspection
- **webgpu-devtools**: Object tracking, command history

**npm Packages**:
- **stats-gl**: FPS/CPU/GPU monitoring with timestamp queries
- **webgpu-utils**: Helper library reducing boilerplate
- **webgpu-memory**: Track GPU memory usage

**Native Profilers** (for deep analysis):
- PIX (Windows): Full GPU profiling with Chrome
- RenderDoc (Windows, D3D12 only)
- Xcode Metal Debugger (macOS)

---

## 4. Interaction-Aware Rendering

### Current Literoom Implementation Analysis

**Slider Detection**: Vue deep watchers on `editStore.adjustments`
**Throttle**: 150ms (too slow - research recommends 33ms)
**Draft Mode**: UI-only flag, no actual quality reduction

### Latency Requirements

| Interaction | Target Latency | Source |
|-------------|---------------|--------|
| Dragging | <33ms | Research studies |
| Tapping | <82ms | Research studies |
| Touch | <25ms | Mobile guidelines |
| Mouse | <60ms | RAIL model |
| Animation frame | <16ms | 60fps target |

**Key Insight**: Current 150ms = ~6-7 FPS, which feels sluggish.

### Timing Recommendations

| Pattern | Use Case | Timing |
|---------|----------|--------|
| **Throttle** | Real-time slider preview | 33-50ms |
| **Debounce** | Final quality render | 300-500ms |
| **requestAnimationFrame** | Visual updates | 16ms (sync with display) |
| **scheduler.postTask** | Background processing | Priority-based |

### Smooth Quality Transitions

**Dithering + TAA**: Industry standard for LOD transitions
- Blend both quality levels using screen-space dithering
- TAA temporally accumulates for smooth appearance
- Essentially no overdraw cost

**Easing Functions**:
- **ease-out** for draft-to-quality (fast start, slow reveal)
- **Smoothstep**: `t * t * (3 - 2 * t)` for natural interpolation
- **Transition time**: 0.3-0.5 seconds

**Ping-Pong Framebuffers**:
- Two identical framebuffers alternating roles
- One provides previous state, other receives new state
- Essential for progressive refinement feedback loops

---

## 5. Memory Management

### GPU Memory Detection

**Challenge**: WebGPU doesn't expose direct memory queries.

**Available Mechanisms**:
1. **Error scopes for OOM**:
   ```javascript
   device.pushErrorScope('out-of-memory');
   const texture = device.createTexture({...});
   const error = await device.popErrorScope();
   ```

2. **webgpu-memory library**: Tracks allocations via interception

3. **Device loss events**: May indicate memory pressure

### Memory Budgets by Device Tier

| Tier | GPU Score | Recommended Budget |
|------|-----------|-------------------|
| 0 | <15 fps | Fallback (no WebGPU) |
| 1 | ≥15 fps | 64-128 MB |
| 2 | ≥30 fps | 256-512 MB |
| 3 | ≥60 fps | 512 MB - 1 GB |

**Detection**: Use `@pmndrs/detect-gpu` library for tier classification.

### LRU Cache for Textures

```javascript
class TextureLRUCache {
  private cache = new Map<string, GPUTexture>()

  get(key: string): GPUTexture | null {
    const texture = this.cache.get(key)
    if (!texture) return null
    // Move to end (most recently used)
    this.cache.delete(key)
    this.cache.set(key, texture)
    return texture
  }

  evict() {
    const firstKey = this.cache.keys().next().value
    const evicted = this.cache.get(firstKey)
    evicted?.destroy() // Explicit GPU cleanup
    this.cache.delete(firstKey)
  }
}
```

### Visible Region Prioritization

**Intersection Observer**: Async visibility detection without scroll listeners
**Quadtree/R-Tree**: O(log N) viewport queries vs O(N) linear scan
**Priority Queue**: Center-outward spiral pattern for loading

---

## 6. Idle Detection for Refinement

### requestIdleCallback

**Key Insight**: Maximum 50ms deadline per the specification.

**Limitations**:
- No Safari support (polyfill available)
- Unpredictable scheduling during heavy loads
- Cannot safely modify DOM directly

**Pattern**:
```javascript
function refineProgressively(deadline) {
  while (deadline.timeRemaining() > 5 && pendingWork.length > 0) {
    const work = pendingWork.shift();
    work();
  }
  if (pendingWork.length > 0) {
    requestIdleCallback(refineProgressively);
  }
}
```

### scheduler.postTask() (Modern Alternative)

**Browser Support**: ~82% (Chrome 94+, Firefox 142+, no Safari)

**Priority Levels**:
- `user-blocking`: Critical user interactions
- `user-visible`: Non-essential UI updates
- `background`: Analytics, prefetching (similar to requestIdleCallback)

**Dynamic Priority**:
```javascript
const controller = new TaskController({ priority: 'background' });
scheduler.postTask(renderThumbnail, { signal: controller.signal });

// Elevate priority when image enters viewport
controller.setPriority('user-visible');
```

---

## 7. Implementation Roadmap

### Phase 4A: Interaction-Aware Rendering (1-2 days)

1. **Reduce throttle**: 150ms → 33ms for draft renders
2. **Add debounce**: 400ms for full-quality render after interaction
3. **Implement activity detection**: Track mouse/touch state
4. **Quality indicator**: Show actual render state (not cosmetic)

### Phase 4B: Progressive Refinement (2-3 days)

1. **State machine**: idle → interacting → refining → complete
2. **Resolution downsampling**: 1/2 res for draft, full for final
3. **Operation skipping**: Skip histogram/clipping in draft mode
4. **Smooth transitions**: Crossfade between quality levels

### Phase 4C: GPU Profiling Infrastructure (1-2 days)

1. **TimingHelper class**: Wrap timestamp queries
2. **Performance dashboard**: Show GPU/CPU timing
3. **Profile storage**: Save timing data for analysis
4. **Bottleneck detection**: Identify slow operations

### Phase 4D: Memory Management (2-3 days)

1. **Texture LRU cache**: Implement eviction with destroy()
2. **Device tier detection**: Adapt memory budget
3. **Error scope monitoring**: Detect and handle OOM
4. **Viewport-aware loading**: Prioritize visible content

---

## 8. Expected Performance Gains

| Optimization | Current | After | Improvement |
|-------------|---------|-------|-------------|
| **Slider responsiveness** | 150ms | 33ms | 4.5x faster |
| **Draft render time** | 40-147ms | 8-23ms | ~85% reduction |
| **FPS during drag** | 6-7 | 30-60 | 5-10x faster |
| **Memory efficiency** | No eviction | LRU eviction | Stable performance |
| **Quality transition** | Instant pop | 0.3-0.5s fade | Smoother UX |

---

## 9. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Timestamp queries not supported | Feature detection + fallback to CPU timing |
| Safari no scheduler.postTask | Polyfill or requestIdleCallback fallback |
| Memory pressure undetected | Error scopes + proactive eviction |
| Quality transition artifacts | TAA/dithering + easing functions |
| Device tier misclassification | Conservative defaults, manual override |

---

## References

### Codebase Files Analyzed
- `/apps/web/app/composables/useEditPreview.ts`
- `/packages/core/src/catalog/thumbnail-service.ts`
- `/packages/core/src/catalog/thumbnail-cache.ts`
- `/apps/web/app/components/edit/EditAdjustmentSlider.vue`

### Key Online Sources
- Adobe Lightroom Performance Documentation
- Figma Engineering Blog (WebGPU Rendering)
- WebGPU Fundamentals (Timing, Mipmaps)
- MDN (requestIdleCallback, scheduler.postTask)
- Chrome Developers (RAIL Model, scheduler.yield)
- Game Development (Unreal/Unity Texture Streaming)
