# Import UX Improvements - Implementation Plan

**Date**: 2026-01-22
**Based on**: `docs/research/2026-01-22-import-ux-synthesis.md`

## Objective

Improve the import experience so users feel they can immediately start using the app when entering the gallery. The gallery should show thumbnails, not loading placeholders.

## Implementation Phases

### Phase 1: Thumbnail Progress Tracking (Foundation)

Add computed properties to track thumbnail generation progress.

**Files to Modify**:
- `apps/web/app/stores/catalog.ts`

**Changes**:
1. Add `thumbnailProgress` computed property that returns `{ ready, pending, loading, error, total }`
2. Add `thumbnailPercent` computed property for progress bar
3. Add `isProcessingThumbnails` computed for UI state

**Implementation**:
```typescript
// stores/catalog.ts - Add to state/getters section

const thumbnailProgress = computed(() => {
  let ready = 0
  let pending = 0
  let loading = 0
  let error = 0

  for (const asset of assets.value.values()) {
    switch (asset.thumbnailStatus) {
      case 'ready': ready++; break
      case 'pending': pending++; break
      case 'loading': loading++; break
      case 'error': error++; break
    }
  }

  const total = ready + pending + loading + error
  return { ready, pending, loading, error, total }
})

const thumbnailPercent = computed(() => {
  const { ready, total } = thumbnailProgress.value
  return total > 0 ? Math.round((ready / total) * 100) : 0
})

const isProcessingThumbnails = computed(() => {
  const { ready, total } = thumbnailProgress.value
  return total > 0 && ready < total
})
```

**Verification**: Unit test that computed values update when asset statuses change.

---

### Phase 2: Progress Indicator in FilterBar

Show thumbnail generation progress to users during import.

**Files to Modify**:
- `apps/web/app/components/catalog/FilterBar.vue`

**Changes**:
1. Import thumbnailProgress, thumbnailPercent, isProcessingThumbnails from catalog store
2. Add progress indicator section (conditionally shown when processing)
3. Use Nuxt UI UProgress component for visual feedback

**Implementation**:
```vue
<!-- Add after filter buttons, before export button -->
<div v-if="isProcessingThumbnails" class="flex items-center gap-2 px-3">
  <UIcon name="i-heroicons-photo" class="w-4 h-4 text-primary-400 animate-pulse" />
  <span class="text-sm text-gray-300 whitespace-nowrap">
    {{ thumbnailProgress.ready }}/{{ thumbnailProgress.total }}
  </span>
  <div class="w-24">
    <UProgress
      :model-value="thumbnailPercent"
      :max="100"
      size="xs"
      color="primary"
    />
  </div>
</div>
```

**Verification**: Manual test - open folder and observe progress indicator.

---

### Phase 3: First-Page Thumbnail Wait

Wait for first visible page of thumbnails before showing gallery.

**Files to Modify**:
- `apps/web/app/composables/useCatalog.ts`
- `apps/web/app/stores/catalog.ts`

**Changes**:
1. Add `getFirstPageCount()` helper (estimate visible thumbnails based on typical viewport)
2. Add `waitForFirstPageThumbnails()` async function
3. Modify `selectFolder()` to wait for first page after scanning

**Implementation**:
```typescript
// useCatalog.ts

function getFirstPageCount(): number {
  // Typical grid: 5 columns × 4 visible rows = 20 thumbnails
  // Could be made dynamic based on viewport later
  return 20
}

async function waitForFirstPageThumbnails(): Promise<void> {
  const targetCount = Math.min(getFirstPageCount(), catalogStore.assetIds.length)

  if (targetCount === 0) return

  return new Promise((resolve) => {
    const unwatch = watch(
      () => catalogStore.thumbnailProgress.ready,
      (ready) => {
        if (ready >= targetCount) {
          unwatch()
          resolve()
        }
      },
      { immediate: true }
    )

    // Timeout fallback after 10 seconds
    setTimeout(() => {
      unwatch()
      resolve()
    }, 10000)
  })
}

// In selectFolder():
async function selectFolder(): Promise<void> {
  isLoading.value = true
  loadingMessage.value = 'Scanning folder...'

  try {
    await service.selectFolder()
    await service.scanFolder()

    // Wait for first page of thumbnails
    loadingMessage.value = 'Preparing gallery...'
    await waitForFirstPageThumbnails()
  } finally {
    isLoading.value = false
    loadingMessage.value = ''
  }
}
```

**Verification**: Manual test - gallery should show thumbnails, not placeholders.

---

### Phase 4: Fix Priority System

Use ThumbnailPriority enum properly instead of array indices.

**Files to Modify**:
- `apps/web/app/components/catalog/CatalogThumbnail.vue`
- `packages/core/src/catalog/types.ts` (verify enum export)

**Changes**:
1. Import ThumbnailPriority enum
2. Use VISIBLE priority for thumbnails that mount in viewport
3. Use PRELOAD priority for thumbnails outside initial viewport

**Implementation**:
```typescript
// CatalogThumbnail.vue
import { ThumbnailPriority } from '@literoom/core'

// In mounted/setup:
onMounted(() => {
  if (props.asset?.thumbnailStatus === 'pending') {
    // First 20 items get VISIBLE priority, rest get PRELOAD
    const priority = props.index !== undefined && props.index < 20
      ? ThumbnailPriority.VISIBLE
      : ThumbnailPriority.PRELOAD
    requestThumbnail(props.asset.id, priority)
  }
})
```

**Verification**: Console log priority values, verify first-page items get priority 0.

---

### Phase 5: Dynamic Priority with IntersectionObserver

Update thumbnail priority based on scroll visibility.

**Files to Modify**:
- `apps/web/app/components/catalog/CatalogThumbnail.vue`
- `apps/web/app/composables/useIntersectionObserver.ts` (verify API)

**Changes**:
1. Use existing `useIntersectionObserver` composable
2. Watch visibility changes and update priority accordingly
3. Call `updateThumbnailPriority()` when visibility changes

**Implementation**:
```typescript
// CatalogThumbnail.vue
const thumbnailRef = ref<HTMLElement | null>(null)
const { isVisible } = useIntersectionObserver(thumbnailRef)

watch(isVisible, (visible) => {
  if (props.asset && props.asset.thumbnailStatus !== 'ready') {
    const priority = visible
      ? ThumbnailPriority.VISIBLE
      : ThumbnailPriority.BACKGROUND
    updateThumbnailPriority(props.asset.id, priority)
  }
})
```

**Verification**: Scroll grid, verify priority updates in queue.

---

### Phase 6: Loading State Enhancement (Optional Polish)

Improve the loading message during import to show phases.

**Files to Modify**:
- `apps/web/app/pages/index.vue`
- `apps/web/app/composables/useCatalog.ts`

**Changes**:
1. Add import phase state: 'scanning' | 'thumbnails' | 'ready'
2. Update loading message based on phase
3. Show count during scanning: "Found X files..."

**Implementation**:
```typescript
// useCatalog.ts
const importPhase = ref<'idle' | 'scanning' | 'thumbnails' | 'ready'>('idle')

// During selectFolder:
importPhase.value = 'scanning'
loadingMessage.value = 'Discovering files...'

await service.scanFolder()

importPhase.value = 'thumbnails'
loadingMessage.value = 'Preparing gallery...'

await waitForFirstPageThumbnails()

importPhase.value = 'ready'
```

**Verification**: Manual test - observe phase transitions during import.

---

## Testing Checklist

- [ ] Open folder with 100+ images
- [ ] Gallery shows thumbnails, not loading placeholders
- [ ] Progress indicator appears during thumbnail generation
- [ ] Progress updates in real-time as thumbnails complete
- [ ] First-page thumbnails load before gallery appears
- [ ] Scrolling doesn't interrupt thumbnail generation
- [ ] No console errors or warnings
- [ ] Unit tests pass
- [ ] E2E tests pass (demo mode)

## Success Criteria

1. **No empty gallery** - Users see actual thumbnails when entering gallery
2. **Clear progress** - Users know import is working via progress indicator
3. **Fast first page** - First visible thumbnails appear within 2-3 seconds
4. **Smooth experience** - No jarring transitions or stuck states

## Estimated Effort

| Phase | Effort | Cumulative |
|-------|--------|------------|
| Phase 1: Progress Tracking | 30 min | 30 min |
| Phase 2: FilterBar Progress | 30 min | 1 hour |
| Phase 3: First-Page Wait | 1 hour | 2 hours |
| Phase 4: Fix Priority System | 30 min | 2.5 hours |
| Phase 5: Dynamic Priority | 1 hour | 3.5 hours |
| Phase 6: Loading Enhancement | 30 min | 4 hours |

**Total**: ~4 hours for full implementation
