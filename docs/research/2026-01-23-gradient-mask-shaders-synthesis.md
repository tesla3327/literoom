# GPU Gradient Mask Shaders Research Synthesis

**Created**: 2026-01-23
**Based on**: 4 parallel research agents analyzing Rust algorithms, GPU pipeline architecture, WGSL patterns, and integration points

## Executive Summary

This synthesis compiles findings from four parallel research efforts into a comprehensive guide for implementing GPU-accelerated gradient mask shaders in Literoom. The research confirms that:

1. **Rust algorithms are well-documented** and straightforward to port to WGSL
2. **GPU pipeline patterns are established** with consistent architecture across adjustments and tone curve
3. **WGSL has all necessary capabilities** including smoothstep, trig functions, and array handling
4. **Integration points are clear** with minimal changes needed to existing code

**Target Performance**: 100ms → 4ms for 2 masks (25x speedup)

---

## 1. Rust Mask Algorithms

### Smootherstep Function (Must be implemented in WGSL)
```wgsl
fn smootherstep(t: f32) -> f32 {
    let x = clamp(t, 0.0, 1.0);
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}
```
This is Ken Perlin's smootherstep (5th order polynomial), NOT the built-in WGSL smoothstep.

### Linear Gradient Mask Algorithm
```
1. Calculate direction vector: dx = end_x - start_x, dy = end_y - start_y
2. Calculate length squared: len_sq = dx² + dy²
3. Handle degenerate case: if len_sq < epsilon, return 0.5
4. Project point onto gradient line: t = ((x - start_x) * dx + (y - start_y) * dy) / len_sq
5. Calculate feather zone: zone = 0.5 * feather, center = 0.5
6. Apply feathering:
   - if t <= center - zone: return 1.0 (full effect)
   - if t >= center + zone: return 0.0 (no effect)
   - else: return 1.0 - smootherstep((t - (center - zone)) / (2 * zone))
```

### Radial Gradient Mask Algorithm
```
1. Translate to center: dx = x - center_x, dy = y - center_y
2. Apply inverse rotation matrix:
   local_x = dx * cos(rotation) + dy * sin(rotation)
   local_y = -dx * sin(rotation) + dy * cos(rotation)
3. Calculate normalized distance:
   norm_dist = sqrt((local_x / radius_x)² + (local_y / radius_y)²)
4. Calculate inner boundary: inner = 1.0 - feather
5. Apply feathering:
   - if norm_dist <= inner: mask = 1.0
   - if norm_dist >= 1.0: mask = 0.0
   - else: mask = 1.0 - smootherstep((norm_dist - inner) / (1.0 - inner))
6. Apply invert: if invert: mask = 1.0 - mask
```

### Mask Application (Per-Pixel Blending)
```
For each pixel at normalized (x, y):
  1. Load RGB values, normalize to [0, 1]
  2. For each linear mask: blend adjusted pixels with mask value
  3. For each radial mask: blend adjusted pixels with mask value
  4. Blending formula: output = original * (1 - mask) + adjusted * mask
  5. Clamp and convert back to [0, 255]
```

---

## 2. GPU Pipeline Architecture

### Standard Pipeline Pattern
Following existing adjustments/tone-curve pipelines:

```typescript
export class MaskPipeline {
  private device: GPUDevice
  private pipeline: GPUComputePipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null
  private paramsBuffer: GPUBuffer | null = null
  private dimensionsBuffer: GPUBuffer | null = null

  constructor(device: GPUDevice) { this.device = device }

  async initialize(): Promise<void> { /* Create shader, layout, pipeline */ }

  // CPU↔GPU transfers - for isolated operations
  async apply(
    inputPixels: Uint8Array,
    width: number,
    height: number,
    maskStack: MaskStackData
  ): Promise<Uint8Array>

  // GPU-only - for chaining operations
  applyToTextures(
    inputTexture: GPUTexture,
    outputTexture: GPUTexture,
    width: number,
    height: number,
    maskStack: MaskStackData,
    encoder?: GPUCommandEncoder
  ): GPUCommandEncoder

  destroy(): void { /* Cleanup resources */ }
}
```

### Bind Group Layout Pattern
From existing shaders:
- Binding 0: Input texture (`texture_2d<f32>`)
- Binding 1: Output texture (`texture_storage_2d<rgba8unorm, write>`)
- Binding 2: Mask parameters uniform buffer
- Binding 3: Dimensions uniform buffer

### Workgroup Configuration
All shaders use `@workgroup_size(16, 16)` - 256 threads per workgroup.

### Texture Formats
- Input: `rgba8unorm` (sampled texture)
- Output: `rgba8unorm` (storage texture, write-only)

---

## 3. WGSL Design Recommendations

### Fixed-Size Array Approach (Recommended for v1)
Support up to 8 masks in uniform buffer (fits well under 64KB limit):

```wgsl
const MAX_MASKS: u32 = 8u;

struct LinearMask {
    start_x: f32,
    start_y: f32,
    end_x: f32,
    end_y: f32,
    feather: f32,
    enabled: u32,
    exposure: f32,
    contrast: f32,
    // Total: 32 bytes (8 f32)
}

struct RadialMask {
    center_x: f32,
    center_y: f32,
    radius_x: f32,
    radius_y: f32,
    rotation: f32,
    feather: f32,
    invert: u32,
    enabled: u32,
    exposure: f32,
    contrast: f32,
    _padding1: f32,
    _padding2: f32,
    // Total: 48 bytes (12 f32)
}

struct MaskParams {
    linear_masks: array<LinearMask, 8>,  // 256 bytes
    radial_masks: array<RadialMask, 8>,  // 384 bytes
    linear_count: u32,
    radial_count: u32,
    _padding: array<u32, 2>,             // Alignment padding
    // Total: ~656 bytes
}
```

### Key WGSL Functions Available
- `smoothstep(edge0, edge1, x)` - Hermite interpolation (NOT smootherstep)
- `sin(angle)`, `cos(angle)` - Trigonometric (radians)
- `dot(a, b)`, `length(v)`, `normalize(v)` - Vector math
- `clamp(x, min, max)`, `mix(a, b, t)` - Utility functions

### Memory Alignment Rules
- `f32`: 4 bytes, 4-byte alignment
- `vec2<f32>`: 8 bytes, 8-byte alignment
- `vec3<f32>`: 12 bytes, 16-byte alignment (padded!)
- `vec4<f32>`: 16 bytes, 16-byte alignment
- Structs: 16-byte minimum alignment

---

## 4. Integration Plan

### Current Pipeline Order
```
Source Image → Rotation → Crop → Adjustments → Tone Curve → Masks → Output
```

### GPU Service Interface
```typescript
class GPUMaskService {
  private pipeline: MaskPipeline | null = null

  async initialize(): Promise<boolean>

  async applyMaskedAdjustments(
    pixels: Uint8Array,
    width: number,
    height: number,
    maskStack: MaskStackData
  ): Promise<DecodedImage>

  async applyMaskedAdjustmentsRgba(
    rgbaPixels: Uint8Array,
    width: number,
    height: number,
    maskStack: MaskStackData
  ): Promise<Uint8Array>

  destroy(): void
}

// Singleton factory
export async function getGPUMaskService(): Promise<GPUMaskService | null>
export function resetGPUMaskService(): void

// Adaptive wrapper
export async function applyMaskedAdjustmentsAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  maskStack: MaskStackData,
  wasmFallback: () => Promise<DecodedImage>
): Promise<{ result: DecodedImage; backend: 'webgpu' | 'wasm'; timing: number }>
```

### Files to Create
| File | Purpose |
|------|---------|
| `packages/core/src/gpu/shaders/masks.wgsl` | WGSL compute shader |
| `packages/core/src/gpu/pipelines/mask-pipeline.ts` | Pipeline wrapper |
| `packages/core/src/gpu/gpu-mask-service.ts` | High-level service |

### Files to Modify
| File | Changes |
|------|---------|
| `packages/core/src/gpu/shaders/index.ts` | Export mask shader |
| `packages/core/src/gpu/pipelines/index.ts` | Export MaskPipeline |
| `packages/core/src/gpu/index.ts` | Export GPUMaskService |
| `packages/core/src/gpu/types.ts` | Add 'masks' to GPUOperation type |

---

## 5. WGSL Shader Design

### Complete Linear Mask Evaluation
```wgsl
fn smootherstep(t: f32) -> f32 {
    let x = clamp(t, 0.0, 1.0);
    return x * x * x * (x * (x * 6.0 - 15.0) + 10.0);
}

fn evaluate_linear_mask(x: f32, y: f32, mask: LinearMask) -> f32 {
    if (mask.enabled == 0u) {
        return 1.0;  // Neutral (no effect)
    }

    let dx = mask.end_x - mask.start_x;
    let dy = mask.end_y - mask.start_y;
    let len_sq = dx * dx + dy * dy;

    // Degenerate case: start and end are same point
    if (len_sq < 1e-6) {
        return 0.5;
    }

    // Project point onto gradient line
    let t = ((x - mask.start_x) * dx + (y - mask.start_y) * dy) / len_sq;

    // Feathering centered at midpoint
    let feather_zone = 0.5 * clamp(mask.feather, 0.0, 1.0);
    let center = 0.5;

    if (t <= center - feather_zone) {
        return 1.0;
    } else if (t >= center + feather_zone) {
        return 0.0;
    } else {
        let local_t = (t - (center - feather_zone)) / max(2.0 * feather_zone, 0.001);
        return 1.0 - smootherstep(local_t);
    }
}
```

### Complete Radial Mask Evaluation
```wgsl
fn evaluate_radial_mask(x: f32, y: f32, mask: RadialMask) -> f32 {
    if (mask.enabled == 0u) {
        return 1.0;  // Neutral
    }

    // Translate to center
    let dx = x - mask.center_x;
    let dy = y - mask.center_y;

    // Rotate to local ellipse space (inverse rotation)
    let cos_r = cos(mask.rotation);
    let sin_r = sin(mask.rotation);
    let local_x = dx * cos_r + dy * sin_r;
    let local_y = -dx * sin_r + dy * cos_r;

    // Normalized distance (1.0 = on ellipse edge)
    let rx = max(mask.radius_x, 0.001);
    let ry = max(mask.radius_y, 0.001);
    let norm_dist = sqrt((local_x / rx) * (local_x / rx) + (local_y / ry) * (local_y / ry));

    // Inner boundary based on feather
    let inner = 1.0 - clamp(mask.feather, 0.0, 1.0);

    var value = 1.0;
    if (norm_dist > inner) {
        if (norm_dist >= 1.0) {
            value = 0.0;
        } else {
            let t = (norm_dist - inner) / max(1.0 - inner, 0.001);
            value = 1.0 - smootherstep(t);
        }
    }

    // Apply invert
    if (mask.invert > 0u) {
        value = 1.0 - value;
    }

    return value;
}
```

---

## 6. Performance Considerations

### Estimated Performance (2560×1440 preview)
| Operation | Current (WASM) | Target (GPU) | Improvement |
|-----------|----------------|--------------|-------------|
| 1 linear mask | ~25ms | ~2ms | 12x |
| 1 radial mask | ~30ms | ~2ms | 15x |
| 4 masks combined | ~100ms | ~4ms | 25x |
| With per-mask adjustments | +50ms | +2ms | 25x |

### Optimization Strategies
1. **Early exit**: Skip disabled masks (check `enabled` flag first)
2. **Loop unrolling**: Use `const MAX_MASKS = 8` with early break
3. **Texture caching**: Reuse input/output textures via TexturePool
4. **GPU chaining**: Use `applyToTextures()` to keep data on GPU
5. **Batch operations**: Process all masks in single dispatch when possible

### Memory Bandwidth
- Per-pixel: ~50 math ops per mask (manageable)
- Texture sampling: Hardware cached (good 2D locality)
- 16×16 workgroup: Optimal for image processing

---

## 7. Implementation Phases

### Phase 4.1: WGSL Shader Implementation
- [ ] Create `masks.wgsl` with linear and radial evaluation functions
- [ ] Add smootherstep implementation
- [ ] Implement mask blending with per-mask adjustments
- [ ] Export shader source from `shaders/index.ts`

### Phase 4.2: Pipeline Wrapper
- [ ] Create `MaskPipeline` class following existing pattern
- [ ] Implement `apply()` for CPU↔GPU transfers
- [ ] Implement `applyToTextures()` for GPU chaining
- [ ] Add uniform buffer management for mask parameters

### Phase 4.3: Service Layer
- [ ] Create `GPUMaskService` with singleton pattern
- [ ] Implement RGB↔RGBA conversion (matching adjustments service)
- [ ] Add `applyMaskedAdjustmentsAdaptive()` wrapper
- [ ] Register 'masks' operation in AdaptiveProcessor

### Phase 4.4: Integration
- [ ] Update `useEditPreview.ts` to use adaptive mask function
- [ ] Test GPU mask chaining with existing GPU operations
- [ ] Add performance benchmarking

### Phase 4.5: Testing
- [ ] Unit tests for mask evaluation accuracy
- [ ] Integration tests for pipeline chaining
- [ ] E2E tests with demo mode mocking

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Shader compilation issues | Low | Medium | Validate WGSL syntax early |
| Numeric precision differences | Medium | Low | Use same formulas as Rust |
| Memory alignment errors | Medium | High | Follow struct packing rules strictly |
| Performance regression | Low | Medium | Adaptive fallback to WASM |
| Loop unrolling overhead | Low | Low | Use const bounds with early break |

---

## 9. Success Criteria

Research is complete. Implementation can proceed when:

1. ✅ Exact mathematical formulas documented (smootherstep, linear, radial)
2. ✅ WGSL shader structure designed (fixed-size arrays, uniform buffer layout)
3. ✅ Pipeline wrapper pattern defined (following adjustments/tone-curve)
4. ✅ Service interface specified (matching existing GPU services)
5. ✅ Integration points identified (useEditPreview.ts, types.ts)
6. ✅ Performance targets set (25x speedup for 2 masks)

---

## Conclusion

The research confirms GPU gradient mask implementation is straightforward using established patterns:

1. **WGSL has all necessary capabilities** - smoothstep, trig, vector math all built-in
2. **Pipeline architecture is proven** - Same pattern as adjustments/tone-curve
3. **Integration is minimal** - Add service, wire into useEditPreview
4. **Fallback is seamless** - Adaptive processor handles GPU/WASM selection

Estimated effort: 3-4 iterations for complete implementation and testing.

Next step: Create implementation plan with specific code changes per phase.
