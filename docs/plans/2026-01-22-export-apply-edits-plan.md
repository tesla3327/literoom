# Export Apply Edits - Implementation Plan

## Date: 2026-01-22

## Objective
Fix the critical bug where exported images don't include edits (adjustments, tone curve, crop, rotation, masks).

## Problem Summary
Two root causes:
1. `getEditState()` returns `null` for any asset not currently being viewed
2. Masked adjustments are not included in the export pipeline at all

## Implementation Phases

### Phase 1: Add Masked Adjustments to Export Types

**Files to modify**:
- `packages/core/src/export/types.ts`

**Changes**:
1. Add `masks?: MaskStack` to `ExportEditState` interface (after line 117)
2. Add `applyMaskedAdjustments` to `ExportServiceDependencies` interface

```typescript
// ExportEditState
export interface ExportEditState {
  adjustments?: Adjustments
  toneCurve?: ToneCurve
  crop?: CropRectangle | null
  rotation?: RotationParameters
  masks?: MaskStack  // NEW
}

// ExportServiceDependencies - add new method
applyMaskedAdjustments: (
  pixels: Uint8Array,
  width: number,
  height: number,
  maskStack: MaskStack
) => Promise<{ data: Uint8Array; width: number; height: number }>
```

### Phase 2: Add Masked Adjustments Step to Export Service

**Files to modify**:
- `packages/core/src/export/export-service.ts`

**Changes**:
1. Import `MaskStack` type
2. Add masked adjustments step in `applyEdits()` after tone curve (around line 270)

```typescript
// After tone curve application (line 270)
// Apply masked adjustments
if (editState.masks) {
  const hasEnabledMasks =
    (editState.masks.linearMasks?.some(m => m.enabled)) ||
    (editState.masks.radialMasks?.some(m => m.enabled))

  if (hasEnabledMasks) {
    result = await this.deps.applyMaskedAdjustments(
      result.data,
      result.width,
      result.height,
      editState.masks
    )
  }
}
```

### Phase 3: Add Edit State Caching to Edit Store

**Files to modify**:
- `apps/web/app/stores/edit.ts`

**Changes**:
1. Add `editCache: Map<string, EditState>` ref
2. Modify `loadForAsset()` to:
   - Save current edits to cache before switching
   - Load from cache if available, otherwise use defaults
3. Add `getEditStateForAsset(assetId: string)` method to retrieve from cache
4. Modify auto-save to update cache

```typescript
// New state
const editCache = ref<Map<string, EditState>>(new Map())

// New method
function getEditStateForAsset(assetId: string): EditState | null {
  return editCache.value.get(assetId) || null
}

// Modified loadForAsset
async function loadForAsset(assetId: string): Promise<void> {
  // Save current to cache before switching
  if (currentAssetId.value && isDirty.value) {
    editCache.value.set(currentAssetId.value, {
      version: EDIT_SCHEMA_VERSION,
      adjustments: { ...adjustments.value },
      cropTransform: cloneCropTransform(cropTransform.value),
      masks: masks.value ? cloneMaskStack(masks.value) : undefined,
    })
  }

  currentAssetId.value = assetId

  // Load from cache if available
  const cached = editCache.value.get(assetId)
  if (cached) {
    adjustments.value = { ...cached.adjustments }
    cropTransform.value = cloneCropTransform(cached.cropTransform)
    masks.value = cached.masks ? cloneMaskStack(cached.masks) : null
  } else {
    // Initialize with defaults
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    cropTransform.value = cloneCropTransform(DEFAULT_CROP_TRANSFORM)
    masks.value = null
  }

  selectedMaskId.value = null
  isDirty.value = false
}
```

### Phase 4: Wire Up Export Dependencies

**Files to modify**:
- `apps/web/app/composables/useExport.ts`

**Changes**:
1. Add `applyMaskedAdjustments` to dependencies object
2. Update `getEditState()` to use cache and include masks
3. Import required types

```typescript
// Update getEditState to use cache
async function getEditState(assetId: string): Promise<ExportEditState | null> {
  // Check if current asset
  if (editStore.currentAssetId === assetId) {
    const state = editStore.editState
    return {
      adjustments: state.adjustments,
      toneCurve: state.adjustments.toneCurve,
      crop: state.cropTransform.crop,
      rotation: state.cropTransform.rotation,
      masks: state.masks,  // NEW
    }
  }

  // Try to get from cache
  const cached = editStore.getEditStateForAsset(assetId)
  if (cached) {
    return {
      adjustments: cached.adjustments,
      toneCurve: cached.adjustments.toneCurve,
      crop: cached.cropTransform.crop,
      rotation: cached.cropTransform.rotation,
      masks: cached.masks,  // NEW
    }
  }

  return null
}

// Add to dependencies object
const dependencies: ExportServiceDependencies = {
  // ... existing dependencies ...

  applyMaskedAdjustments: async (pixels, width, height, maskStack) => {
    const result = await decodeService.applyMaskedAdjustments(
      pixels, width, height, maskStack
    )
    return adaptDecodedImage(result)
  },
}
```

### Phase 5: Ensure Edit Cache Updates on Changes

**Files to modify**:
- `apps/web/app/stores/edit.ts`

**Changes**:
1. Add watcher or method to update cache when edits change
2. Ensure dirty flag triggers cache update

```typescript
// Update cache when marking dirty or on specific actions
function markDirty(): void {
  isDirty.value = true
  // Also update cache with current state
  if (currentAssetId.value) {
    editCache.value.set(currentAssetId.value, {
      version: EDIT_SCHEMA_VERSION,
      adjustments: { ...adjustments.value },
      cropTransform: cloneCropTransform(cropTransform.value),
      masks: masks.value ? cloneMaskStack(masks.value) : undefined,
    })
  }
}
```

## Testing Plan

### Unit Tests
1. Test `getEditStateForAsset()` returns cached edits
2. Test `loadForAsset()` saves current to cache
3. Test `loadForAsset()` loads from cache
4. Test export dependencies include `applyMaskedAdjustments`

### Manual Testing
1. Open demo mode
2. Enter edit view for image 1
3. Make adjustments (exposure, contrast, etc.)
4. Navigate to image 2 in filmstrip
5. Make different adjustments
6. Navigate back to image 1 - verify edits are restored
7. Export both images
8. Verify exported images include respective edits

### Edge Cases
- Export immediately after editing (current asset only)
- Export after switching between multiple assets
- Export with masks applied
- Export with crop/rotation
- Export with tone curve adjustments

## Files Summary

| File | Changes |
|------|---------|
| `packages/core/src/export/types.ts` | Add masks to ExportEditState, add applyMaskedAdjustments to deps |
| `packages/core/src/export/export-service.ts` | Add masked adjustments step in applyEdits() |
| `apps/web/app/stores/edit.ts` | Add editCache, getEditStateForAsset, update loadForAsset |
| `apps/web/app/composables/useExport.ts` | Wire up applyMaskedAdjustments, update getEditState |

## Success Criteria
- [ ] Exported images include basic adjustments
- [ ] Exported images include tone curve
- [ ] Exported images include crop and rotation
- [ ] Exported images include masked adjustments
- [ ] Edits persist in session when switching between images
- [ ] Export works for multiple images, not just current
- [ ] All existing tests pass
