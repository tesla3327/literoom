# Implementation Plan: Crop Re-edit Full Image Display

**Date**: 2026-01-31
**Issue**: Crop re-edit should show full uncropped image
**Research**: `docs/research/2026-01-31-crop-reedit-fullimage-synthesis.md`

## Overview

When the crop tool is active on an already-cropped image, the preview should display the full uncropped image so users can see and adjust areas that were previously excluded.

## Implementation Steps

### Step 1: Modify useEditPreview.ts

**File**: `apps/web/app/composables/useEditPreview.ts`

1. **Add import for editUI store** (at top of file):
   ```typescript
   import { useEditUIStore } from '~/stores/editUI'
   ```

2. **Add shouldApplyCrop logic** (in renderPreview function, around line 879):
   ```typescript
   const crop = editStore.cropTransform.crop
   const totalRotation = getTotalRotation(editStore.cropTransform.rotation)
   const hasCrop = !!crop
   const hasRotation = Math.abs(totalRotation) > 0.001
   const hasToneCurve = isModifiedToneCurve(adjustments.toneCurve)

   // NEW: Check if crop tool is active - if so, skip crop application
   // to show full uncropped image for editing
   const editUIStore = useEditUIStore()
   const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive
   ```

3. **Update PATH A condition** (line ~908):
   ```typescript
   // Change from: if (pipelineReady && !hasCrop)
   if (pipelineReady && !shouldApplyCrop) {
   ```

4. **Update PATH B condition** (line ~1065):
   ```typescript
   // Change from: else if (pipelineReady && hasCrop)
   else if (pipelineReady && shouldApplyCrop) {
   ```

5. **Update PATH C fallback** (line ~1197):
   ```typescript
   // Change from: if (crop)
   if (shouldApplyCrop && crop) {
   ```

### Step 2: Add Tests

**File**: `apps/web/test/cropReeditFullImage.test.ts`

Create test file with cases:
1. Uncropped image shows full image when crop tool active
2. Cropped image shows full image when crop tool active
3. Cropped image shows cropped preview when crop tool inactive
4. Rotation applied regardless of crop tool state
5. Adjustments applied regardless of crop tool state

### Step 3: Update Documentation

1. Update `docs/issues.md` to mark issue as SOLVED
2. Update `docs/progress/shard-002.md` with implementation details

## Testing Strategy

### Manual Testing

1. Load an image and apply a crop (shrink to 50% of original)
2. Close crop tool - verify cropped preview shows
3. Re-open crop tool - verify FULL image shows with crop overlay
4. Drag crop handles to expand crop region into previously cropped area
5. Apply crop - verify new larger crop is applied
6. Verify rotation still works when crop tool active
7. Verify adjustments still work when crop tool active

### Automated Testing

- Unit tests for the `shouldApplyCrop` logic
- Integration tests for the render pipeline path selection

## Rollback Plan

If issues arise, revert the single file change to `useEditPreview.ts`.

## Success Criteria

- [ ] Crop tool shows full uncropped image when opened
- [ ] Users can expand crop to include previously excluded areas
- [ ] Closing crop tool returns to cropped preview
- [ ] Rotation and adjustments work correctly
- [ ] All existing tests pass
- [ ] New tests cover the feature
