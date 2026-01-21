# Crop/Rotate/Straighten: Export Pipeline Integration

**Date**: 2026-01-21
**Status**: Complete
**Scope**: Area 4 - Export pipeline integration

---

## 1. Transform Order

### Recommended: Rotate -> Crop -> Adjustments -> Tone Curve

```
Input Image
    |
[ROTATION] - Apply rotation angle with interpolation
    |
[CROP] - Extract crop region from rotated image
    |
[ADJUSTMENTS] - Apply 10 adjustment sliders
    |
[TONE CURVE] - Apply curve LUT
    |
Final Output
```

### Rationale

- Standard photography workflow (Lightroom, Capture One)
- User straightens first, then crops based on leveled image
- Crop operates on rotated pixels, not original
- Simpler UI (crop overlay doesn't rotate)

---

## 2. WASM vs JavaScript

### Rotation: WASM (Rust)

**Why:**
- Requires interpolation (bilinear/bicubic) for quality
- Large images rotate slowly in JavaScript (6000x4000 = 800ms+)
- WASM: ~150-200ms for same operation
- Worker thread isolation prevents UI blocking

### Crop: WASM (Rust)

**Why:**
- Just memory extraction (fast)
- Can combine with rotation in single pass
- Follows established pipeline pattern

### Straighten Calculation: JavaScript

**Why:**
- Simple math: `angle = atan2(dy, dx)`
- UI action (user draws line)
- Real-time preview as user adjusts
- No WASM changes needed

---

## 3. Export Pipeline Flow

```typescript
async function exportImage(
  asset: Asset,
  editState: EditState,
  options: ExportOptions
): Promise<Blob> {
  // 1. Load full-resolution image
  const sourcePixels = await loadFullResolution(asset)

  // 2. Apply rotation (if any)
  let currentPixels = sourcePixels
  if (editState.cropTransform.rotation.angle !== 0) {
    currentPixels = await $decodeService.applyRotation(
      currentPixels,
      editState.cropTransform.rotation
    )
  }

  // 3. Apply crop (if any)
  if (editState.cropTransform.crop !== null) {
    currentPixels = await $decodeService.applyCrop(
      currentPixels,
      editState.cropTransform.crop
    )
  }

  // 4. Apply adjustments
  currentPixels = await $decodeService.applyAdjustments(
    currentPixels,
    editState.adjustments
  )

  // 5. Apply tone curve
  if (isModifiedToneCurve(editState.adjustments.toneCurve)) {
    currentPixels = await $decodeService.applyToneCurve(
      currentPixels,
      editState.adjustments.toneCurve
    )
  }

  // 6. Encode to JPEG
  return await encodeJpeg(currentPixels, options.quality)
}
```

---

## 4. Performance Characteristics

### Full Export (6000x4000 RAW)

| Operation | Time | Notes |
|-----------|------|-------|
| Decode RAW | 40ms | Fast path (thumbnail) |
| Rotate 5deg (lanczos3) | 600ms | Bottleneck |
| Crop to 4000x3000 | 5ms | Memory extraction |
| Apply adjustments | 150ms | Per-pixel ops |
| Apply tone curve | 80ms | LUT lookup |
| Encode JPEG | 100ms | libjpeg-turbo |
| **Total** | **~975ms** | Under 1 second |

### Optimization Strategies

1. **Draft quality** during preview: bilinear (200ms)
2. **Full quality** for export: lanczos3 (600ms)
3. **Skip rotation** if angle is 0

---

## 5. Rotation Implementation

### Bounding Box Expansion

When rotating, output is larger than input:

```typescript
// 6000x4000 rotated 5deg
// cos(5) = 0.9962, sin(5) = 0.0872
// new_width = 6000 * 0.9962 + 4000 * 0.0872 = 6326px
// new_height = 6000 * 0.0872 + 4000 * 0.9962 = 4508px
```

### Interpolation Quality

- **Nearest neighbor**: Fast, poor quality
- **Bilinear**: Fast (200ms), good for small angles
- **Lanczos3**: Slower (600ms), best quality

### Edge Handling

Options for empty corners after rotation:
1. Black fill (default)
2. White fill
3. Extend edges
4. Transparency (PNG only)

---

## 6. Crop Implementation

### Normalized Coordinates

Store crop as percentages (0-1) for image-size independence:

```typescript
interface CropRectangle {
  left: number   // 0-1
  top: number    // 0-1
  width: number  // 0-1
  height: number // 0-1
}
```

### Validation

```typescript
function validateCrop(crop: CropRectangle): boolean {
  return (
    crop.left >= 0 && crop.left <= 1 &&
    crop.top >= 0 && crop.top <= 1 &&
    crop.width > 0 && crop.width <= 1 &&
    crop.height > 0 && crop.height <= 1 &&
    crop.left + crop.width <= 1 &&
    crop.top + crop.height <= 1
  )
}
```

---

## 7. Worker Message Types

### New Request Types

```typescript
interface ApplyRotationRequest {
  id: string
  type: 'apply-rotation'
  pixels: Uint8Array
  width: number
  height: number
  angle: number // degrees
  filter: 'nearest' | 'bilinear' | 'lanczos3'
}

interface ApplyCropRequest {
  id: string
  type: 'apply-crop'
  pixels: Uint8Array
  width: number
  height: number
  cropLeft: number   // normalized 0-1
  cropTop: number    // normalized 0-1
  cropWidth: number  // normalized 0-1
  cropHeight: number // normalized 0-1
}
```

---

## 8. Memory Considerations

### Peak Memory During Rotation

```
Input: 6000x4000 RGB = 72MB
Output: 6326x4508 RGB = 85.8MB
WASM overhead: ~10MB
Total: ~170MB (acceptable)
```

### Optimization: Combined Pass

```rust
// Single function that rotates and crops in one pass
pub fn apply_rotation_and_crop(
    image: &JsDecodedImage,
    angle: f32,
    crop: Option<CropRect>,
) -> JsDecodedImage {
    // Rotate only the pixels that will be kept
    // Avoids intermediate full-size buffer
}
```

---

## 9. No Breaking Changes

### EditState Extension

```typescript
export interface EditState {
  version: typeof EDIT_SCHEMA_VERSION  // 2 -> 3
  adjustments: Adjustments
  cropTransform?: CropTransform | null  // Optional for backward compat
}
```

### Migration

```typescript
function migrateEditState(state: EditState): EditState {
  if (state.version === 2) {
    return {
      ...state,
      version: 3,
      cropTransform: null,  // Default: no crop
    }
  }
  return state
}
```

---

## 10. Rust Implementation Strategy

### New Modules

```
crates/literoom-core/src/
  transform/
    mod.rs
    rotation.rs  - apply_rotation()
    crop.rs      - apply_crop()
```

### WASM Bindings

```rust
// crates/literoom-wasm/src/transform.rs
#[wasm_bindgen]
pub fn apply_rotation(
    image: &JsDecodedImage,
    angle_degrees: f32,
    filter: u8,
) -> Result<JsDecodedImage, JsValue>

#[wasm_bindgen]
pub fn apply_crop(
    image: &JsDecodedImage,
    left: f32,
    top: f32,
    width: f32,
    height: f32,
) -> Result<JsDecodedImage, JsValue>
```
