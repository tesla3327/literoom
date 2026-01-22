# Gallery Loading State Fix - Implementation Plan

**Date**: 2026-01-22
**Issue**: Gallery loading state after returning from edit (High severity)

## Scope

This plan addresses **Issue 1 only**: Gallery sometimes shows loading state with no thumbnails when returning from edit view.

Issue 2 (thumbnails don't reflect edits) requires significant thumbnail pipeline changes and will be addressed in a future iteration.

## Problem

When navigating back from edit view to gallery:
1. `getAsset()` in CatalogGrid.vue may return `undefined`
2. The asset is passed to CatalogThumbnail with non-null assertion (`!`)
3. CatalogThumbnail tries to access properties on `undefined`
4. Results in stuck loading state or undefined behavior

## Solution

Add defensive checks to prevent rendering thumbnails for missing assets.

## Implementation

### Phase 1: Add v-if Guard in CatalogGrid Template

**File**: `apps/web/app/components/catalog/CatalogGrid.vue`

Add a `v-if` check to only render CatalogThumbnail when the asset exists:

```vue
<!-- Items in this row -->
<template v-for="colIndex in columnsInRow(virtualRow.index)" :key="...">
  <CatalogThumbnail
    v-if="getAsset(virtualRow.index, colIndex - 1)"
    :asset="getAsset(virtualRow.index, colIndex - 1)!"
    ...
  />
  <!-- Empty placeholder for missing assets -->
  <div v-else class="aspect-square rounded-lg bg-gray-900" />
</template>
```

### Phase 2: Add Debug Logging

Add console warning when asset is missing to help debug:

```typescript
function getAsset(rowIndex: number, colIndex: number) {
  const assetId = getAssetId(rowIndex, colIndex)
  if (!assetId) return undefined

  const asset = catalogStore.getAsset(assetId)
  if (!asset) {
    console.warn(`[CatalogGrid] Asset not found in store: ${assetId}`)
  }
  return asset
}
```

### Phase 3: Verify with Browser Testing

Use agent-browser to verify:
1. Navigate to edit view
2. Return to gallery via G key
3. Confirm all thumbnails display correctly
4. Repeat 5 times to check for race conditions

## Files to Modify

1. `apps/web/app/components/catalog/CatalogGrid.vue`

## Success Criteria

- [ ] Gallery displays all thumbnails when returning from edit view
- [ ] No stuck loading states
- [ ] No console errors about undefined properties
- [ ] Works for rapid navigation (multiple round trips)

## Testing

1. Manual browser testing with demo mode
2. All existing unit tests pass
3. E2E tests pass

## Limitations

This fix does NOT address:
- Thumbnails showing edits (requires full thumbnail regeneration)
- The root cause of asset/assetId desynchronization (if it exists)

These are documented as separate issues for future work.
