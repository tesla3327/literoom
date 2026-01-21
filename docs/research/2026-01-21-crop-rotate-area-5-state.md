# Crop/Rotate/Straighten: State Management

**Date**: 2026-01-21
**Status**: Complete
**Scope**: Area 5 - State management patterns

---

## 1. TypeScript Types

### Core Types

```typescript
/**
 * Crop rectangle with normalized coordinates (0-1).
 */
export interface CropRectangle {
  left: number    // 0-1, left edge
  top: number     // 0-1, top edge
  width: number   // 0-1, crop width
  height: number  // 0-1, crop height
}

/**
 * Rotation parameters.
 */
export interface RotationParameters {
  angle: number      // -180 to 180 degrees
  straighten: number // Additional straighten angle
}

/**
 * Complete crop/transform state.
 */
export interface CropTransform {
  crop: CropRectangle | null  // null = no crop (full image)
  rotation: RotationParameters
}
```

### Default Values

```typescript
export const DEFAULT_CROP_TRANSFORM: Readonly<CropTransform> = Object.freeze({
  crop: null,
  rotation: {
    angle: 0,
    straighten: 0,
  },
})
```

### Modification Detection

```typescript
export function isModifiedCropTransform(transform: CropTransform): boolean {
  if (transform.crop !== null) return true
  if (transform.rotation.angle !== 0) return true
  if (transform.rotation.straighten !== 0) return true
  return false
}
```

---

## 2. Extended EditState

```typescript
export const EDIT_SCHEMA_VERSION = 3  // Bump from 2

export interface EditState {
  version: typeof EDIT_SCHEMA_VERSION
  adjustments: Adjustments
  toneCurve: ToneCurve
  cropTransform: CropTransform
}

export function createDefaultEditState(): EditState {
  return {
    version: EDIT_SCHEMA_VERSION,
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    toneCurve: { points: [...DEFAULT_TONE_CURVE.points] },
    cropTransform: { ...DEFAULT_CROP_TRANSFORM },
  }
}
```

---

## 3. Aspect Ratio Lock (UI State Only)

### Not Persisted

Aspect ratio lock is UI preference, not part of edit output:

```typescript
// In separate editUI store
interface AspectRatioLockState {
  isLocked: boolean
  mode: 'free' | 'original' | '1:1' | '4:5' | '16:9' | 'custom'
  custom?: { width: number, height: number }
}
```

### Rationale

- Not part of final edit output
- When pasting crop settings, copy actual rectangle, not lock state
- Matches how tone curve editor's state isn't persisted

---

## 4. Copy/Paste Behavior

### Spec Section 3.6: Checkbox Groups

```typescript
interface ClipboardSettings {
  adjustments: boolean
  toneCurve: boolean
  cropTransform: boolean  // NEW
  masks: boolean

  data: {
    adjustments?: Adjustments
    toneCurve?: ToneCurve
    cropTransform?: CropTransform
  }
}
```

### Implementation

```typescript
// Copy
function handleCopy(): void {
  const clipboard: ClipboardSettings = {
    adjustments: true,
    toneCurve: true,
    cropTransform: true,
    masks: false,
    data: {
      adjustments: { ...editStore.adjustments },
      toneCurve: { ...editStore.toneCurve },
      cropTransform: { ...editStore.cropTransform },
    },
  }
  localStorage.setItem('literoom-clipboard', JSON.stringify(clipboard))
}

// Paste
function handlePaste(checkboxes: PasteCheckboxes): void {
  const clipboard = JSON.parse(localStorage.getItem('literoom-clipboard'))

  if (checkboxes.includeAdjustments && clipboard.data.adjustments) {
    editStore.setAdjustments(clipboard.data.adjustments)
  }
  if (checkboxes.includeToneCurve && clipboard.data.toneCurve) {
    editStore.setToneCurve(clipboard.data.toneCurve)
  }
  if (checkboxes.includeCropTransform && clipboard.data.cropTransform) {
    editStore.setCropTransform(clipboard.data.cropTransform)
  }
}
```

---

## 5. Validation

### Invariants

```typescript
function validateCropTransform(transform: CropTransform): string | null {
  // Rotation validation
  const totalAngle = transform.rotation.angle + transform.rotation.straighten
  if (Math.abs(totalAngle) > 180) {
    return 'Total rotation must be between -180 and 180 degrees'
  }

  // No crop = always valid
  if (transform.crop === null) return null

  const crop = transform.crop

  // Bounds checking
  if (crop.left < 0 || crop.left > 1) return 'Invalid crop left'
  if (crop.top < 0 || crop.top > 1) return 'Invalid crop top'
  if (crop.width <= 0 || crop.width > 1) return 'Invalid crop width'
  if (crop.height <= 0 || crop.height > 1) return 'Invalid crop height'

  // Ensure within bounds
  if (crop.left + crop.width > 1) return 'Crop extends beyond image'
  if (crop.top + crop.height > 1) return 'Crop extends beyond image'

  return null
}
```

### Key Invariants Table

| Invariant | Enforcement |
|-----------|-------------|
| `crop === null` OR valid bounds | Validate on setCrop() |
| `left + width <= 1` | Validate on setCrop() |
| `top + height <= 1` | Validate on setCrop() |
| `abs(angle) <= 180` | Validate on setRotation() |
| Crop valid after rotation | Validate at export time |

---

## 6. Edit Store Integration

### Store Extension

```typescript
export const useEditStore = defineStore('edit', () => {
  // Existing
  const currentAssetId = ref<string | null>(null)
  const adjustments = ref<Adjustments>({ ...DEFAULT_ADJUSTMENTS })
  const toneCurve = ref<ToneCurve>({ points: [...DEFAULT_TONE_CURVE.points] })
  const isDirty = ref(false)

  // NEW
  const cropTransform = ref<CropTransform>({ ...DEFAULT_CROP_TRANSFORM })

  // Updated computed
  const hasModifications = computed(() =>
    hasModifiedAdjustments(adjustments.value) ||
    isModifiedToneCurve(toneCurve.value) ||
    isModifiedCropTransform(cropTransform.value)
  )

  // NEW actions
  function setCropTransform(transform: CropTransform): void {
    cropTransform.value = {
      crop: transform.crop ? { ...transform.crop } : null,
      rotation: { ...transform.rotation },
    }
    isDirty.value = true
  }

  function setCrop(crop: CropRectangle | null): void {
    cropTransform.value = {
      ...cropTransform.value,
      crop: crop ? { ...crop } : null,
    }
    isDirty.value = true
  }

  function setRotation(rotation: RotationParameters): void {
    cropTransform.value = {
      ...cropTransform.value,
      rotation: { ...rotation },
    }
    isDirty.value = true
  }

  // Updated reset
  function reset(): void {
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    toneCurve.value = { points: [...DEFAULT_TONE_CURVE.points] }
    cropTransform.value = { ...DEFAULT_CROP_TRANSFORM }
    isDirty.value = true
  }

  return {
    // State
    currentAssetId, adjustments, toneCurve, cropTransform, isDirty,
    // Computed
    hasModifications,
    // Actions
    setCropTransform, setCrop, setRotation, reset,
  }
})
```

---

## 7. Default Value Semantics

### No Crop = null

```typescript
// No crop (full image)
const noCrop: CropTransform = {
  crop: null,
  rotation: { angle: 0, straighten: 0 }
}

// Full-image explicit crop (equivalent at export)
const fullCrop: CropTransform = {
  crop: { left: 0, top: 0, width: 1, height: 1 },
  rotation: { angle: 0, straighten: 0 }
}
```

### Why null?

- Clear semantics: null = "no crop applied"
- Optimization at export: skip processing if null
- Matches Lightroom model
- Simplifies isModified check

---

## 8. Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/catalog/types.ts` | Add CropTransform types, bump version to 3 |
| `apps/web/app/stores/edit.ts` | Add cropTransform state + actions |
| Optional: `apps/web/app/stores/editUI.ts` | UI-only aspect lock state |

---

## 9. Migration Strategy

```typescript
function migrateEditState(state: EditState): EditState {
  // Version 2 -> 3: Add cropTransform
  if (state.version === 2) {
    return {
      ...state,
      version: 3,
      cropTransform: DEFAULT_CROP_TRANSFORM,
    }
  }
  return state
}
```
