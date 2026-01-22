# Preview Priority on Edit Entry - Implementation Plan

## Overview

This plan addresses the "Preview not ready when clicking thumbnail" issue by starting preview generation earlier (before navigation) and adjusting priority order in the edit view context.

## Problem Summary

When users double-click a thumbnail to enter edit view, the preview is often not ready because:
1. Preview request only happens **after** navigation (when edit view mounts)
2. Both thumbnail and preview are requested at Priority 0 (equal priority)
3. Filmstrip requests ~30 thumbnails at Priority 1, adding queue contention

## Solution Overview

Three-phase approach (Phases 1-3 recommended, Phase 4 optional):

1. **Early Preview Request**: Start preview generation before navigation
2. **Preview-First Priority**: In edit view, preview gets Priority 0, thumbnail gets Priority 2
3. **Keyboard Handler Update**: Same early request for E/Enter/D key navigation
4. **Staggered Filmstrip** (optional): Distance-based priority for filmstrip items

## Phase 1: Early Preview Request on Double-Click

**File**: `apps/web/app/components/catalog/CatalogThumbnail.vue`

**Current `handleDoubleClick()`**:
```typescript
function handleDoubleClick() {
  if (props.asset?.id) {
    navigateTo(`/edit/${props.asset.id}`)
  }
}
```

**Modified `handleDoubleClick()`**:
```typescript
function handleDoubleClick() {
  if (props.asset?.id) {
    // Start preview generation BEFORE navigation
    requestPreview(props.asset.id, ThumbnailPriority.VISIBLE)
    navigateTo(`/edit/${props.asset.id}`)
  }
}
```

**Additional Imports/Setup**:
```typescript
import { ThumbnailPriority } from '@literoom/core/catalog'

const { requestPreview } = useCatalog()
```

**Effort**: 15 minutes

---

## Phase 2: Early Preview Request on Keyboard Navigation

**File**: `apps/web/app/components/catalog/CatalogGrid.vue`

**Current keyboard handler** (lines ~198-213):
```typescript
function onViewChange(mode: 'edit') {
  const currentId = props.modelValue ?? selectionStore.currentId
  if (currentId && mode === 'edit') {
    navigateTo(`/edit/${currentId}`)
  }
}
```

**Modified handler**:
```typescript
function onViewChange(mode: 'edit') {
  const currentId = props.modelValue ?? selectionStore.currentId
  if (currentId && mode === 'edit') {
    // Start preview generation BEFORE navigation
    requestPreview(currentId, ThumbnailPriority.VISIBLE)
    navigateTo(`/edit/${currentId}`)
  }
}
```

**Additional Setup**:
```typescript
import { ThumbnailPriority } from '@literoom/core/catalog'

const { requestPreview } = useCatalog()
```

**Effort**: 15 minutes

---

## Phase 3: Preview-First Priority in Edit View

**File**: `apps/web/app/composables/useEditPreview.ts`

**Current** (lines ~754-761):
```typescript
catalog.requestThumbnail(id, 0)   // Priority 0
catalog.requestPreview(id, 0)     // Priority 0
```

**Modified**:
```typescript
import { ThumbnailPriority } from '@literoom/core/catalog'

// In edit view, we care about preview first (large display)
// Thumbnail is only needed as fallback (lower priority)
catalog.requestThumbnail(id, ThumbnailPriority.PRELOAD)     // Priority 2
catalog.requestPreview(id, ThumbnailPriority.VISIBLE)       // Priority 0
```

**Rationale**: In the edit view, the preview (2560px) is the primary display. The thumbnail (512px) is only a fallback that we already showed in the catalog grid. Giving preview higher priority ensures it processes first.

**Effort**: 10 minutes

---

## Phase 4: Staggered Filmstrip Priority (Optional)

**File**: `apps/web/app/components/edit/EditFilmstrip.vue`

**Current** (thumbnail requests):
```typescript
watch(visibleIds, (ids) => {
  for (const id of ids) {
    const asset = catalogStore.assets.get(id)
    if (asset && asset.thumbnailStatus === 'pending') {
      requestThumbnail(id, 1)  // All at Priority 1 (NEAR_VISIBLE)
    }
  }
}, { immediate: true })
```

**Modified** (distance-based priority):
```typescript
watch(visibleIds, (ids) => {
  const currentIndex = catalogStore.assetIds.indexOf(selectionStore.currentId ?? '')

  for (const id of ids) {
    const asset = catalogStore.assets.get(id)
    if (asset && asset.thumbnailStatus === 'pending') {
      const itemIndex = catalogStore.assetIds.indexOf(id)
      const distance = Math.abs(itemIndex - currentIndex)

      // Priority based on distance from current asset
      let priority = ThumbnailPriority.BACKGROUND  // Default: 3
      if (distance <= 2) priority = ThumbnailPriority.NEAR_VISIBLE  // 1
      else if (distance <= 5) priority = ThumbnailPriority.PRELOAD  // 2

      requestThumbnail(id, priority)
    }
  }
}, { immediate: true })
```

**Rationale**: Adjacent images are more likely to be navigated to next. Give them higher priority while distant items get background priority.

**When to implement**: Only if Phases 1-3 don't fully resolve the issue.

**Effort**: 30 minutes

---

## Implementation Checklist

- [ ] Phase 1: Add early preview request in `CatalogThumbnail.vue` `handleDoubleClick()`
- [ ] Phase 2: Add early preview request in `CatalogGrid.vue` `onViewChange()`
- [ ] Phase 3: Change priority order in `useEditPreview.ts`
- [ ] Phase 4: (Optional) Implement distance-based filmstrip priority
- [ ] Test: Verify faster preview loading on edit entry
- [ ] Test: Ensure no regression in catalog grid performance

## Success Criteria

1. Preview loads noticeably faster when entering edit view
2. Loading state is minimized or eliminated for commonly clicked images
3. No regression in thumbnail generation speed in catalog view
4. No race conditions or errors in preview/thumbnail loading

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/app/components/catalog/CatalogThumbnail.vue` | Early preview request on double-click |
| `apps/web/app/components/catalog/CatalogGrid.vue` | Early preview request on keyboard navigation |
| `apps/web/app/composables/useEditPreview.ts` | Preview-first priority |
| `apps/web/app/components/edit/EditFilmstrip.vue` | Staggered priority (optional) |

## Risk Assessment

- **Low risk**: All changes are additive (adding preview requests, changing priority values)
- **No API changes**: Existing interfaces remain unchanged
- **Backward compatible**: If requestPreview fails silently, edit view still works (fallback to current behavior)
