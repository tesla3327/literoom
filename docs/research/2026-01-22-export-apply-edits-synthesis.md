# Export Doesn't Apply Edits - Research Synthesis

## Date: 2026-01-22

## Executive Summary

The export feature has **two critical bugs** that cause exported images to be unedited:

1. **Edit State Persistence Not Implemented**: `getEditState()` only returns edits for the currently-viewed asset. All other assets return `null`.
2. **Masked Adjustments Missing**: The export pipeline doesn't apply masked adjustments at all, even when edits exist.

## Root Cause Analysis

### Bug 1: Edit State Retrieval Fails for Non-Current Assets

**File**: `apps/web/app/composables/useExport.ts` (lines 279-294)

```typescript
async function getEditState(assetId: string): Promise<ExportEditState | null> {
  if (editStore.currentAssetId === assetId) {
    // Only works for current asset
    const state = editStore.editState
    return {
      adjustments: state.adjustments,
      toneCurve: state.adjustments.toneCurve,
      crop: state.cropTransform.crop,
      rotation: state.cropTransform.rotation,
    }
  }
  // TODO: Load from database once persistence is implemented
  return null  // ← All other assets return null!
}
```

**Why This Happens**:
- Edit store only holds edits for ONE asset at a time (the currently viewed asset)
- Database persistence is marked as `TODO` in `edit.ts` (lines 158, 216)
- When switching assets in edit view, edits are reset to defaults (line 160-162)
- No mechanism to retrieve previous asset's edits

### Bug 2: Masked Adjustments Not in Export Pipeline

**File**: `packages/core/src/export/types.ts` (lines 110-119)

```typescript
export interface ExportEditState {
  adjustments?: Adjustments
  toneCurve?: ToneCurve
  crop?: CropRectangle | null
  rotation?: RotationParameters
  // ❌ MISSING: masks?: MaskStack
}
```

**File**: `packages/core/src/export/export-service.ts` (lines 222-273)

The `applyEdits()` function applies:
1. Rotation ✓
2. Crop ✓
3. Adjustments ✓
4. Tone Curve ✓
5. Masked Adjustments ❌ **MISSING**

Even if edits existed, masks would be ignored because:
- `ExportEditState` has no `masks` field
- `ExportServiceDependencies` has no `applyMaskedAdjustments` method
- `applyEdits()` has no masked adjustments step

## Data Flow Analysis

### Current Export Flow (Broken)

```
User clicks Export
    ↓
runExport() - useExport.ts:324
    ↓
For each asset:
    ↓
processAsset() - export-service.ts:170
    ↓
loadImageBytes(asset) → Original JPEG bytes
    ↓
decodeImage(bytes) → Pixels
    ↓
getEditState(asset.id) → null (for non-current assets) ❌
    ↓
if (editState) applyEdits() → SKIPPED for most assets ❌
    ↓
encodeJpeg() → Unedited JPEG output
```

### Preview Flow (Working)

```
User enters edit view
    ↓
loadForAsset(assetId) - edit.ts:149
    ↓
renderPreview() - useEditPreview.ts:457
    ↓
[Step 1] Apply Rotation
    ↓
[Step 2] Apply Crop
    ↓
[Step 3] Apply Adjustments
    ↓
[Step 4] Apply Tone Curve
    ↓
[Step 5] Apply Masked Adjustments ← Works in preview!
    ↓
Display edited preview
```

## Files Requiring Changes

### 1. `packages/core/src/export/types.ts`
- Add `masks?: MaskStack` to `ExportEditState`
- Add `applyMaskedAdjustments` to `ExportServiceDependencies`

### 2. `packages/core/src/export/export-service.ts`
- Add masked adjustments step in `applyEdits()` after tone curve

### 3. `apps/web/app/composables/useExport.ts`
- Add `applyMaskedAdjustments` dependency
- Fix `getEditState()` to include masks
- Implement edit retrieval mechanism

### 4. `apps/web/app/stores/edit.ts`
- Implement persistence (either database or session-memory)

## Fix Strategy Options

### Option A: Full Database Persistence (Ideal but Complex)
- Implement Dexie.js table for edit state
- Save edits on every change (debounced)
- Load edits from database in `loadForAsset()`
- Export retrieves from database

**Pros**: Edits persist across page refresh, proper architecture
**Cons**: Significant implementation effort, schema migration needed

### Option B: In-Memory Session Cache (Quick Fix)
- Add `editCache: Map<string, EditState>` to edit store
- On `loadForAsset()`: save current to cache before switching, load from cache or defaults
- Export retrieves from cache

**Pros**: Quick to implement, solves immediate bug
**Cons**: Edits lost on page refresh

### Option C: Hybrid - Cache Now, Database Later
- Implement Option B immediately
- Add database persistence in future iteration

**Recommendation**: Option C - Fix the immediate critical bug with caching, database can come later.

## Implementation Plan

### Phase 1: Add Masked Adjustments to Export (Quick Win)
1. Add `masks?: MaskStack` to `ExportEditState`
2. Add `applyMaskedAdjustments` to dependencies interface
3. Wire up the dependency in `useExport.ts`
4. Add masked adjustments step in `applyEdits()`

### Phase 2: Implement Edit State Caching
1. Add `editCache: Map<string, EditState>` to edit store
2. Modify `loadForAsset()` to save/load from cache
3. Modify `getEditState()` in useExport to read from cache
4. Ensure cache is populated for edited assets

### Phase 3: Test and Verify
1. Test export with basic adjustments
2. Test export with tone curve
3. Test export with crop/rotation
4. Test export with masks
5. Test export of multiple assets (not just current)

## Key Code References

| Component | File | Lines |
|-----------|------|-------|
| getEditState | `useExport.ts` | 279-294 |
| Edit store state | `edit.ts` | 43-76 |
| loadForAsset | `edit.ts` | 149-165 |
| save (TODO) | `edit.ts` | 208-228 |
| ExportEditState | `export/types.ts` | 110-119 |
| ExportServiceDependencies | `export/types.ts` | 129-230 |
| applyEdits | `export-service.ts` | 222-273 |
| processAsset | `export-service.ts` | 170-216 |
| applyMaskedAdjustments (worker) | `decode-worker.ts` | 416-495 |
| DecodeService.applyMaskedAdjustments | `decode-service.ts` | 509-523 |
