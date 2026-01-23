# GPU Transform Operations - Research Synthesis

**Date**: 2026-01-23
**Phase**: GPU Acceleration Phase 6

## Executive Summary

This document synthesizes research from 5 parallel investigations into GPU-accelerated transform operations (rotation and resize) for the Literoom edit preview pipeline.

## Key Findings

### 1. Current WASM Transform Implementation

**Rotation** (`crates/literoom-core/src/transform.rs`):
- Inverse mapping approach: for each output pixel, calculate source coordinates
- Bilinear interpolation (preview) or Lanczos3 (export)
- Angle in degrees, positive = counter-clockwise
- Output dimensions: `new_w = |w*cos| + |h*sin|`, `new_h = |w*sin| + |h*cos|`
- Fast paths for 0°, 90°, 180°, 270°
- Black pixels for out-of-bounds regions

**Crop** (`crates/literoom-core/src/transform.rs`):
- Normalized coordinates (0.0-1.0)
- Direct pixel copy (no interpolation)
- Clamping for out-of-bounds regions

**Pipeline Order**: Rotation → Crop → Adjustments → Tone Curve → Masks

### 2. GPU Shader Patterns

**Bilinear Interpolation (Recommended for Preview)**:
- Sample 4 neighboring pixels
- Hardware-accelerated via `textureSample()` with linear sampler
- Excellent performance, acceptable quality
- 4 texture reads per output pixel

**Bicubic Interpolation (Optional for Quality)**:
- Sample 16 pixels (4x4 neighborhood)
- Better quality, especially for downscaling
- Significantly slower than bilinear
- Not hardware-accelerated

**Lanczos (Not Recommended for GPU)**:
- Requires expensive trigonometry
- Best suited for offline/export processing
- Keep WASM implementation for export quality

### 3. Rotation Shader Design

```wgsl
struct RotationParams {
  cos_angle: f32,    // Pre-computed cos(angle)
  sin_angle: f32,    // Pre-computed sin(angle)
  src_cx: f32,       // Source center X
  src_cy: f32,       // Source center Y
  dst_cx: f32,       // Destination center X
  dst_cy: f32,       // Destination center Y
  src_width: u32,
  src_height: u32,
}

// Inverse transform for each output pixel:
let dx = dst_x - dst_cx;
let dy = dst_y - dst_cy;
let src_x = dx * cos_angle - dy * sin_angle + src_cx;
let src_y = dx * sin_angle + dy * cos_angle + src_cy;
```

**Key Implementation Details**:
- Pre-compute cos/sin in JavaScript (avoid GPU trigonometry)
- Use inverse rotation (angle negated) for backward mapping
- Center-based rotation with dimension expansion
- Bilinear sampling for smooth results

### 4. Existing GPU Patterns to Follow

**From texture-utils.ts**:
- `createTextureFromPixels()`: Upload pixel data to GPU
- `createOutputTexture()`: Create output storage texture
- `DoubleBufferedTextures`: Ping-pong pattern for chaining
- `TexturePool`: Reusable texture allocation
- `calculateDispatchSize()`: Workgroup dispatch calculation

**From existing pipelines**:
- 16x16 workgroup size (WORKGROUP_SIZE constant)
- Uniform buffers for parameters
- Both `apply()` (pixel path) and `applyToTextures()` (chaining path)
- Singleton pattern with `get*Service()` functions
- Adaptive pattern with WASM fallback

**Texture Format**: Always use `rgba8unorm` for consistency

### 5. Integration Points

**Current Pipeline in useEditPreview.ts**:
```
decode → rotate → crop → adjust → tone curve → masks → histogram
         ^^^^^    ^^^^
         WASM     WASM   (transforms to be GPU-accelerated)
```

**GPU Services Already Available**:
- GPUAdjustmentsService ✓ (not integrated)
- GPUToneCurveService ✓ (not integrated)
- GPUMaskService ✓ (integrated)
- GPUHistogramService ✓ (integrated)

**Pattern for Integration** (from gpu-mask-service.ts):
```typescript
export async function applyRotationAdaptive(
  pixels, width, height, angleDegrees,
  wasmFallback
): Promise<{ result: DecodedImage; backend: 'webgpu' | 'wasm'; timing: number }>
```

## Architecture Decision

### Approach: Compute Shaders (Not Render Pipeline)

**Rationale**:
1. Consistent with existing GPU architecture (all compute shaders)
2. Simpler integration with existing texture utilities
3. More control over interpolation algorithms
4. Can use `textureLoad()` with manual bilinear for consistency

### File Structure

```
packages/core/src/gpu/
├── shaders/
│   ├── rotation.wgsl          (NEW)
│   ├── resize.wgsl            (NEW)
│   └── index.ts               (update exports)
├── pipelines/
│   ├── rotation-pipeline.ts   (NEW)
│   ├── resize-pipeline.ts     (NEW)
│   └── index.ts               (update exports)
├── gpu-transform-service.ts   (NEW - high-level service)
└── index.ts                   (update exports)
```

## Performance Targets

| Operation | Current (WASM) | Target (GPU) | Expected Speedup |
|-----------|----------------|--------------|------------------|
| Rotation (2560×1440) | ~850ms | ~8ms | 100x+ |
| Resize (2560×1440) | ~420ms | ~12ms | 35x |

## Recommendations

### Phase 6.1: Rotation Pipeline
1. Create `rotation.wgsl` with bilinear interpolation
2. Create `RotationPipeline` TypeScript wrapper
3. Create `GPUTransformService` with rotation support
4. Integrate into useEditPreview.ts with adaptive fallback

### Phase 6.2: Resize Pipeline (Lower Priority)
- Resize is primarily used for thumbnails (background operation)
- Preview doesn't resize (maintains dimensions after crop)
- Can defer to Phase 7 or later

### Phase 6.3: Crop Handling
- Keep WASM crop (simple pixel copy, fast enough)
- OR: Create GPU crop if chaining operations to avoid CPU roundtrip
- Decision: Start with WASM, optimize later if bottleneck

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Quality mismatch | Compare GPU vs WASM output visually |
| Performance regression | Benchmark before/after integration |
| Edge cases (0°, 90°, etc.) | Implement fast paths matching WASM |
| Memory for large images | Check limits, use texture pools |

## Next Steps

1. Create implementation plan in `docs/plans/2026-01-23-gpu-transforms-plan.md`
2. Implement rotation shader and pipeline
3. Create GPUTransformService
4. Integrate into useEditPreview.ts
5. Test and benchmark
