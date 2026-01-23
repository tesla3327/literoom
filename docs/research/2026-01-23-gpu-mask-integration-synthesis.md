# GPU Mask Integration Research Synthesis

**Date**: 2026-01-23
**Objective**: Integrate GPUMaskService into useEditPreview.ts for GPU-accelerated mask processing

## Executive Summary

The integration is straightforward. Replace the direct WASM call with the adaptive function that automatically selects GPU/WASM backend.

## Current Implementation

### useEditPreview.ts (Lines 590-625)

The masked adjustments step is STEP 5 in the render pipeline:

```typescript
// ===== STEP 5: Apply masked adjustments (local adjustments) =====
if (hasMasks && editStore.masks) {
  const maskStack: MaskStackData = {
    linearMasks: editStore.masks.linearMasks.map(m => ({
      startX: m.start.x,
      startY: m.start.y,
      endX: m.end.x,
      endY: m.end.y,
      feather: m.feather,
      enabled: m.enabled,
      adjustments: m.adjustments,
    })),
    radialMasks: editStore.masks.radialMasks.map(m => ({
      centerX: m.center.x,
      centerY: m.center.y,
      radiusX: m.radiusX,
      radiusY: m.radiusY,
      rotation: m.rotation,
      feather: m.feather,
      invert: m.invert,
      enabled: m.enabled,
      adjustments: m.adjustments,
    })),
  }

  const maskedResult = await $decodeService.applyMaskedAdjustments(
    currentPixels,
    currentWidth,
    currentHeight,
    maskStack,
  )
  currentPixels = maskedResult.pixels
  currentWidth = maskedResult.width
  currentHeight = maskedResult.height
}
```

### Pipeline Order

```
Rotate → Crop → Adjustments → Tone Curve → Masked Adjustments → Display
```

## GPUMaskService Interface

### applyMaskedAdjustmentsAdaptive Function

**File**: `packages/core/src/gpu/gpu-mask-service.ts` (Lines 301-335)

```typescript
export async function applyMaskedAdjustmentsAdaptive(
  pixels: Uint8Array,
  width: number,
  height: number,
  maskStack: MaskStackData,
  wasmFallback: () => Promise<DecodedImage>
): Promise<{ result: DecodedImage; backend: 'webgpu' | 'wasm'; timing: number }>
```

**Behavior**:
1. Gets GPUMaskService singleton
2. If GPU is ready: tries GPU path, catches errors, falls back to WASM
3. Returns result with timing and backend info for telemetry

### Type Conversion

The GPUMaskService handles all type conversions internally:
- `toGPUMaskAdjustments()`: Converts Adjustments → GPUMaskAdjustments
- `toGPUMaskStack()`: Converts MaskStackData → MaskStackInput
- Radial mask rotation: degrees → radians (handled internally)

## Integration Plan

### Changes Required

1. **Import** `applyMaskedAdjustmentsAdaptive` from `@literoom/core`
2. **Replace** direct `$decodeService.applyMaskedAdjustments()` call
3. **Provide** WASM fallback as lambda function

### Code Change

**Before**:
```typescript
const maskedResult = await $decodeService.applyMaskedAdjustments(
  currentPixels,
  currentWidth,
  currentHeight,
  maskStack,
)
```

**After**:
```typescript
const { result: maskedResult, backend, timing } = await applyMaskedAdjustmentsAdaptive(
  currentPixels,
  currentWidth,
  currentHeight,
  maskStack,
  () => $decodeService.applyMaskedAdjustments(currentPixels, currentWidth, currentHeight, maskStack)
)

// Optional: Log backend info for debugging
console.log(`[useEditPreview] Masked adjustments via ${backend} in ${timing.toFixed(1)}ms`)
```

## Error Handling

The adaptive function handles all errors gracefully:
- GPU initialization failures → falls back to WASM
- GPU processing errors → catches, logs warning, falls back to WASM
- No enabled masks → early exit (optimization in both GPU and WASM paths)

## Performance Expectations

| Backend | Expected Time (2560x1440, 2 masks) |
|---------|-----------------------------------|
| WASM | ~100ms |
| WebGPU | ~4ms |
| Speedup | 25x |

## Testing Strategy

1. **Functional**: Verify masks render correctly with GPU enabled/disabled
2. **Fallback**: Verify WASM fallback works when GPU unavailable
3. **Performance**: Log backend and timing to verify GPU is being used

## Files to Modify

1. `apps/web/app/composables/useEditPreview.ts` - Add import and replace call

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| GPU path produces different output | Low | Shaders match Rust exactly |
| GPU initialization race condition | Low | Service handles lazy init |
| Memory issues with large images | Low | GPU has texture size limits |

## Conclusion

This is a minimal, low-risk change that enables GPU acceleration for masked adjustments with automatic WASM fallback. The integration follows the established pattern from other GPU services.
