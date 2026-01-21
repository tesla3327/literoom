# Crop/Rotate/Straighten: Research Synthesis

**Date**: 2026-01-21
**Status**: Complete
**Phase**: 12 - Crop/Rotate/Straighten

---

## Executive Summary

This document synthesizes research from five areas to provide a comprehensive implementation guide for crop, rotate, and straighten functionality in Literoom.

### Key Decisions

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| Transform order | Rotate -> Crop -> Adjustments -> Tone Curve | Standard photography workflow |
| Implementation | WASM (Rust) for rotation and crop | Performance (600ms vs 800ms+) |
| Straighten calc | JavaScript | Simple math, UI action |
| Crop representation | `null` = no crop | Clear semantics, optimization |
| Coordinates | Normalized (0-1) | Image-size independent |
| Aspect lock | UI state only | Not part of edit output |

---

## 1. Architecture Overview

### Data Flow

```
User Interaction (Canvas)
         |
    Edit Store (state)
         |
    Preview Pipeline
         |
    WASM Worker
         |
    Canvas Display
```

### Transform Pipeline Order

```
Source Image
     |
[1] ROTATION - Apply angle with interpolation
     |
[2] CROP - Extract region from rotated image
     |
[3] ADJUSTMENTS - 10 sliders
     |
[4] TONE CURVE - LUT application
     |
Output
```

**Why this order:**
- User sees straightened image before cropping
- Crop bounds don't rotate with image
- Matches Lightroom/Capture One workflow

---

## 2. TypeScript Types

### Core Types

```typescript
interface CropRectangle {
  left: number    // 0-1
  top: number     // 0-1
  width: number   // 0-1
  height: number  // 0-1
}

interface RotationParameters {
  angle: number      // -180 to 180
  straighten: number // Additional straighten angle
}

interface CropTransform {
  crop: CropRectangle | null
  rotation: RotationParameters
}

const DEFAULT_CROP_TRANSFORM: CropTransform = {
  crop: null,
  rotation: { angle: 0, straighten: 0 }
}
```

### EditState Extension

```typescript
const EDIT_SCHEMA_VERSION = 3  // Bump from 2

interface EditState {
  version: typeof EDIT_SCHEMA_VERSION
  adjustments: Adjustments
  toneCurve: ToneCurve
  cropTransform: CropTransform
}
```

---

## 3. Implementation Strategy

### Phase 12.1: TypeScript Types

**Files:**
- `packages/core/src/catalog/types.ts`

**Changes:**
- Add `CropRectangle`, `RotationParameters`, `CropTransform`
- Add `DEFAULT_CROP_TRANSFORM`
- Add `isModifiedCropTransform()`
- Extend `EditState` with `cropTransform`
- Bump `EDIT_SCHEMA_VERSION` to 3

### Phase 12.2: Edit Store

**Files:**
- `apps/web/app/stores/edit.ts`

**Changes:**
- Add `cropTransform` ref
- Add `setCropTransform()`, `setCrop()`, `setRotation()` actions
- Update `hasModifications` computed
- Update `reset()` to reset transforms

### Phase 12.3: Rust Implementation

**Files:**
- `crates/literoom-core/src/transform/mod.rs` (new)
- `crates/literoom-core/src/transform/rotation.rs` (new)
- `crates/literoom-core/src/transform/crop.rs` (new)
- `crates/literoom-wasm/src/transform.rs` (new)

**Functions:**
```rust
pub fn apply_rotation(image, angle, filter) -> JsDecodedImage
pub fn apply_crop(image, left, top, width, height) -> JsDecodedImage
```

### Phase 12.4: Worker Integration

**Files:**
- `packages/core/src/decode/worker-messages.ts`
- `packages/core/src/decode/decode-worker.ts`
- `packages/core/src/decode/decode-service.ts`

**Changes:**
- Add `ApplyRotationRequest`, `ApplyCropRequest` message types
- Add handler cases in worker
- Add `applyRotation()`, `applyCrop()` to service interface

### Phase 12.5: Preview Integration

**Files:**
- `apps/web/app/composables/useEditPreview.ts`

**Changes:**
- Add rotation step before adjustments
- Add crop step after rotation
- Watch `cropTransform` for re-renders

### Phase 12.6: UI Components

**New Files:**
- `apps/web/app/composables/useCropEditor.ts`
- `apps/web/app/components/edit/EditCropEditor.vue`
- `apps/web/app/components/edit/EditRotationControls.vue`
- `apps/web/app/components/edit/EditStraightenControl.vue`

**Update:**
- `apps/web/app/components/edit/EditControlsPanel.vue` - Wire new components

---

## 4. Mathematics Reference

### Rotation

```typescript
// Rotate point around pivot
function rotatePoint(p: Point, pivot: Point, angle: number): Point {
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const dx = p.x - pivot.x
  const dy = p.y - pivot.y
  return {
    x: dx * cos - dy * sin + pivot.x,
    y: dx * sin + dy * cos + pivot.y
  }
}
```

### Bounding Box After Rotation

```typescript
function rotatedBounds(w: number, h: number, angle: number): Size {
  const cos = Math.abs(Math.cos(angle))
  const sin = Math.abs(Math.sin(angle))
  return {
    width: w * cos + h * sin,
    height: w * sin + h * cos
  }
}
```

### Straighten Angle

```typescript
function straightenAngle(p1: Point, p2: Point): number {
  return -Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180 / Math.PI
}
```

---

## 5. UI Patterns

### Crop Overlay

1. Semi-transparent dark overlay on entire image
2. Clear crop region to reveal bright area
3. Rule of thirds grid inside crop
4. 8 draggable handles (corners + edges)

### Aspect Ratio

- Presets: Original, 1:1, 4:5, 16:9
- Lock/unlock toggle
- UI state only (not persisted)

### Rotation Controls

- Slider: -45deg to +45deg
- 90deg rotation buttons (CW/CCW)
- Numeric input for precise angle

### Straighten Tool

- User draws line on horizon
- System calculates angle
- Applies rotation to level image

---

## 6. Performance Targets

| Operation | Target Time |
|-----------|-------------|
| Preview rotation (bilinear) | <200ms |
| Export rotation (lanczos3) | <600ms |
| Crop | <10ms |
| Full preview update | <500ms |
| Full export (6000x4000) | <1000ms |

---

## 7. Copy/Paste Integration

Per spec section 3.6, crop/transform is one checkbox group:

```typescript
// Paste dialog checkboxes
- [ ] Basic Adjustments
- [ ] Tone Curve
- [x] Crop/Transform  // NEW
- [ ] Masks
```

---

## 8. Validation

### Invariants

- `crop.left + crop.width <= 1`
- `crop.top + crop.height <= 1`
- `crop.width > 0 && crop.height > 0`
- `abs(rotation.angle) <= 180`
- Crop valid after rotation: validate at export time

---

## 9. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Rotation performance | Use bilinear for preview, lanczos3 for export |
| Memory usage (large images) | Rotation + crop in single pass |
| Crop invalidated by rotation | Validate at export, auto-adjust if needed |
| Schema migration | Versioned EditState, migration function |

---

## 10. Testing Strategy

### Unit Tests

- `isModifiedCropTransform()` utility
- `validateCropTransform()` utility
- Coordinate conversion functions
- Rotation math functions

### Integration Tests

- Store state changes
- Worker message handling
- Preview pipeline with transforms

### E2E Tests

- Crop overlay interaction
- Rotation slider adjustment
- Straighten tool line drawing
- Copy/paste with crop settings

---

## Related Research Documents

- [Area 1: Mathematics](./2026-01-21-crop-rotate-area-1-mathematics.md)
- [Area 2: Codebase Review](./2026-01-21-crop-rotate-area-2-codebase-review.md)
- [Area 3: Canvas UI](./2026-01-21-crop-rotate-area-3-canvas-ui.md)
- [Area 4: Export Pipeline](./2026-01-21-crop-rotate-area-4-export.md)
- [Area 5: State Management](./2026-01-21-crop-rotate-area-5-state.md)

---

## Next Steps

1. Create implementation plan with detailed phases
2. Start with Phase 12.1: TypeScript types
3. Proceed through phases sequentially
4. Test each phase before moving to next
