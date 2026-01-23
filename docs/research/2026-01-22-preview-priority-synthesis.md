# Preview Priority on Edit Entry - Research Synthesis

## Problem Statement

When a thumbnail is visible (appears loaded), users may double-click to enter edit view, but the preview is still generating. This creates confusion because the user sees a loading state in the edit view despite the thumbnail appearing ready.

## Current Architecture Analysis

### Preview Generation System

The preview system uses **separate queues** for thumbnails (512px) and previews (2560px):

| Feature | Thumbnail Queue | Preview Queue |
|---------|----------------|---------------|
| Size | 512px | 2560px |
| Memory Cache | 150 items | 20 items |
| Use Case | Grid view | Edit view |
| Quality | 0.85 JPEG | 0.92 JPEG |

### Priority System

Both queues use the same `ThumbnailPriority` enum:
```typescript
enum ThumbnailPriority {
  VISIBLE = 0,      // Highest priority
  NEAR_VISIBLE = 1,
  PRELOAD = 2,
  BACKGROUND = 3,   // Lowest priority
}
```

The min-heap data structure ensures O(log n) priority updates via `updatePriority()` method.

### Current Edit View Entry Flow

1. **Double-click on thumbnail** → `router.push('/edit/{assetId}')`
2. **ensure-catalog middleware** → Validates catalog is loaded
3. **Edit page mounts** → `useEditPreview` composable initializes
4. **Preview request** (line 754-761 of useEditPreview.ts):
   ```typescript
   catalog.requestThumbnail(id, 0)   // Priority 0
   catalog.requestPreview(id, 0)     // Priority 0
   ```

### Identified Issues

1. **Preview not requested until edit view mounts**
   - User double-clicks thumbnail → Navigation begins
   - Preview request only happens after page load
   - If preview queue is busy, user sees loading state

2. **Thumbnail request competes with preview**
   - Both thumbnail and preview requested at Priority 0
   - Thumbnail may be processed first (smaller, faster)
   - But in edit view, we actually want the preview first

3. **No prefetching on entry**
   - When user navigates from catalog to edit, there's no advance notice
   - Preview generation starts reactively, not proactively

4. **Filmstrip thumbnails compete**
   - EditFilmstrip requests ~30 thumbnails at Priority 1
   - These add to queue even though only current asset preview matters most

## Proposed Solutions

### Solution 1: Early Preview Request (Recommended - Low Effort, High Impact)

**Concept**: Request preview BEFORE navigation, when user double-clicks thumbnail.

**Implementation**:
- In `CatalogThumbnail.vue` `handleDoubleClick()`:
  1. Request preview at Priority 0 immediately
  2. Then navigate to edit view

**Benefit**: Preview generation starts during navigation transition, reducing perceived wait time.

### Solution 2: Staggered Filmstrip Loading (Medium Effort, Medium Impact)

**Concept**: Don't load all filmstrip thumbnails at Priority 1. Prioritize adjacent items.

**Current**: All visible filmstrip items (30) load at Priority 1
**Proposed**:
- Current asset ±2: Priority 1 (NEAR_VISIBLE)
- Current asset ±5: Priority 2 (PRELOAD)
- Rest: Priority 3 (BACKGROUND)

**Benefit**: Less contention in queue, preview finishes faster.

### Solution 3: Preview-First Priority (Low Effort, Medium Impact)

**Concept**: In edit view, request preview at Priority 0, thumbnail at Priority 2.

**Current**:
```typescript
catalog.requestThumbnail(id, 0)
catalog.requestPreview(id, 0)
```

**Proposed**:
```typescript
catalog.requestThumbnail(id, ThumbnailPriority.PRELOAD)  // Lower priority
catalog.requestPreview(id, ThumbnailPriority.VISIBLE)    // Highest
```

**Benefit**: Preview gets processed before thumbnail in edit view context.

### Solution 4: Predictive Preloading (Higher Effort, High Impact)

**Concept**: When user hovers on thumbnail, start preview generation.

**Implementation**:
- Add `onMouseEnter` handler to `CatalogThumbnail`
- After 200ms hover, request preview at Priority 2 (PRELOAD)
- If user clicks, boost to Priority 0

**Benefit**: Many clicks are preceded by hover, giving head start on preview.

## Recommended Implementation Plan

### Phase 1: Early Preview Request (Quick Win)
1. Modify `CatalogThumbnail.vue` `handleDoubleClick()`
2. Add preview request before navigation
3. Add same logic to keyboard enter/E key handler

### Phase 2: Preview-First Priority
1. Modify `useEditPreview.ts` to request preview at Priority 0, thumbnail at Priority 2
2. Edit view doesn't need thumbnail quickly (preview is primary)

### Phase 3: Staggered Filmstrip (If Needed)
1. Modify `EditFilmstrip.vue` to use distance-based priority
2. Only if Phase 1-2 don't fully resolve the issue

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/app/components/catalog/CatalogThumbnail.vue` | Early preview request on double-click |
| `apps/web/app/components/catalog/CatalogGrid.vue` | Early preview request on keyboard navigation |
| `apps/web/app/composables/useEditPreview.ts` | Preview-first priority |
| `apps/web/app/components/edit/EditFilmstrip.vue` | Staggered priority (optional) |

## Success Criteria

1. Preview loads faster when entering edit view
2. Loading state is minimized or eliminated for commonly clicked images
3. No regression in thumbnail generation speed
4. No race conditions in preview/thumbnail loading

## Conclusion

The "preview not ready" issue stems from the reactive nature of preview requests - they only start when the edit view loads. The recommended fix is to start preview generation earlier (on double-click) and prioritize previews over thumbnails in the edit view context. This is a low-effort, high-impact change that requires minimal code modifications.
