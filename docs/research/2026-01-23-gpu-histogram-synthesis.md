# GPU Histogram Computation Research Synthesis

**Date**: 2026-01-23
**Objective**: Implement GPU-accelerated histogram computation for real-time preview updates

## Executive Summary

GPU histogram computation using workgroup privatization can achieve 12x speedup (12ms → 1ms) by:
1. Using shared memory atomics within workgroups (100x faster than global atomics)
2. Two-phase approach: local histograms per workgroup, then parallel reduction merge
3. Small output buffer (3KB) makes readback efficient

## Current Implementation Analysis

### Rust Histogram Structure (`crates/literoom-core/src/histogram.rs`)

```rust
pub struct Histogram {
    pub red: [u32; 256],
    pub green: [u32; 256],
    pub blue: [u32; 256],
    pub luminance: [u32; 256],
}
```

**Characteristics:**
- 4 channels × 256 bins × 4 bytes = 4KB total
- Single-pass O(n) algorithm through all pixels
- ITU-R BT.709 luminance: `L = 0.2126*R + 0.7152*G + 0.0722*B`
- Clipping detection: `red[0] > 0` (shadow) or `red[255] > 0` (highlight)

### TypeScript Interface (`packages/core/src/decode/types.ts`)

```typescript
export interface HistogramData {
  red: Uint32Array       // 256 bins
  green: Uint32Array     // 256 bins
  blue: Uint32Array      // 256 bins
  luminance: Uint32Array // 256 bins
  maxValue: number
  hasHighlightClipping: boolean
  hasShadowClipping: boolean
  highlightClipping?: ChannelClipping  // Per-channel
  shadowClipping?: ChannelClipping     // Per-channel
}
```

### Integration Points

**DecodeService Interface:**
```typescript
computeHistogram(pixels: Uint8Array, width: number, height: number): Promise<HistogramData>
```

**UI Integration:**
- `useHistogramDisplay.ts` - Canvas-based with Gaussian smoothing
- `useHistogramDisplaySVG.ts` - SVG with Catmull-Rom splines
- Debounced 500ms / throttled 250ms to prioritize preview rendering
- Generation counter prevents stale updates during rapid navigation

## GPU Histogram Algorithm

### Why Global Atomics Are Slow

Global memory atomics cause 10-25x slowdown due to:
- Memory serialization (threads wait for locks)
- DRAM burst optimization prevented
- High contention when multiple threads target same bin

### Recommended: Workgroup Privatization (Two-Phase)

**Phase 1: Local Histogram per Workgroup**
```
1. Each workgroup processes chunk of pixels
2. Shared memory histogram: var<workgroup> bins: array<atomic<u32>, 1024>
3. Each thread reads pixel, computes bin, atomicAdd to shared histogram
4. workgroupBarrier() for synchronization
5. Store workgroup histogram to global storage buffer
```

**Phase 2: Parallel Reduction Merge**
```
1. Combine all workgroup histograms using stride pattern
2. result[i] += result[i + stride]
3. Stride: 1 → 2 → 4 → 8 → ... until single histogram
```

### Performance Comparison

| Approach | Time (2560×1440) | Notes |
|----------|------------------|-------|
| WASM (current) | ~12ms | Single-threaded, sequential |
| GPU Global Atomics | ~8ms | 1.5x speedup, contention issues |
| GPU Privatization | ~1ms | 12x speedup, recommended |

## WGSL Shader Design

### Bind Group Layout

```wgsl
@group(0) @binding(0) var inputTexture: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> histogram: HistogramBuffer;
@group(0) @binding(2) var<uniform> dimensions: Dimensions;
```

### Histogram Buffer Structure

```wgsl
struct HistogramBuffer {
  bins_r: array<atomic<u32>, 256>,
  bins_g: array<atomic<u32>, 256>,
  bins_b: array<atomic<u32>, 256>,
  bins_l: array<atomic<u32>, 256>,  // Luminance
}
// Total: 256 * 4 * 4 = 4,096 bytes
```

### Two Compute Shaders Needed

**Shader 1: Histogram Accumulation (with privatization)**
```wgsl
@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) gid: vec3<u32>,
        @builtin(local_invocation_index) lid: u32) {

    // Shared memory for workgroup-local histogram
    var<workgroup> local_bins_r: array<atomic<u32>, 256>;
    var<workgroup> local_bins_g: array<atomic<u32>, 256>;
    var<workgroup> local_bins_b: array<atomic<u32>, 256>;
    var<workgroup> local_bins_l: array<atomic<u32>, 256>;

    // Initialize shared memory (first 256 threads)
    if (lid < 256u) {
        atomicStore(&local_bins_r[lid], 0u);
        atomicStore(&local_bins_g[lid], 0u);
        atomicStore(&local_bins_b[lid], 0u);
        atomicStore(&local_bins_l[lid], 0u);
    }
    workgroupBarrier();

    // Process pixel
    if (gid.x < dimensions.width && gid.y < dimensions.height) {
        let color = textureLoad(inputTexture, vec2<i32>(gid.xy), 0);

        // Quantize to 0-255
        let r = u32(color.r * 255.0);
        let g = u32(color.g * 255.0);
        let b = u32(color.b * 255.0);
        let l = u32((0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) * 255.0);

        // Accumulate to local histogram
        atomicAdd(&local_bins_r[r], 1u);
        atomicAdd(&local_bins_g[g], 1u);
        atomicAdd(&local_bins_b[b], 1u);
        atomicAdd(&local_bins_l[l], 1u);
    }
    workgroupBarrier();

    // Write local histogram to global buffer (first 256 threads)
    if (lid < 256u) {
        atomicAdd(&histogram.bins_r[lid], atomicLoad(&local_bins_r[lid]));
        atomicAdd(&histogram.bins_g[lid], atomicLoad(&local_bins_g[lid]));
        atomicAdd(&histogram.bins_b[lid], atomicLoad(&local_bins_b[lid]));
        atomicAdd(&histogram.bins_l[lid], atomicLoad(&local_bins_l[lid]));
    }
}
```

**Note:** The above uses workgroup privatization - each workgroup accumulates to shared memory first, then merges to global. This reduces global atomic contention by workgroup_count times.

### Shader 2: Find Max Value (Parallel Reduction)

```wgsl
@compute @workgroup_size(256)
fn find_max(@builtin(global_invocation_id) gid: vec3<u32>) {
    // Parallel reduction to find max bin value
    // Standard reduction pattern with workgroup shared memory
}
```

## Pipeline Implementation

### HistogramPipeline Class Pattern

Following established patterns from existing pipelines:

```typescript
export class HistogramPipeline {
  private device: GPUDevice
  private pipeline: GPUComputePipeline | null = null
  private histogramBuffer: GPUBuffer | null = null  // 4KB storage
  private dimensionsBuffer: GPUBuffer | null = null

  async initialize(): Promise<void>
  async compute(inputTexture: GPUTexture, width: number, height: number): Promise<HistogramData>
  destroy(): void
}
```

### Key Differences from Existing Pipelines

| Aspect | Adjustments/ToneCurve/Masks | Histogram |
|--------|----------------------------|-----------|
| Output | Texture (rgba8unorm) | Storage buffer (4KB) |
| Atomics | None | Required (atomicAdd) |
| Workgroup sync | None | workgroupBarrier() |
| Readback size | width×height×4 bytes | 4,096 bytes |
| Multi-pass | No | Yes (accumulate + max) |

### Buffer Management

**Histogram Storage Buffer:**
```typescript
this.histogramBuffer = device.createBuffer({
  label: 'Histogram Storage Buffer',
  size: 256 * 4 * 4,  // 4 channels × 256 bins × 4 bytes = 4KB
  usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
})
```

**Staging Buffer for Readback:**
```typescript
const stagingBuffer = device.createBuffer({
  size: 256 * 4 * 4,
  usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
})
```

## GPU Service Integration

### GPUHistogramService Interface

```typescript
export class GPUHistogramService {
  async initialize(): Promise<void>

  // Match DecodeService interface
  async computeHistogram(
    pixels: Uint8Array,
    width: number,
    height: number
  ): Promise<HistogramData>

  // Efficient path when texture already on GPU
  async computeHistogramFromTexture(
    texture: GPUTexture,
    width: number,
    height: number
  ): Promise<HistogramData>

  destroy(): void
}
```

### Adaptive Function

```typescript
export async function computeHistogramAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  wasmFallback: () => Promise<HistogramData>
): Promise<{ result: HistogramData; backend: 'webgpu' | 'wasm'; timing: number }>
```

## Implementation Plan

### Phase 5.1: WGSL Histogram Shader
- Create `histogram.wgsl` with workgroup privatization
- Export shader source in `shaders/index.ts`
- Test shader compilation

### Phase 5.2: Histogram Pipeline Wrapper
- Create `HistogramPipeline` class
- Implement buffer management
- Handle histogram buffer clearing between computations
- Implement readback logic

### Phase 5.3: GPU Histogram Service
- Create `GPUHistogramService` class
- Implement type conversions (GPU buffer → HistogramData)
- Compute maxValue and clipping flags from histogram data
- Add singleton pattern

### Phase 5.4: Integration
- Add adaptive function for GPU/WASM selection
- Update useEditPreview.ts or DecodeService for GPU histogram
- Verify histogram display matches WASM output

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Shared memory limits exceeded | Low | 4×256×4 = 4KB fits easily in 48KB limit |
| Atomic contention in privatized approach | Low | Workgroup-local atomics have minimal contention |
| Different histogram values than WASM | Medium | Careful testing, same quantization formula |
| GPU readback latency | Low | Only 4KB to read back |

## Success Criteria

1. ✅ Histogram values match WASM implementation
2. ✅ Clipping detection works correctly
3. ✅ Performance: <2ms for 2560×1440 image
4. ✅ Automatic fallback to WASM works
5. ✅ Integration with existing histogram display components

## Files to Create

1. `packages/core/src/gpu/shaders/histogram.wgsl`
2. `packages/core/src/gpu/pipelines/histogram-pipeline.ts`
3. `packages/core/src/gpu/gpu-histogram-service.ts`

## Files to Modify

1. `packages/core/src/gpu/shaders/index.ts` - Export shader source
2. `packages/core/src/gpu/pipelines/index.ts` - Export pipeline
3. `packages/core/src/gpu/index.ts` - Export service
4. `apps/web/app/composables/useEditPreview.ts` - Optional GPU integration
