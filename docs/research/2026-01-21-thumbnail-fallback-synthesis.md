# Edit View Thumbnail Fallback Issue - Research Synthesis

**Date**: 2026-01-21
**Issue**: Edit view should never use thumbnail (High severity)
**Status**: Research Complete

## Problem Statement

The edit view currently falls back to displaying the small thumbnail (512px) while waiting for the high-resolution preview (2560px) to load. This provides a poor editing experience:

1. Users see a pixelated image immediately
2. Users may start making edits on a low-quality placeholder
3. Creates confusion about actual image quality
4. No visual indication that a better image is loading

## Current Architecture

### Image Generation Pipeline

Two independent systems run in parallel:

| System | Size | Quality | Purpose |
|--------|------|---------|---------|
| Thumbnail | 512px | 0.85 JPEG | Catalog grid view |
| Preview 1x | 2560px | 0.92 JPEG | Edit view |

### Asset State Fields

```typescript
interface Asset {
  // Thumbnail (fast, low quality)
  thumbnailStatus?: ThumbnailStatus  // 'pending' | 'loading' | 'ready' | 'error'
  thumbnailUrl?: string | null

  // Preview (slower, high quality)
  preview1xStatus?: ThumbnailStatus
  preview1xUrl?: string | null
}
```

### Current Data Flow

```
User navigates to /edit/[assetId]
    ↓
EditPreviewCanvas mounts with assetId
    ↓
useEditPreview(assetId) watcher fires
    ↓
├─ Request thumbnail (priority 0)
├─ Request preview (priority 0)
└─ Set previewUrl to best available (usually thumbnail) ← PROBLEM
    ↓
Display immediately (512px thumbnail)
    ↓
isInitialLoading = false (because previewUrl is set)
    ↓
[Background: Preview 2560px generates...]
    ↓
onPreviewReady fires → store updates preview1xUrl
    ↓
sourceUrl computed updates → loadSource() → renderPreview()
    ↓
Silent swap to 2560px (no visual indication)
```

## Root Cause Analysis

### Location 1: `useEditPreview.ts` (Lines 710-714)

```typescript
// Show best available image immediately (borrowed URL from store)
const asset = catalogStore.assets.get(id)
const immediateUrl = asset?.preview1xUrl ?? asset?.thumbnailUrl ?? null
previewUrl.value = immediateUrl  // ← Sets thumbnail immediately
isPreviewUrlOwned.value = false
```

**Problem**: This immediately sets `previewUrl` to whatever is available (usually thumbnail), bypassing the loading state.

### Location 2: `EditPreviewCanvas.vue` (Line 76)

```typescript
const isInitialLoading = computed(() => !previewUrl.value && !error.value)
```

**Problem**: `isInitialLoading` only checks if `previewUrl` is null. Once thumbnail URL is set, loading state disappears even though preview is still generating.

### Location 3: Template (Lines 186-211)

```vue
<div v-if="isInitialLoading">
  <!-- Loading indicator - NEVER SHOWN -->
</div>
<div v-else-if="previewUrl">
  <!-- Pixelated thumbnail shown immediately -->
  <img :src="previewUrl" />
</div>
```

## Missing State

The system lacks a state to indicate: **"We're showing a thumbnail placeholder while waiting for the full preview."**

Current states tracked:
- ✅ `isRendering` - Whether a render operation is in progress
- ✅ `renderQuality` - 'draft' | 'full'
- ✅ `error` - Error message if failed
- ❌ `isWaitingForPreview` - Missing!
- ❌ Whether current URL is thumbnail vs preview - Missing!

## Solution Design

### Option A: Never Show Thumbnail in Edit View (Recommended)

**Behavior**: Show loading indicator until full preview is ready. Edit view always displays high-quality preview.

**Pros**:
- Cleaner UX - never see pixelated image
- Clearer expectation - "Loading..." means quality image coming
- Matches professional editing software behavior

**Cons**:
- Slightly longer perceived wait on first load
- Need to handle edge case where preview generation fails

### Option B: Show Thumbnail with Loading Indicator Overlay

**Behavior**: Show thumbnail immediately with a subtle loading spinner overlay that disappears when preview loads.

**Pros**:
- Instant visual feedback
- User can see rough composition immediately
- Progressive enhancement feel

**Cons**:
- Users might start editing before high-quality loads
- More complex UI state management
- Could be confusing

### Recommendation: Option A

The edit view is for precision work. Showing a pixelated placeholder defeats the purpose. Better to show a clear loading state and deliver the full quality image when ready.

## Implementation Strategy

### Changes to `useEditPreview.ts`

1. **Add new state**: `isWaitingForPreview` ref
2. **Modify asset watcher**: Don't set `previewUrl` until preview is ready
3. **Add preview-specific loading**: Track when we're waiting for high-quality
4. **Export new state**: So component can show appropriate loading UI

### Changes to `EditPreviewCanvas.vue`

1. **Update loading condition**: Check `isWaitingForPreview` in addition to `isInitialLoading`
2. **Show appropriate message**: "Generating preview..." vs "Loading..."

### Edge Cases

1. **Preview already cached**: Show immediately (no loading state needed)
2. **Preview generation fails**: Fall back to thumbnail with error indicator
3. **Navigation during load**: Cancel pending preview, request new one
4. **Demo mode**: Mock service has 100ms delay, should still show loading

## Key Files

| File | Lines | Purpose |
|------|-------|---------|
| `apps/web/app/composables/useEditPreview.ts` | 290-322, 339-343, 681-746 | State, source URL, asset watcher |
| `apps/web/app/components/edit/EditPreviewCanvas.vue` | 76, 186-211 | Loading state, template |
| `apps/web/app/stores/catalog.ts` | 149-191 | Thumbnail/preview update actions |
| `packages/core/src/catalog/types.ts` | 48-51 | Asset preview fields |

## Success Criteria

1. ✅ Edit view shows "Loading preview..." until 2560px preview is ready
2. ✅ Never displays pixelated 512px thumbnail in edit canvas
3. ✅ If preview is already cached, displays immediately (no loading flash)
4. ✅ Works in both demo mode and real mode
5. ✅ Preview generation failure gracefully falls back with error message
6. ✅ Rapid navigation cancels pending operations correctly
