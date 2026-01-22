# Import UX Improvements - Research Synthesis

**Date**: 2026-01-22
**Objective**: Improve the import experience so users feel they can immediately start using the app

## Executive Summary

The current import flow has solid architecture but poor user feedback. Users are dropped into a gallery with loading placeholders without clear progress indication. The key issues are:

1. **No visible import progress** - Scanning progress disappears quickly, thumbnail generation has no feedback
2. **Gallery shows before ready** - Users see mostly loading placeholders instead of usable thumbnails
3. **Thumbnail priority system underutilized** - IntersectionObserver exists but isn't integrated with priority updates

## Current Architecture Analysis

### Import Flow

```
User clicks "Choose Folder"
    ↓
index.vue: isLoading = true, shows "Scanning folder..." screen
    ↓
CatalogService.scanFolder() starts
    - Batches assets (50 at a time)
    - Emits onAssetsAdded callbacks
    ↓
catalogStore.addAssetBatch() adds assets progressively
    ↓
Scan completes → isScanning = false
    ↓
Gallery view shown with assets (most with thumbnailStatus='pending')
    ↓
CatalogThumbnail components mount and request thumbnails
    ↓
ThumbnailService processes queue (4-8 parallel operations)
    ↓
Thumbnails appear one by one
```

### Key Components

| Component | Role | Current Behavior |
|-----------|------|------------------|
| CatalogService | Orchestrates scanning | Batched scanning with progress callbacks |
| ThumbnailService | Generates thumbnails | Priority queue with parallel processing |
| ThumbnailQueue | Min-heap priority queue | Max 200 items, auto-evicts low priority |
| CatalogGrid | Virtual scrolling grid | Renders immediately, lazy thumbnail requests |
| CatalogThumbnail | Individual thumbnail | Requests on mount, shows shimmer while loading |
| FilterBar | Shows counts/filters | No import progress indicator |

### Identified Issues

#### 1. Priority System Underutilized
- `ThumbnailPriority` enum exists: `VISIBLE=0`, `NEAR_VISIBLE=1`, `PRELOAD=2`, `BACKGROUND=3`
- Current implementation passes **array index** as priority instead of enum values
- `updateThumbnailPriority()` method exists but is **never called**
- IntersectionObserver composable exists but isn't integrated with priority updates

#### 2. Gallery Shows Too Early
- Gallery view appears as soon as scanning completes
- Most thumbnails are still `pending` at this point
- Users see a grid of shimmer placeholders
- No indication of how many thumbnails are ready vs pending

#### 3. No Progress Feedback During Thumbnail Generation
- Scanning progress shows "Found X files" but disappears when scan ends
- Thumbnail generation (the longer phase) has no visible progress
- Users don't know if app is working or stuck

#### 4. Poor First-Page Experience
- First-page thumbnails aren't prioritized over others
- Even visible thumbnails compete equally in the queue
- User must wait for arbitrary thumbnails to generate

## Proposed Solutions

### Solution 1: Thumbnail Generation Progress Indicator (Quick Win)

Add a progress indicator to FilterBar showing thumbnail generation status:

```vue
<!-- FilterBar.vue -->
<div v-if="thumbnailProgress" class="flex items-center gap-2">
  <UIcon name="i-heroicons-photo" class="w-4 h-4 text-primary-400" />
  <span class="text-sm text-gray-300">
    {{ thumbnailProgress.ready }}/{{ thumbnailProgress.total }} thumbnails
  </span>
  <div class="w-24 h-1.5 bg-gray-700 rounded-full overflow-hidden">
    <div class="h-full bg-primary-500" :style="{ width: `${thumbnailPercent}%` }" />
  </div>
</div>
```

**Implementation**:
1. Add computed `thumbnailProgress` to catalog store
2. Track ready/pending counts from asset statuses
3. Show progress bar until all first-page thumbnails ready

**Effort**: Low (1-2 hours)
**Impact**: Medium - Users see app is working

### Solution 2: First-Page Priority Boost (Medium Impact)

Ensure first-screen thumbnails load before showing gallery:

**Option A: Wait for First Page**
- Calculate how many thumbnails fit on first screen (columns × visible rows)
- After scan completes, generate first-page thumbnails with `VISIBLE` priority
- Only transition to gallery view when first page is ready

**Option B: Dynamic Priority Updates**
- Integrate IntersectionObserver with `updateThumbnailPriority()`
- When thumbnail becomes visible → priority `VISIBLE=0`
- When near visible → priority `NEAR_VISIBLE=1`
- When scrolled away → priority `BACKGROUND=3`

**Implementation (Option A)**:
```typescript
// useCatalog.ts
async function selectFolder() {
  await service.selectFolder()
  await service.scanFolder()

  // Wait for first page of thumbnails
  const firstPageCount = getFirstPageCount() // e.g., 20 thumbnails
  await waitForThumbnails(firstPageCount)

  // Now show gallery
}
```

**Effort**: Medium (4-6 hours)
**Impact**: High - Gallery feels immediately usable

### Solution 3: Import Interstitial Modal (Best UX)

Replace the simple "Scanning..." text with a rich import modal:

```vue
<UModal v-model:open="importStore.isImporting" :dismissible="false">
  <template #header>
    <h3>Importing Photos</h3>
  </template>

  <div class="space-y-4">
    <!-- Phase 1: Scanning -->
    <ImportPhase
      :status="scanStatus"
      icon="folder"
      title="Discovering files"
      :progress="scanProgress"
    />

    <!-- Phase 2: Thumbnails -->
    <ImportPhase
      :status="thumbnailStatus"
      icon="photo"
      title="Generating thumbnails"
      :progress="thumbnailProgress"
    />

    <!-- Preview of first thumbnails -->
    <div v-if="firstThumbnails.length" class="grid grid-cols-4 gap-2">
      <img v-for="url in firstThumbnails" :src="url" class="rounded" />
    </div>
  </div>
</UModal>
```

**Phases**:
1. **Discovering files** - Shows file count as scanning progresses
2. **Generating thumbnails** - Shows ready/total count
3. **Ready!** - Transitions to gallery when first page ready

**Effort**: High (6-8 hours)
**Impact**: High - Professional, polished UX

### Solution 4: Fix Priority System Integration (Foundation)

Properly integrate the existing priority system:

1. **Use ThumbnailPriority enum** - Replace index-based priority with proper enum values
2. **Integrate IntersectionObserver** - Update priorities based on visibility
3. **Add batch observer to CatalogGrid** - Track visible items efficiently

```typescript
// CatalogThumbnail.vue - Fixed priority
const { isVisible, elementRef } = useIntersectionObserver()

watch(isVisible, (visible) => {
  const priority = visible ? ThumbnailPriority.VISIBLE : ThumbnailPriority.BACKGROUND
  updateThumbnailPriority(props.asset.id, priority)
})

onMounted(() => {
  if (props.asset.thumbnailStatus === 'pending') {
    // Use proper priority based on initial visibility
    const priority = props.index < 20 ? ThumbnailPriority.VISIBLE : ThumbnailPriority.PRELOAD
    requestThumbnail(props.asset.id, priority)
  }
})
```

**Effort**: Medium (3-4 hours)
**Impact**: Medium - Better perceived performance

## Recommended Implementation Order

### Phase 1: Quick Wins (1-2 hours)
1. Add thumbnail generation progress to FilterBar
2. Show "Preparing gallery..." message after scan completes

### Phase 2: Core Improvements (4-6 hours)
1. Fix priority system to use ThumbnailPriority enum
2. Wait for first-page thumbnails before showing gallery
3. Add computed properties for thumbnail progress tracking

### Phase 3: Polish (Optional, 4-6 hours)
1. Create import interstitial modal
2. Show preview of first thumbnails as they load
3. Add multi-phase progress visualization

## Technical Details

### Catalog Store Additions

```typescript
// stores/catalog.ts

// Computed for thumbnail progress
const thumbnailProgress = computed(() => {
  let ready = 0
  let pending = 0
  let error = 0

  for (const asset of assets.value.values()) {
    switch (asset.thumbnailStatus) {
      case 'ready': ready++; break
      case 'pending':
      case 'loading': pending++; break
      case 'error': error++; break
    }
  }

  return { ready, pending, error, total: ready + pending + error }
})

const thumbnailPercent = computed(() => {
  const { ready, total } = thumbnailProgress.value
  return total > 0 ? Math.round((ready / total) * 100) : 0
})
```

### First-Page Calculation

```typescript
// useCatalog.ts
function getFirstPageCount(): number {
  // Assume 5 columns × 4 visible rows = 20 thumbnails
  // Could be made dynamic based on viewport
  return 20
}

async function waitForThumbnails(count: number): Promise<void> {
  return new Promise((resolve) => {
    const checkReady = () => {
      const ready = catalogStore.thumbnailProgress.ready
      if (ready >= count) {
        resolve()
      } else {
        setTimeout(checkReady, 100)
      }
    }
    checkReady()
  })
}
```

### UProgress Usage

```vue
<UProgress
  :model-value="thumbnailPercent"
  :max="100"
  size="sm"
  color="primary"
/>
```

## Success Criteria

1. **No more "empty gallery"** - Users see thumbnails, not placeholders, when entering gallery
2. **Clear progress feedback** - Users know import is working and how far along it is
3. **Faster perceived performance** - First-screen thumbnails appear quickly
4. **Interruptible import** - Users can cancel or start using app early if desired

## Files to Modify

| File | Changes |
|------|---------|
| `stores/catalog.ts` | Add thumbnailProgress computed |
| `composables/useCatalog.ts` | Add waitForThumbnails, fix priority usage |
| `components/catalog/FilterBar.vue` | Add progress indicator |
| `components/catalog/CatalogThumbnail.vue` | Fix priority values, add visibility tracking |
| `pages/index.vue` | Update import flow to wait for first page |

## References

- ThumbnailService: `packages/core/src/catalog/thumbnail-service.ts`
- ThumbnailQueue: `packages/core/src/catalog/thumbnail-queue.ts`
- ThumbnailPriority enum: `packages/core/src/catalog/types.ts`
- IntersectionObserver: `apps/web/app/composables/useIntersectionObserver.ts`
- Export progress pattern: `apps/web/app/components/export/ExportModal.vue`
