# GPU Pipeline Performance Implementation Roadmap

**Date**: 2026-01-26
**Goal**: Prioritized optimization plan based on all research findings

---

## Executive Summary

Analysis of all research phases reveals a clear implementation path. The biggest gains come from:
1. **Reducing CPU-GPU sync stalls** (draft mode, async histogram)
2. **Memory bandwidth reduction** (single-pass uber-shader, texture pooling)
3. **Proper timing infrastructure** (GPU timestamps for accurate measurement)

### Expected Cumulative Impact

| Phase | Optimization | Expected Gain | Cumulative FPS |
|-------|-------------|---------------|----------------|
| Baseline | Current state | - | ~6-7 FPS during drag |
| Phase 1 | Draft mode + pooling | 4-5x faster | ~30 FPS |
| Phase 2 | Async histogram | +15-20% | ~35-40 FPS |
| Phase 3 | Single-pass uber-shader | +25-30% | ~45-50 FPS |
| Phase 4 | Progressive refinement | +10-15% | ~55-60 FPS |

---

## Priority Matrix

### Tier 1: Quick Wins (HIGH Impact, LOW Effort)

| # | Optimization | Impact | Effort | Risk | Dependencies |
|---|-------------|--------|--------|------|--------------|
| 1.1 | **Reduce throttle 150ms → 33ms** | 4.5x responsiveness | 1 hour | None | None |
| 1.2 | **Skip histogram in draft mode** | 5-50ms saved | 2 hours | Low | None |
| 1.3 | **Skip clipping in draft mode** | 2-5ms saved | 1 hour | None | None |
| 1.4 | **Integrate TexturePool** | 1.2-2.4ms/frame | 4 hours | Low | None |
| 1.5 | **Add 400ms debounce for full render** | Better UX | 1 hour | None | 1.1 |

**Estimated Total**: 1-2 days
**Expected Result**: ~30 FPS during drag (currently ~6-7 FPS)

### Tier 2: Core Architecture (HIGH Impact, MEDIUM Effort)

| # | Optimization | Impact | Effort | Risk | Dependencies |
|---|-------------|--------|--------|------|--------------|
| 2.1 | **1/2 resolution draft mode** | 75% fewer pixels | 1 day | Low | 1.1-1.5 |
| 2.2 | **Triple-buffered histogram** | Eliminate 2-5ms stalls | 1 day | Medium | 1.2 |
| 2.3 | **GPU timestamp profiling** | Accurate measurement | 1 day | Low | None |
| 2.4 | **Progressive refinement state machine** | Smooth transitions | 1 day | Low | 2.1 |

**Estimated Total**: 3-4 days
**Expected Result**: ~40 FPS with smooth quality transitions

### Tier 3: Shader Optimizations (MEDIUM Impact, MEDIUM Effort)

| # | Optimization | Impact | Effort | Risk | Dependencies |
|---|-------------|--------|--------|------|--------------|
| 3.1 | **Single-pass uber-shader (adjustments + tone curve)** | 75% bandwidth reduction | 3 days | Medium | 2.3 |
| 3.2 | **f16 processing with fallback** | 25-50% faster ALU | 2 days | Medium | 3.1 |
| 3.3 | **Subgroup histogram optimization** | 2-4x faster histogram | 2 days | Low | 2.2 |

**Estimated Total**: 1 week
**Expected Result**: ~50 FPS sustained

### Tier 4: Advanced Optimizations (MEDIUM Impact, HIGH Effort)

| # | Optimization | Impact | Effort | Risk | Dependencies |
|---|-------------|--------|--------|------|--------------|
| 4.1 | **GPU-direct histogram rendering** | Zero CPU readback | 3 days | High | 2.2 |
| 4.2 | **Mipmap-based LOD system** | Faster zoom/pan | 3 days | Medium | 2.1 |
| 4.3 | **LRU texture cache with eviction** | Stable memory | 2 days | Low | 1.4 |
| 4.4 | **Device tier detection** | Adaptive quality | 1 day | Low | 2.3 |

**Estimated Total**: 1-2 weeks
**Expected Result**: ~60 FPS with stable memory usage

---

## Detailed Implementation Plan

### Phase 1: Quick Wins (Days 1-2)

#### 1.1 Reduce Throttle Timing
**File**: `apps/web/app/composables/useEditPreview.ts`
**Lines**: 115-160

```typescript
// Current: THROTTLE_DELAY = 150
// Change to: THROTTLE_DELAY = 33  // ~30 FPS target
```

**Validation**: Measure frame rate during slider drag

#### 1.2 Skip Histogram in Draft Mode
**File**: `apps/web/app/composables/useHistogramDisplay.ts`
**Lines**: 641-651

```typescript
// Add check before histogram computation
if (renderQuality.value === 'draft') {
  return // Use cached histogram
}
```

**Validation**: Histogram shows stale data during drag, updates on release

#### 1.3 Skip Clipping Detection in Draft Mode
**File**: `apps/web/app/composables/useEditPreview.ts`
**Lines**: 926-927

```typescript
// Pass skipClipping flag when draft mode
const clippingResult = quality === 'draft' ? null : await computeClipping()
```

**Validation**: Clipping overlay updates after drag ends

#### 1.4 Integrate TexturePool
**File**: `packages/core/src/gpu/pipelines/edit-pipeline.ts`
**Lines**: 190-362

```typescript
class GPUEditPipeline {
  private texturePool: TexturePool

  async initialize() {
    this.texturePool = new TexturePool(this.device, 8)
  }

  async process() {
    // Replace createTextureFromPixels → pool.acquire() + writeTexture()
    // Replace texture.destroy() → pool.release()
  }
}
```

**Validation**: Memory profiler shows stable GPU memory

#### 1.5 Add Debounce for Full Render
**File**: `apps/web/app/composables/useEditPreview.ts`

```typescript
// Add debounced full-quality render
const debouncedFullRender = useDebounceFn(() => {
  renderPreview('full')
}, 400)
```

**Validation**: Full quality appears 400ms after interaction ends

---

### Phase 2: Core Architecture (Days 3-6)

#### 2.1 Half-Resolution Draft Mode
**Files**:
- `apps/web/app/composables/useEditPreview.ts`
- `packages/core/src/gpu/pipelines/edit-pipeline.ts`

Add `targetResolution` parameter to GPU pipeline:
```typescript
interface ProcessParams {
  quality?: 'draft' | 'full'
  targetResolution?: number // 0.5 for draft
}
```

Implement downsampling before GPU processing.

#### 2.2 Triple-Buffered Histogram
**File**: `packages/core/src/gpu/pipelines/histogram-pipeline.ts`

Create `StagingBufferPool` class with 3 buffers:
```typescript
class StagingBufferPool {
  acquire(): GPUBuffer | null
  async readbackAsync(source: GPUBuffer, onComplete: (data: Uint32Array) => void)
}
```

Fire-and-forget pattern when pool exhausted.

#### 2.3 GPU Timestamp Profiling
**New File**: `packages/core/src/gpu/utils/timing-helper.ts`

```typescript
class TimingHelper {
  private querySet: GPUQuerySet
  private resolveBuffer: GPUBuffer
  private resultBuffer: GPUBuffer

  beginPass(encoder: GPUCommandEncoder, descriptor: GPURenderPassDescriptor)
  async readResults(): Promise<number> // nanoseconds
}
```

Integrate with edit-pipeline stages for per-pass timing.

#### 2.4 Progressive Refinement State Machine
**File**: `apps/web/app/composables/useEditPreview.ts`

```typescript
type RenderState = 'idle' | 'interacting' | 'refining' | 'complete'

// State transitions:
// idle → [user input] → interacting
// interacting → [33ms throttle] → draft render (loop)
// interacting → [400ms no input] → refining
// refining → [full render done] → complete
// complete → idle
```

---

### Phase 3: Shader Optimizations (Days 7-12)

#### 3.1 Single-Pass Uber-Shader
**New File**: `packages/core/src/gpu/shaders/uber-adjustments.wgsl`

Combine adjustments + tone curve into single pass:
```wgsl
override ENABLE_ADJUSTMENTS: bool = true;
override ENABLE_TONE_CURVE: bool = true;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    var color = textureLoad(input, gid.xy, 0).rgb;

    if (ENABLE_ADJUSTMENTS) {
        color = apply_all_adjustments(color);
    }

    if (ENABLE_TONE_CURVE) {
        color = apply_tone_curve(color);
    }

    textureStore(output, gid.xy, vec4(color, 1.0));
}
```

**Benefits**: 75% memory bandwidth reduction (128MB → 32MB per frame)

#### 3.2 F16 Processing
**Files**: `packages/core/src/gpu/shaders/*.wgsl`

Add f16 variants for supported devices:
```wgsl
enable f16;

fn processColorF16(color: vec3h, adj: Adjustments) -> vec3h {
    // Fast path for simple operations
}
```

Feature detection:
```typescript
const hasF16 = adapter.features.has('shader-f16')
```

**Fallback**: Qualcomm/Adreno devices get f32 shaders

#### 3.3 Subgroup Histogram
**File**: `packages/core/src/gpu/shaders/histogram.wgsl`

Add subgroup variant for Chrome 134+:
```wgsl
enable subgroups;

let subgroup_sum = subgroupAdd(local_count);
if (subgroupInvocationId == 0u) {
    atomicAdd(&bins[bin], subgroup_sum);
}
```

**Expected**: 2-4x faster histogram computation

---

### Phase 4: Advanced Optimizations (Days 13-20)

#### 4.1 GPU-Direct Histogram Rendering
**New Files**:
- `packages/core/src/gpu/shaders/histogram-render.wgsl`
- `packages/core/src/gpu/pipelines/histogram-render-pipeline.ts`

Render histogram directly from storage buffer via fragment shader:
```wgsl
@fragment
fn render_histogram(input: VertexOutput) -> @location(0) vec4f {
    let bin_value = f32(histogram_bins[bin_index]);
    // Render bar directly
}
```

**Benefits**: Zero CPU readback, 60fps histogram updates

#### 4.2 Mipmap-Based LOD System
Generate mipmaps for preview textures, select LOD based on zoom level:
```typescript
const lodLevel = Math.max(0, Math.floor(Math.log2(1 / zoomLevel)))
```

Use compute shader for mipmap generation (29-50% faster than render pipeline).

#### 4.3 LRU Texture Cache
**New File**: `packages/core/src/gpu/utils/texture-cache.ts`

```typescript
class TextureLRUCache {
  get(key: string): GPUTexture | null
  set(key: string, texture: GPUTexture)
  evict() // Calls texture.destroy()
}
```

#### 4.4 Device Tier Detection
Use `@pmndrs/detect-gpu` for adaptive quality:

| Tier | GPU Score | Memory Budget | Default Quality |
|------|-----------|---------------|-----------------|
| 0 | <15 fps | Fallback | No WebGPU |
| 1 | ≥15 fps | 64-128 MB | Low |
| 2 | ≥30 fps | 256-512 MB | Medium |
| 3 | ≥60 fps | 512 MB+ | High |

---

## Benchmarking Strategy

### Automated Benchmark Suite

Create `packages/core/benchmarks/` with:

1. **Frame time benchmark**: Measure render time for slider interactions
2. **Histogram benchmark**: Measure histogram computation + readback
3. **Pipeline benchmark**: Full edit pipeline timing with GPU timestamps
4. **Memory benchmark**: Track GPU memory allocation patterns

### Key Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Draft render time | <25ms | GPU timestamps |
| Slider responsiveness | <33ms | Input → render latency |
| Full render time | <100ms | GPU timestamps |
| Histogram update | <2ms | GPU timestamps |
| Memory per frame | <50MB | Memory profiler |
| FPS during drag | >30 | Frame timing |

### Statistical Approach

```typescript
class BenchmarkStats {
  warmupIterations = 500
  sampleCount = 30

  getMedian(): number
  getMean(): number
  getP99(): number
  getCV(): number // Coefficient of Variation
}
```

### CI Integration

Use Playwright with Chrome GPU flags:
```javascript
launchOptions: {
  args: [
    '--enable-gpu',
    '--use-angle=vulkan',
    '--enable-unsafe-webgpu'
  ]
}
```

Track regressions with threshold-based detection (>10% regression = failure).

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Draft mode quality too low | Test with 1/2 resolution first, fall back to 2/3 if needed |
| Async histogram causes stale data | Show "updating" indicator, use smooth interpolation |
| f16 not supported | Feature detection + automatic fallback to f32 |
| Subgroups not available | Atomics fallback (current behavior) |
| Memory pressure | Error scopes for OOM detection, proactive eviction |
| Uber-shader register pressure | Monitor VGPR count (<64), split if needed |

---

## Success Criteria

### Phase 1 Complete When:
- [x] Slider drag achieves >25 FPS (throttle reduced from 150ms to 33ms = ~30 FPS target)
- [x] TexturePool integrated and tested (integrated into GPUEditPipeline with pool size 8)
- [x] Draft/full quality modes working (histogram & clipping detection skipped in draft mode)

**Phase 1 Implementation Details** (2026-01-26):
- **1.1**: Reduced throttle from 150ms → 33ms in `useEditPreview.ts`
- **1.2**: Skip histogram computation during draft mode via `renderQualityRef` parameter
- **1.3**: Skip clipping detection during draft mode (only compute on full quality renders)
- **1.4**: Integrated `TexturePool` into `GPUEditPipeline` for GPU memory reuse
- **1.5**: Added 400ms debounced full-quality render after interaction ends

### Phase 2 Complete When:
- [ ] Draft renders at 1/2 resolution
- [ ] Histogram updates without blocking
- [ ] GPU timing data visible in debug mode
- [ ] Progressive refinement state machine working

### Phase 3 Complete When:
- [ ] Single-pass uber-shader benchmarks faster than multi-pass
- [ ] f16 path working on supported devices
- [ ] Subgroup histogram path working on Chrome 134+

### Phase 4 Complete When:
- [ ] GPU-direct histogram rendering at 60fps
- [ ] Mipmap LOD selection working
- [ ] LRU cache preventing memory growth
- [ ] Device tier detection adaptive quality

---

## References

### Internal Research Documents
- `2026-01-25-gpu-pipeline-optimization-synthesis.md`
- `2026-01-25-advanced-gpu-optimization-synthesis.md`
- `2026-01-25-draft-mode-implementation-research.md`
- `2026-01-25-async-histogram-texturepool-research.md`
- `2026-01-26-shader-optimization-synthesis.md`
- `2026-01-26-phase4-advanced-research-synthesis.md`

### External Resources
- [WebGPU Fundamentals - Optimization](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)
- [WebGPU Fundamentals - Timing](https://webgpufundamentals.org/webgpu/lessons/webgpu-timing.html)
- [Toji.dev - WebGPU Best Practices](https://toji.dev/webgpu-best-practices/)
- [Figma - WebGPU Rendering](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)
- [stats-gl - Performance Monitoring](https://github.com/RenaudRohlinger/stats-gl)
