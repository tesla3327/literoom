# Edit View Thumbnail Fallback Fix - Implementation Plan

**Date**: 2026-01-21
**Issue**: Edit view should never use thumbnail
**Research**: `docs/research/2026-01-21-thumbnail-fallback-synthesis.md`

## Overview

Fix the edit view to show a loading state until the full 2560px preview is ready, instead of displaying a pixelated 512px thumbnail.

## Implementation Phases

### Phase 1: Add Preview Loading State to `useEditPreview.ts`

**File**: `apps/web/app/composables/useEditPreview.ts`

**Changes**:

1. **Add new state** (after line ~291):
   ```typescript
   /** Whether we're waiting for a high-quality preview to load */
   const isWaitingForPreview = ref(false)
   ```

2. **Modify asset watcher** (lines 681-746):
   - Check if `preview1xStatus` is 'ready' before setting `previewUrl`
   - If preview not ready, set `isWaitingForPreview = true` and keep `previewUrl = null`
   - Only set `previewUrl` to thumbnail as fallback if preview generation fails

3. **Add preview status watcher**:
   - Watch `asset.preview1xStatus` changes
   - When status becomes 'ready', load the preview and clear `isWaitingForPreview`
   - When status becomes 'error', fall back to thumbnail with warning

4. **Export new state** (around line 794):
   ```typescript
   return {
     // ... existing exports
     isWaitingForPreview,
   }
   ```

### Phase 2: Update `EditPreviewCanvas.vue` Loading State

**File**: `apps/web/app/components/edit/EditPreviewCanvas.vue`

**Changes**:

1. **Import new state** (around line 35):
   ```typescript
   const {
     previewUrl,
     isRendering,
     renderQuality,
     error,
     isWaitingForPreview,  // NEW
     // ...
   } = useEditPreview(/* ... */)
   ```

2. **Update loading condition** (line 76):
   ```typescript
   const isInitialLoading = computed(() =>
     (!previewUrl.value && !error.value) || isWaitingForPreview.value
   )
   ```

3. **Update loading message** (lines 192-195):
   ```vue
   <span class="text-sm">
     {{ isWaitingForPreview ? 'Generating preview...' : 'Loading preview...' }}
   </span>
   ```

### Phase 3: Handle Preview Ready Callback

**File**: `apps/web/app/composables/useEditPreview.ts`

**Changes**:

1. **Watch for preview becoming ready**:
   ```typescript
   // Watch for preview URL becoming available
   watch(
     () => {
       const asset = catalogStore.assets.get(assetId.value)
       return asset?.preview1xUrl
     },
     async (newUrl) => {
       if (newUrl && isWaitingForPreview.value) {
         // Preview is ready, load it
         isWaitingForPreview.value = false
         previewUrl.value = newUrl
         isPreviewUrlOwned.value = false
         await loadSource(assetId.value)
         if (editStore.isDirty) {
           await renderPreview('full')
         }
       }
     }
   )
   ```

2. **Handle preview generation errors**:
   ```typescript
   watch(
     () => {
       const asset = catalogStore.assets.get(assetId.value)
       return asset?.preview1xStatus
     },
     (status) => {
       if (status === 'error' && isWaitingForPreview.value) {
         // Preview generation failed, fall back to thumbnail
         const asset = catalogStore.assets.get(assetId.value)
         if (asset?.thumbnailUrl) {
           isWaitingForPreview.value = false
           previewUrl.value = asset.thumbnailUrl
           error.value = 'Preview generation failed, showing thumbnail'
         }
       }
     }
   )
   ```

### Phase 4: Handle Cached Previews (No Loading Flash)

**File**: `apps/web/app/composables/useEditPreview.ts`

**Changes**:

1. **Check if preview already available** (in asset watcher):
   ```typescript
   watch(
     assetId,
     async (id) => {
       // ... existing cancellation logic ...

       const asset = catalogStore.assets.get(id)

       // Check if preview is already available (cached)
       if (asset?.preview1xStatus === 'ready' && asset.preview1xUrl) {
         // Preview already cached - show immediately
         previewUrl.value = asset.preview1xUrl
         isPreviewUrlOwned.value = false
         isWaitingForPreview.value = false
       } else {
         // Preview not ready - show loading state
         previewUrl.value = null
         isWaitingForPreview.value = true
       }

       // Request generation (will be no-op if already cached)
       if (import.meta.client && catalog) {
         catalog.requestThumbnail(id, 0)
         catalog.requestPreview(id, 0)
       }

       // ... rest of logic ...
     }
   )
   ```

## Testing Strategy

### Manual Testing

1. **Fresh asset (no cache)**:
   - Navigate to edit view
   - Should see "Generating preview..." loading state
   - After preview generates, should show high-quality image

2. **Cached asset**:
   - Navigate to edit view for previously viewed asset
   - Should show image immediately (no loading flash)

3. **Rapid navigation**:
   - Quickly click through filmstrip
   - Should handle cancellation correctly
   - Final asset should show loading then preview

4. **Demo mode**:
   - Test in demo mode with 100ms delay
   - Should show brief loading state

### Automated Testing

1. Update E2E tests to verify loading state appears
2. Unit test the new `isWaitingForPreview` state transitions

## Files Modified

| File | Changes |
|------|---------|
| `apps/web/app/composables/useEditPreview.ts` | Add `isWaitingForPreview`, modify watchers |
| `apps/web/app/components/edit/EditPreviewCanvas.vue` | Update loading condition and message |

## Estimated Complexity

- **Low to Medium**: Changes are localized to 2 files
- Primary work is in `useEditPreview.ts` watcher logic
- Need to carefully handle race conditions with existing watchers

## Success Criteria

- [ ] Edit view shows loading state until 2560px preview is ready
- [ ] Never displays pixelated 512px thumbnail in edit canvas
- [ ] Cached previews display immediately (no loading flash)
- [ ] Works in both demo mode and real mode
- [ ] Rapid navigation handles cancellation correctly
- [ ] All existing tests pass
