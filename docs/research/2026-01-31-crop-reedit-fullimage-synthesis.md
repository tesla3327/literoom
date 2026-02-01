# Crop Re-edit Full Image Display - Research Synthesis

**Date**: 2026-01-31
**Issue**: Crop re-edit should show full uncropped image

## Problem Statement

When re-entering the crop tool on an already-cropped image, the view only shows the currently cropped region. Users cannot see the parts of the image that were previously cropped out, making it impossible to expand the crop to include previously excluded areas.

## Expected Behavior (Lightroom-style)

When opening the crop tool on an image that already has a crop applied:
1. Show the full original uncropped image
2. Display the current crop region as an overlay on the full image
3. Allow users to see and potentially include areas that were previously excluded
4. The cropped result is only displayed when the crop tool is closed

## Root Cause Analysis

The issue is in `useEditPreview.ts` (lines 878-908, 1065-1171):

```typescript
// Line 878-881 - Crop detection
const crop = editStore.cropTransform.crop
const hasCrop = !!crop

// Line 908 - Path decision
if (pipelineReady && !hasCrop) {
  // PATH A: No crop - shows full image
}
else if (pipelineReady && hasCrop) {
  // PATH B: Has crop - ALWAYS applies crop (LINE 1099-1109)
  const cropped = await $decodeService.applyCrop(...)
}
```

**The problem**: The code checks `hasCrop` (whether crop exists in store) but **does NOT check `isCropToolActive`** (whether user is actively editing the crop). This means:

- When crop tool is ACTIVE: User expects to see full image with overlay
- What actually happens: Crop is applied, showing only the cropped region

## Solution

Modify the crop application logic to skip crop when the crop tool is active:

```typescript
// Get UI store to check crop tool state
const editUIStore = useEditUIStore()

// Check if we should apply crop
// Skip crop when crop tool is active (user needs to see full image)
const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive
```

## Architecture Analysis

### Current State Flow

```
User opens crop tool
       ↓
editUIStore.isCropToolActive = true
       ↓
pendingCrop initialized from editStore.cropTransform.crop
       ↓
Preview renders with PATH B (hasCrop = true)
       ↓
Crop is APPLIED → user sees cropped image only  ← WRONG
       ↓
Overlay renders on top but has nothing to show outside current crop
```

### Target State Flow

```
User opens crop tool
       ↓
editUIStore.isCropToolActive = true
       ↓
pendingCrop initialized from editStore.cropTransform.crop
       ↓
Preview checks: hasCrop && !isCropToolActive
       ↓
Since isCropToolActive is true, skip crop in render
       ↓
Preview renders with PATH A (treating as no crop)  ← CORRECT
       ↓
User sees FULL IMAGE
       ↓
Overlay renders crop rectangle on full image
       ↓
User can expand crop to include previously cropped areas
```

## Files to Modify

1. **`apps/web/app/composables/useEditPreview.ts`**
   - Import `useEditUIStore`
   - Check `isCropToolActive` in the crop decision logic
   - Update PATH A condition to include when crop tool is active
   - Update PATH B/C to skip crop when tool is active

## Implementation Details

### Changes to useEditPreview.ts

1. Add import at top of file:
```typescript
import { useEditUIStore } from '~/stores/editUI'
```

2. In `renderPreview()` function, modify the crop check (around line 878-881):
```typescript
const crop = editStore.cropTransform.crop
const totalRotation = getTotalRotation(editStore.cropTransform.rotation)
const hasCrop = !!crop

// NEW: Get UI store to check if crop tool is active
const editUIStore = useEditUIStore()
// Skip crop application when crop tool is active (user needs to see full image)
const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive
```

3. Update PATH decision (line 908):
```typescript
// Was: if (pipelineReady && !hasCrop)
if (pipelineReady && !shouldApplyCrop) {
  // PATH A: No crop OR crop tool active - Use unified pipeline
```

4. Update PATH B condition (line 1065):
```typescript
// Was: else if (pipelineReady && hasCrop)
else if (pipelineReady && shouldApplyCrop) {
  // PATH B: Crop needed AND tool not active - Split into stages
```

5. Update PATH C fallback (line 1196-1208):
```typescript
// Was: if (crop)
if (shouldApplyCrop && crop) {
  // Apply crop only when not in crop tool mode
```

## Test Cases

1. **Open crop tool on uncropped image**: Shows full image (no change)
2. **Open crop tool on cropped image**: Should show full uncropped image with crop overlay
3. **Close crop tool (cancel)**: Should show cropped preview again
4. **Apply crop**: Should show cropped preview with new crop
5. **Reset crop**: Should clear crop, show full image

## Edge Cases

- Rotation + Crop: When crop tool is active, rotation should still be applied
- Adjustments + Crop: Adjustments should still be applied to full image
- Masks over cropped region: Masks should work correctly on full image display

## Performance Considerations

- When crop tool is active with a previously cropped image, we'll render the FULL image instead of the cropped region
- This may use more GPU memory temporarily but is necessary for correct UX
- When crop tool is closed, normal cropped rendering resumes
