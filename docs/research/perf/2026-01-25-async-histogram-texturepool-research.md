# Async Histogram & TexturePool Integration Research

**Date**: 2026-01-25
**Research Areas**: 2, 3, 4 from Implementation Plan
**Goal**: Complete implementation research for triple-buffered histogram, GPU-direct histogram rendering, and TexturePool integration

---

## Executive Summary

This research provides complete implementation details for three HIGH-priority optimizations that together can eliminate GPU-CPU synchronization stalls and reduce per-frame allocations.

### Key Findings Summary

| Research Area | Current State | Optimization | Expected Impact |
|---------------|---------------|--------------|-----------------|
| Triple-Buffered Histogram | Blocking mapAsync (2-5ms stall) | 3-buffer staging pool | Eliminate stalls |
| GPU-Direct Histogram | Full CPU readback (4KB) | Fragment shader visualization | Zero readback |
| TexturePool Integration | Per-frame allocation (240MB) | Pool reuse | ~80% reduction |

---

## Research Area 2: Triple-Buffered Histogram

### Current Implementation Analysis

**File**: `packages/core/src/gpu/pipelines/histogram-pipeline.ts`

**Current Pattern** (lines 186-212):
```typescript
// Creates NEW staging buffer every frame
const stagingBuffer = this.device.createBuffer({
  size: 4096, // 4 channels × 256 bins × 4 bytes
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
})

// BLOCKING readback - stalls main thread
await stagingBuffer.mapAsync(GPUMapMode.READ)
const resultData = new Uint32Array(stagingBuffer.getMappedRange()).slice()
stagingBuffer.unmap()
stagingBuffer.destroy()
```

**Issues**:
1. Creates new staging buffer per histogram computation
2. Synchronous blocking on `mapAsync()` (2-5ms stall)
3. Destroys buffer immediately after use
4. No buffer reuse across frames

### Optimal Pool Size: 3 Buffers (Triple-Buffering)

**Why 3 is optimal** (from Metal/Vulkan best practices):
- Command buffer transaction time (CPU→GPU handoff) causes stalls with only 2 buffers
- Third buffer allows GPU to process frame N while CPU prepares frame N+2
- Provides sweet spot between memory overhead and latency

**Tradeoffs**:
| Pool Size | Memory | Latency | GPU Stalls |
|-----------|--------|---------|------------|
| 2 buffers | 8KB | Minimal | Frequent |
| 3 buffers | 12KB | +1 frame | Rare |
| 4 buffers | 16KB | +2 frames | Very rare |

### Implementation: StagingBufferPool Class

```typescript
class StagingBufferPool {
  private device: GPUDevice
  private bufferSize: number
  private available: GPUBuffer[] = []
  private inFlight: Map<GPUBuffer, Promise<void>> = new Map()

  constructor(device: GPUDevice, bufferSize: number, poolSize: number = 3) {
    this.device = device
    this.bufferSize = bufferSize
    // Pre-allocate pool
    for (let i = 0; i < poolSize; i++) {
      this.available.push(this.createStagingBuffer())
    }
  }

  private createStagingBuffer(): GPUBuffer {
    return this.device.createBuffer({
      size: this.bufferSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })
  }

  acquire(): GPUBuffer | null {
    // Check mapState before returning
    for (let i = this.available.length - 1; i >= 0; i--) {
      if (this.available[i].mapState === 'unmapped') {
        return this.available.splice(i, 1)[0]
      }
    }
    return null // Pool exhausted
  }

  // Fire-and-forget pattern
  async readbackAsync(
    sourceBuffer: GPUBuffer,
    onComplete: (data: Uint32Array) => void
  ): Promise<void> {
    const staging = this.acquire()

    if (!staging) {
      // Pool exhausted - skip this readback, use previous frame's data
      return
    }

    const encoder = this.device.createCommandEncoder()
    encoder.copyBufferToBuffer(sourceBuffer, 0, staging, 0, this.bufferSize)
    this.device.queue.submit([encoder.finish()])

    // Non-blocking - process asynchronously
    staging.mapAsync(GPUMapMode.READ).then(() => {
      const data = new Uint32Array(staging.getMappedRange()).slice()
      staging.unmap()
      this.available.push(staging) // Return to pool
      onComplete(data)
    })
  }

  clear(): void {
    for (const buffer of this.available) {
      buffer.destroy()
    }
    this.available = []
  }
}
```

### Fire-and-Forget Pattern

**From Vello graphics library research**:

When buffer allocation fails:
1. Skip writing to storage - don't attempt the operation
2. Use previous frame fallback - let a blit operation preserve previous results
3. Non-async readback check - query success/failure at next paint cycle
4. Reallocate if needed - allow clients to increase buffer pools

**Key Insight**: Async/readback patterns valuable for testing/validation only - mixing CPU-GPU sync into production rendering paths creates bottlenecks.

### Integration with HistogramPipeline

**Modified compute() method**:
```typescript
class HistogramPipeline {
  private stagingPool: StagingBufferPool | null = null
  private lastHistogramData: HistogramResult | null = null

  async initialize(): Promise<boolean> {
    // ... existing init ...
    this.stagingPool = new StagingBufferPool(
      this.device,
      HistogramPipeline.HISTOGRAM_BUFFER_SIZE,
      3 // Triple buffer
    )
    return true
  }

  // New async non-blocking method
  computeAsync(
    pixels: Uint8Array,
    width: number,
    height: number,
    onComplete: (result: HistogramResult) => void
  ): void {
    // ... GPU dispatch ...

    this.stagingPool!.readbackAsync(
      this.histogramBuffer!,
      (data) => {
        const result = this.parseHistogramData(data)
        this.lastHistogramData = result
        onComplete(result)
      }
    )
  }

  // Synchronous fallback for when immediate data needed
  getLastHistogram(): HistogramResult | null {
    return this.lastHistogramData
  }
}
```

---

## Research Area 3: GPU-Direct Histogram Rendering

### Core Concept

Avoid CPU readback entirely by rendering histogram directly from GPU storage buffer using a fragment shader.

### Architecture

```
Compute Shader → Storage Buffer → Fragment Shader → Screen
     ↓                ↓                ↓
  Generate       No CPU copy      Visualize
  histogram                       directly
```

### WGSL Fragment Shader for Histogram Visualization

```wgsl
// Storage buffer containing histogram bins (read-only in fragment)
@group(0) @binding(0) var<storage, read> histogram_bins: array<u32>;

struct HistogramUniforms {
  max_bin_value: f32,
  num_bins: u32,
  display_width: f32,
  display_height: f32,
}
@group(0) @binding(1) var<uniform> uni: HistogramUniforms;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) texcoord: vec2f,
}

@fragment
fn render_histogram(input: VertexOutput) -> @location(0) vec4f {
  // Convert UV to bin index
  let bin_index = u32(input.texcoord.x * f32(uni.num_bins));
  let safe_bin = min(bin_index, uni.num_bins - 1u);

  // Look up bin value from storage buffer
  let bin_value = f32(histogram_bins[safe_bin]);

  // Normalize to 0->1 height range
  let height = bin_value / uni.max_bin_value;

  // Compare vertical coordinate to bar height
  if input.texcoord.y < height {
    return vec4f(0.4, 0.8, 0.4, 1.0); // Green histogram bar
  } else {
    return vec4f(0.1, 0.1, 0.1, 0.5); // Transparent background
  }
}
```

### Multi-Channel Histogram (RGBA Overlay)

```wgsl
@fragment
fn render_histogram_rgba(input: VertexOutput) -> @location(0) vec4f {
  let bin_idx = u32(input.texcoord.x * f32(uni.num_bins));
  let safe_bin = min(bin_idx, uni.num_bins - 1u);

  // Get heights for each channel (RGBA layout in buffer)
  let r_height = f32(histogram_bins[safe_bin]) / uni.max_bin_value;
  let g_height = f32(histogram_bins[safe_bin + 256u]) / uni.max_bin_value;
  let b_height = f32(histogram_bins[safe_bin + 512u]) / uni.max_bin_value;
  let l_height = f32(histogram_bins[safe_bin + 768u]) / uni.max_bin_value;

  let y = input.texcoord.y;

  // Layer channels with alpha blending
  var color = vec4f(0.0, 0.0, 0.0, 0.0);

  if y < l_height {
    color = mix(color, vec4f(0.5, 0.5, 0.5, 0.3), 0.3); // Gray luminance
  }
  if y < r_height {
    color = mix(color, vec4f(1.0, 0.2, 0.2, 0.5), 0.5); // Red
  }
  if y < g_height {
    color = mix(color, vec4f(0.2, 1.0, 0.2, 0.5), 0.5); // Green
  }
  if y < b_height {
    color = mix(color, vec4f(0.2, 0.2, 1.0, 0.5), 0.5); // Blue
  }

  return color;
}
```

### Double-Buffer Interpolation for Smooth Transitions

```wgsl
// Two histogram buffers for frame interpolation
@group(0) @binding(0) var<storage, read> histogram_prev: array<u32>;
@group(0) @binding(1) var<storage, read> histogram_curr: array<u32>;

struct AnimParams {
  blend_factor: f32, // 0.0 (fully previous) to 1.0 (fully current)
  max_bin_value: f32,
  num_bins: u32,
}
@group(0) @binding(2) var<uniform> anim: AnimParams;

@fragment
fn render_histogram_animated(input: VertexOutput) -> @location(0) vec4f {
  let bin_idx = u32(input.texcoord.x * f32(anim.num_bins));
  let safe_bin = min(bin_idx, anim.num_bins - 1u);

  // Get heights from both buffers
  let height_prev = f32(histogram_prev[safe_bin]) / anim.max_bin_value;
  let height_curr = f32(histogram_curr[safe_bin]) / anim.max_bin_value;

  // Smooth interpolation with easing
  let eased_blend = smoothstep(0.0, 1.0, anim.blend_factor);
  let height = mix(height_prev, height_curr, eased_blend);

  if input.texcoord.y < height {
    return vec4f(0.4, 0.8, 0.4, 1.0);
  } else {
    return vec4f(0.1, 0.1, 0.1, 0.5);
  }
}
```

### Integration with Vue Component

**TypeScript setup**:
```typescript
class GPUHistogramRenderer {
  private device: GPUDevice
  private histogramBuffer: GPUBuffer // Shared with compute
  private renderPipeline: GPURenderPipeline
  private uniformBuffer: GPUBuffer

  async initialize(device: GPUDevice, histogramBuffer: GPUBuffer) {
    this.device = device
    this.histogramBuffer = histogramBuffer

    // Create render pipeline with fragment shader
    this.renderPipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: { module: vertexShaderModule, entryPoint: 'main' },
      fragment: {
        module: fragmentShaderModule,
        entryPoint: 'render_histogram_rgba',
        targets: [{ format: 'rgba8unorm' }]
      }
    })
  }

  render(context: GPUCanvasContext, maxBinValue: number) {
    // Update uniforms
    this.device.queue.writeBuffer(
      this.uniformBuffer,
      0,
      new Float32Array([maxBinValue, 256, 0, 0])
    )

    // Render histogram directly from storage buffer
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store'
      }]
    })

    pass.setPipeline(this.renderPipeline)
    pass.setBindGroup(0, this.bindGroup) // Contains histogramBuffer
    pass.draw(6) // Fullscreen quad
    pass.end()

    this.device.queue.submit([encoder.finish()])
  }
}
```

### Benefits

| Aspect | CPU Readback | GPU-Direct |
|--------|--------------|------------|
| Latency | 2-5ms stall | 0ms |
| Data transfer | 4KB per frame | 0 bytes |
| Memory copies | 4 (slice operations) | 0 |
| Smoothness | Stuttery updates | 60fps capable |

---

## Research Area 4: TexturePool Integration

### Current State

**TexturePool exists but is unused**:
- Implementation: `packages/core/src/gpu/texture-utils.ts` (lines 214-308)
- Tests: Comprehensive coverage (24 test cases)
- Usage: **Not instantiated anywhere in production**

### Current Allocation Pattern (edit-pipeline.ts)

**Per-frame allocations**:
```typescript
// Line 190: Create input texture
let inputTexture = createTextureFromPixels(...)

// Line 378: Create output texture PER STAGE
const outputTexture = createOutputTexture(...)

// Line 311-314: Destroy all textures
for (const texture of texturesToDestroy) {
  texture.destroy()
}
```

**Memory impact for 4000×3000 image**:
- 5 textures × 48MB = **240MB GPU memory per frame**
- Plus staging buffers = **~290MB peak**

### TexturePool API

```typescript
class TexturePool {
  constructor(device: GPUDevice, maxPoolSize: number = 4)

  // Get texture from pool or create new
  acquire(
    width: number,
    height: number,
    usage: TextureUsage,
    label?: string
  ): GPUTexture

  // Return texture to pool (destroys if full)
  release(
    texture: GPUTexture,
    width: number,
    height: number,
    usage: TextureUsage
  ): void

  // Cleanup
  clear(): void

  // Stats
  getStats(): { poolCount: number, totalTextures: number }
}
```

### Integration Strategy

**Modified GPUEditPipeline**:
```typescript
class GPUEditPipeline {
  private texturePool: TexturePool | null = null

  async initialize(): Promise<boolean> {
    // ... existing init ...
    this.texturePool = new TexturePool(this.device, 8)
    return true
  }

  async process(input: ImagePixels, params: EditParams): Promise<EditPipelineResult> {
    // Acquire instead of create
    const inputTexture = this.texturePool!.acquire(
      input.width,
      input.height,
      TextureUsage.PINGPONG,
      'Edit Pipeline Input'
    )

    // Upload pixels to acquired texture
    this.device.queue.writeTexture(
      { texture: inputTexture },
      input.data,
      { bytesPerRow: input.width * 4 },
      { width: input.width, height: input.height }
    )

    // Process stages...
    for (const stage of activeStages) {
      const outputTexture = this.texturePool!.acquire(
        ctx.currentWidth,
        ctx.currentHeight,
        TextureUsage.PINGPONG,
        `${stage.name} Output`
      )

      await stage.process(inputTexture, outputTexture, ctx)

      // Release input, output becomes new input
      this.texturePool!.release(inputTexture, ...)
      inputTexture = outputTexture
    }

    // Readback result...

    // Release final texture
    this.texturePool!.release(inputTexture, ...)

    return result
  }

  destroy(): void {
    this.texturePool?.clear()
    // ... existing cleanup ...
  }
}
```

### Expected Savings

| Metric | Current | With Pool |
|--------|---------|-----------|
| GPU memory/frame | 240MB | ~48MB (first frame), 0MB (subsequent) |
| Allocations/sec @60fps | 300+ | 0 (after warmup) |
| GC pressure | High | Minimal |
| Frame time variance | High | Low |

---

## Combined Implementation Plan

### Phase 1: TexturePool Integration (Lowest Risk)

1. Add `texturePool` field to `GPUEditPipeline`
2. Initialize in `initialize()` method
3. Replace `createTextureFromPixels()` → `pool.acquire()` + `writeTexture()`
4. Replace `createOutputTexture()` → `pool.acquire()`
5. Replace `texture.destroy()` → `pool.release()`
6. Add `pool.clear()` to `destroy()`

**Risk**: Low - TexturePool is fully tested
**Impact**: 1.2-2.4ms saved per frame

### Phase 2: Async Histogram (Medium Risk)

1. Add `StagingBufferPool` class to histogram-pipeline.ts
2. Add `computeAsync()` method alongside existing `compute()`
3. Modify GPUHistogramService to use async path
4. Add `getLastHistogram()` for fallback
5. Update UI to handle async histogram updates

**Risk**: Medium - Changes async flow
**Impact**: Eliminate 2-5ms stalls

### Phase 3: GPU-Direct Histogram (Higher Complexity)

1. Create `histogram-render.wgsl` shader
2. Create `GPUHistogramRenderer` class
3. Share histogram buffer between compute and render
4. Integrate with Vue histogram component
5. Add double-buffer interpolation

**Risk**: Higher - New rendering path
**Impact**: Zero-latency histogram updates

---

## Code Locations Summary

| Component | File | Lines |
|-----------|------|-------|
| TexturePool | `packages/core/src/gpu/texture-utils.ts` | 214-308 |
| BufferPool | `packages/core/src/gpu/texture-utils.ts` | 313-371 |
| HistogramPipeline | `packages/core/src/gpu/pipelines/histogram-pipeline.ts` | 1-323 |
| EditPipeline | `packages/core/src/gpu/pipelines/edit-pipeline.ts` | 1-340 |
| Histogram Shader | `packages/core/src/gpu/shaders/histogram.wgsl` | 1-164 |

---

## Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Histogram stall | 2-5ms | 0ms |
| Per-frame alloc | 240MB | <50MB |
| Histogram latency | 500ms debounce | Real-time |
| Frame time variance | High | <5ms |

---

## References

- [WebGPU Best Practices - Toji.dev](https://toji.dev/webgpu-best-practices/)
- [WebGPU Buffer Uploads](https://toji.dev/webgpu-best-practices/buffer-uploads.html)
- [WebGPU Compute Shaders - Histogram](https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html)
- [Metal Best Practices - Triple Buffering](https://developer.apple.com/library/archive/documentation/3DDrawing/Conceptual/MTLBestPracticesGuide/TripleBuffering.html)
- [Vello - Robust Dynamic Memory Strategy](https://github.com/linebender/vello/issues/366)
- [Figma Rendering - WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/)
- [Double Buffer Pattern](https://gameprogrammingpatterns.com/double-buffer.html)
