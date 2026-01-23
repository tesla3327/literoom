# GPU Transform Operations Implementation Plan

**Date**: 2026-01-23
**Based on**: `docs/research/2026-01-23-gpu-transforms-synthesis.md`
**Phase**: GPU Acceleration Phase 6

## Overview

Implement GPU-accelerated rotation for the edit preview pipeline. Resize is deferred as it's primarily used for thumbnail generation (background operation) rather than interactive preview.

## Goals

1. Enable real-time rotation preview during slider interaction
2. Reduce rotation latency from ~850ms to <10ms
3. Maintain visual consistency with WASM implementation
4. Provide automatic fallback to WASM when GPU unavailable

## Implementation Phases

### Phase 6.1: Rotation Shader (1 task)

**Create**: `packages/core/src/gpu/shaders/rotation.wgsl`

```wgsl
// Rotation compute shader with bilinear interpolation
// Matches Rust implementation behavior

struct RotationParams {
  cos_angle: f32,
  sin_angle: f32,
  src_cx: f32,
  src_cy: f32,
  dst_cx: f32,
  dst_cy: f32,
  src_width: u32,
  src_height: u32,
}

struct Dimensions {
  width: u32,
  height: u32,
  _padding1: u32,
  _padding2: u32,
}

@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(2) var<uniform> params: RotationParams;
@group(0) @binding(3) var<uniform> dims: Dimensions;

fn sample_bilinear(src_x: f32, src_y: f32) -> vec4<f32> {
  // Bounds check
  if (src_x < 0.0 || src_x >= f32(params.src_width - 1u) ||
      src_y < 0.0 || src_y >= f32(params.src_height - 1u)) {
    return vec4<f32>(0.0, 0.0, 0.0, 1.0);  // Black with alpha
  }

  let x0 = i32(floor(src_x));
  let y0 = i32(floor(src_y));
  let x1 = x0 + 1;
  let y1 = y0 + 1;

  let fx = src_x - f32(x0);
  let fy = src_y - f32(y0);

  let p00 = textureLoad(input_texture, vec2<i32>(x0, y0), 0);
  let p10 = textureLoad(input_texture, vec2<i32>(x1, y0), 0);
  let p01 = textureLoad(input_texture, vec2<i32>(x0, y1), 0);
  let p11 = textureLoad(input_texture, vec2<i32>(x1, y1), 0);

  let p0 = mix(p00, p10, fx);
  let p1 = mix(p01, p11, fx);
  return mix(p0, p1, fy);
}

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  if (global_id.x >= dims.width || global_id.y >= dims.height) {
    return;
  }

  let dst_x = f32(global_id.x);
  let dst_y = f32(global_id.y);

  // Inverse rotation to find source coordinates
  let dx = dst_x - params.dst_cx;
  let dy = dst_y - params.dst_cy;
  let src_x = dx * params.cos_angle - dy * params.sin_angle + params.src_cx;
  let src_y = dx * params.sin_angle + dy * params.cos_angle + params.src_cy;

  let pixel = sample_bilinear(src_x, src_y);
  textureStore(output_texture, vec2<i32>(global_id.xy), pixel);
}
```

**Update**: `packages/core/src/gpu/shaders/index.ts` - Export shader source

### Phase 6.2: Rotation Pipeline (1 task)

**Create**: `packages/core/src/gpu/pipelines/rotation-pipeline.ts`

```typescript
export interface RotationResult {
  pixels: Uint8Array
  width: number
  height: number
}

export class RotationPipeline {
  private device: GPUDevice
  private pipeline: GPUComputePipeline | null = null
  private paramsBuffer: GPUBuffer | null = null
  private dimsBuffer: GPUBuffer | null = null

  static readonly WORKGROUP_SIZE = 16

  async initialize(): Promise<void>

  // Compute output dimensions for rotation
  static computeRotatedDimensions(
    width: number,
    height: number,
    angleDegrees: number
  ): { width: number; height: number }

  // Full pixel path with readback
  async apply(
    inputPixels: Uint8Array,
    width: number,
    height: number,
    angleDegrees: number
  ): Promise<RotationResult>

  // Texture-to-texture path for chaining
  applyToTextures(
    inputTexture: GPUTexture,
    outputTexture: GPUTexture,
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number,
    angleDegrees: number,
    encoder?: GPUCommandEncoder
  ): GPUCommandEncoder

  destroy(): void
}

// Singleton accessor
export function getRotationPipeline(): Promise<RotationPipeline | null>
```

**Update**: `packages/core/src/gpu/pipelines/index.ts` - Export pipeline

### Phase 6.3: GPU Transform Service (1 task)

**Create**: `packages/core/src/gpu/gpu-transform-service.ts`

```typescript
export class GPUTransformService {
  private rotationPipeline: RotationPipeline | null = null
  private _initialized = false

  get isReady(): boolean

  async initialize(): Promise<boolean>

  async applyRotation(
    pixels: Uint8Array,
    width: number,
    height: number,
    angleDegrees: number
  ): Promise<DecodedImage>

  destroy(): void
}

// Singleton pattern
export function getGPUTransformService(): GPUTransformService
export function resetGPUTransformService(): void

// Adaptive function with WASM fallback
export async function applyRotationAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  angleDegrees: number,
  wasmFallback: () => Promise<DecodedImage>
): Promise<{
  result: DecodedImage
  backend: 'webgpu' | 'wasm'
  timing: number
}>
```

**Update**: `packages/core/src/gpu/index.ts` - Export service

### Phase 6.4: useEditPreview Integration (1 task)

**Modify**: `apps/web/app/composables/useEditPreview.ts`

Replace WASM rotation call (lines 534-548) with adaptive GPU rotation:

```typescript
import { applyRotationAdaptive } from '@literoom/core/gpu'

// In processPreview():
const totalRotation = getTotalRotation(editStore.cropTransform.rotation)
if (Math.abs(totalRotation) > 0.001) {
  const { result: rotated, backend, timing } = await applyRotationAdaptive(
    currentPixels,
    currentWidth,
    currentHeight,
    totalRotation,
    // WASM fallback
    () => $decodeService.applyRotation(
      currentPixels, currentWidth, currentHeight,
      totalRotation, false
    )
  )
  console.log(`[useEditPreview] Rotation via ${backend} in ${timing.toFixed(1)}ms`)
  currentPixels = rotated.pixels
  currentWidth = rotated.width
  currentHeight = rotated.height
}
```

### Phase 6.5: Testing (1 task)

**Create**: `packages/core/src/gpu/pipelines/rotation-pipeline.test.ts`

Tests:
- Dimension calculation for various angles (0°, 45°, 90°, 180°, 270°)
- Fast path detection (no rotation for angle < 0.001°)
- Bilinear interpolation accuracy
- Edge handling (black pixels for out-of-bounds)
- Integration with existing GPU patterns

**Create**: `packages/core/src/gpu/gpu-transform-service.test.ts`

Tests:
- Service initialization
- Rotation with various parameters
- Fallback behavior when GPU unavailable

## Acceptance Criteria

- [ ] Rotation shader matches WASM output visually
- [ ] Rotation time < 10ms for 2560×1440 preview
- [ ] Fast paths work for 0°, 90°, 180°, 270° angles
- [ ] Automatic fallback to WASM when GPU unavailable
- [ ] All existing tests pass
- [ ] New tests added for GPU rotation

## Files to Create (5)

1. `packages/core/src/gpu/shaders/rotation.wgsl`
2. `packages/core/src/gpu/pipelines/rotation-pipeline.ts`
3. `packages/core/src/gpu/gpu-transform-service.ts`
4. `packages/core/src/gpu/pipelines/rotation-pipeline.test.ts`
5. `packages/core/src/gpu/gpu-transform-service.test.ts`

## Files to Modify (4)

1. `packages/core/src/gpu/shaders/index.ts` - Export shader
2. `packages/core/src/gpu/pipelines/index.ts` - Export pipeline
3. `packages/core/src/gpu/index.ts` - Export service
4. `apps/web/app/composables/useEditPreview.ts` - Integrate GPU rotation

## Implementation Order

1. **Phase 6.1**: Rotation shader
2. **Phase 6.2**: Rotation pipeline
3. **Phase 6.3**: GPU transform service
4. **Phase 6.4**: useEditPreview integration
5. **Phase 6.5**: Tests

## Estimated Effort

Total: 1-2 iterations

## Notes

- Resize is deferred (used for thumbnails, not preview)
- Crop remains WASM (simple pixel copy, fast enough)
- Lanczos interpolation kept in WASM for export quality
- GPU uses bilinear only (sufficient for preview)
