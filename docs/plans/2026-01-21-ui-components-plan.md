# Phase 6: UI Components Implementation Plan

**Date**: 2026-01-21
**Status**: Complete
**Research**: [UI Components Synthesis](../research/2026-01-21-ui-components-synthesis.md)

---

## Overview

Phase 6 implements the visual UI layer for the catalog system:
1. Virtual scrolling photo grid with efficient thumbnail rendering
2. Individual thumbnail components with loading states and flag badges
3. Filter bar for picks/rejects/unflagged with sort options
4. Permission recovery modal for re-authorizing folders
5. Keyboard navigation composable for grid interaction

---

## Dependencies

```bash
cd apps/web && pnpm add @tanstack/vue-virtual
```

---

## Implementation Phases

### Phase 6.1: Composables

**Goal**: Create reusable composables for intersection observation and keyboard navigation.

#### 6.1.1 Create `apps/web/app/composables/useIntersectionObserver.ts`

```typescript
interface UseIntersectionObserverOptions {
  threshold?: number
  rootMargin?: string
  root?: HTMLElement | null
}

interface UseIntersectionObserverReturn {
  elementRef: Ref<HTMLElement | null>
  isVisible: Ref<boolean>
}

export function useIntersectionObserver(
  callback: (isVisible: boolean) => void,
  options?: UseIntersectionObserverOptions
): UseIntersectionObserverReturn
```

Key implementation:
- Create `IntersectionObserver` instance in `onMounted`
- Track visibility state in ref
- Call callback on intersection change
- Cleanup observer on `onUnmounted`
- Default threshold: 0.1, rootMargin: '100px'

#### 6.1.2 Create `apps/web/app/composables/useGridKeyboard.ts`

```typescript
interface UseGridKeyboardOptions {
  columnsCount: ComputedRef<number>
  totalItems: ComputedRef<number>
  onNavigate: (index: number) => void
  onFlag: (flag: FlagStatus) => void
  onViewChange?: (mode: 'edit' | 'grid') => void
}

interface UseGridKeyboardReturn {
  currentIndex: Ref<number>
  handleKeydown: (event: KeyboardEvent) => void
  setCurrentIndex: (index: number) => void
}

export function useGridKeyboard(options: UseGridKeyboardOptions): UseGridKeyboardReturn
```

Key implementation:
- Arrow key navigation with grid-aware movement
- `getNextIndex()` helper for grid navigation algorithm
- `canHandleShortcuts()` check to skip when typing in inputs
- Flag shortcuts: P (pick), X (reject), U (clear)
- View shortcuts: E/Enter (edit), G (grid), D (develop)

Keyboard mapping:
| Key | Action |
|-----|--------|
| ArrowRight | Move to next item |
| ArrowLeft | Move to previous item |
| ArrowDown | Move down one row |
| ArrowUp | Move up one row |
| P | Pick current photo |
| X | Reject current photo |
| U | Clear flag |
| E / Enter | Open edit mode |

#### 6.1.3 Verification

- [ ] `useIntersectionObserver` detects visibility changes
- [ ] `useGridKeyboard` navigates grid correctly
- [ ] Shortcuts don't fire when typing in input fields

---

### Phase 6.2: CatalogThumbnail Component

**Goal**: Individual thumbnail component with loading states, selection, and flag badges.

#### 6.2.1 Create `apps/web/app/components/catalog/CatalogThumbnail.vue`

**Props**:
```typescript
interface CatalogThumbnailProps {
  asset: Asset
  isSelected: boolean
  isCurrent: boolean
  thumbnailUrl: string | null
  thumbnailStatus: ThumbnailStatus
  index: number
}
```

**Emits**:
```typescript
interface CatalogThumbnailEmits {
  click: [event: MouseEvent]
}
```

**Template structure**:
```vue
<template>
  <div
    class="thumbnail-container"
    :class="{
      'is-selected': isSelected,
      'is-current': isCurrent,
    }"
    :data-asset-id="asset.id"
    :data-index="index"
    :tabindex="isCurrent ? 0 : -1"
    @click="$emit('click', $event)"
  >
    <!-- Flag badge (top-left) -->
    <div v-if="asset.flag !== 'none'" class="flag-badge">
      <UIcon v-if="asset.flag === 'pick'" name="i-heroicons-check-circle" class="text-green-500" />
      <UIcon v-else name="i-heroicons-x-circle" class="text-red-500" />
    </div>

    <!-- Selection checkbox (top-right, shown when multiple selected) -->
    <div v-if="isSelected" class="selection-indicator">
      <UIcon name="i-heroicons-check" />
    </div>

    <!-- Thumbnail states -->
    <div v-if="thumbnailStatus === 'pending' || thumbnailStatus === 'loading'" class="skeleton" />
    <div v-else-if="thumbnailStatus === 'error'" class="error-state">
      <UIcon name="i-heroicons-exclamation-triangle" />
    </div>
    <img v-else :src="thumbnailUrl!" :alt="asset.filename" class="thumbnail-image" />
  </div>
</template>
```

**Styles**:
- Base: `aspect-square rounded-lg overflow-hidden relative bg-gray-900`
- Current: `ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-950`
- Selected: `ring-2 ring-cyan-500`
- Skeleton: CSS shimmer animation
- Flag badge: `absolute top-1 left-1 w-5 h-5`
- Selection indicator: `absolute top-1 right-1 w-5 h-5 bg-cyan-500 rounded-full`

#### 6.2.2 Verification

- [ ] Shows skeleton during loading
- [ ] Shows error state on failure
- [ ] Shows image when ready
- [ ] Flag badge visible for pick/reject
- [ ] Selection ring shows when selected
- [ ] Focus ring shows when current
- [ ] Click event emits correctly

---

### Phase 6.3: CatalogGrid Component

**Goal**: Virtual scrolling grid with viewport-aware thumbnail loading.

#### 6.3.1 Create `apps/web/app/components/catalog/CatalogGrid.vue`

**Implementation approach**:
1. Row-only virtualization (not dual-axis)
2. Responsive column count via ResizeObserver
3. Fixed thumbnail height (calculated from column width)
4. Centralized click handling with event delegation

**Template structure**:
```vue
<template>
  <div
    ref="scrollContainerRef"
    class="grid-scroll-container"
    @click="handleGridClick"
    @keydown="handleKeydown"
  >
    <!-- Virtual scroller spacer -->
    <div
      class="grid-spacer"
      :style="{ height: `${virtualizer.getTotalSize()}px` }"
    >
      <!-- Virtual rows -->
      <div
        v-for="virtualRow in virtualizer.getVirtualItems()"
        :key="virtualRow.index"
        class="grid-row"
        :style="{
          transform: `translateY(${virtualRow.start}px)`,
          height: `${virtualRow.size}px`,
        }"
      >
        <!-- Items in this row -->
        <CatalogThumbnail
          v-for="colIndex in columnsInRow(virtualRow.index)"
          :key="getAssetId(virtualRow.index, colIndex)"
          :asset="getAsset(virtualRow.index, colIndex)"
          :is-selected="isSelected(virtualRow.index, colIndex)"
          :is-current="isCurrent(virtualRow.index, colIndex)"
          :thumbnail-url="getThumbnailUrl(virtualRow.index, colIndex)"
          :thumbnail-status="getThumbnailStatus(virtualRow.index, colIndex)"
          :index="getGlobalIndex(virtualRow.index, colIndex)"
          @click="handleThumbnailClick($event, virtualRow.index, colIndex)"
        />
      </div>
    </div>
  </div>
</template>
```

**Key functions**:
```typescript
// Column count based on container width
const columnsCount = computed(() => {
  if (containerWidth.value < 640) return 2
  if (containerWidth.value < 1024) return 3
  if (containerWidth.value < 1280) return 4
  return 5
})

// Row count = ceil(total / columns)
const rowCount = computed(() =>
  Math.ceil(sortedAssetIds.value.length / columnsCount.value)
)

// Virtual row -> asset mapping
function getGlobalIndex(rowIndex: number, colIndex: number): number {
  return rowIndex * columnsCount.value + colIndex
}

function getAssetId(rowIndex: number, colIndex: number): string {
  return sortedAssetIds.value[getGlobalIndex(rowIndex, colIndex)]
}
```

**Viewport-aware thumbnail priority**:
```typescript
// When virtual items change, update thumbnail priorities
watch(() => virtualizer.value?.getVirtualItems(), (virtualItems) => {
  if (!virtualItems) return

  const visibleAssetIds = new Set<string>()
  for (const row of virtualItems) {
    for (let col = 0; col < columnsInRow(row.index); col++) {
      visibleAssetIds.add(getAssetId(row.index, col))
    }
  }

  // Update priorities via catalog service
  catalogService.updateVisibleAssets(visibleAssetIds)
})
```

**Styles**:
```css
.grid-scroll-container {
  @apply h-full overflow-y-auto;
}

.grid-spacer {
  @apply relative w-full;
}

.grid-row {
  @apply absolute top-0 left-0 right-0;
  @apply grid gap-2 p-2;
  grid-template-columns: repeat(var(--columns), 1fr);
}
```

#### 6.3.2 Verification

- [ ] Scrolls smoothly with 1000+ items
- [ ] Column count adapts to container width
- [ ] Only visible rows are rendered
- [ ] Visible thumbnails get priority loading
- [ ] Arrow key navigation works
- [ ] Click selection works (single, Ctrl, Shift)

---

### Phase 6.4: FilterBar Component

**Goal**: Filter mode buttons and sort dropdown.

#### 6.4.1 Create `apps/web/app/components/catalog/FilterBar.vue`

**Template structure**:
```vue
<template>
  <div class="filter-bar">
    <!-- Filter buttons -->
    <div class="filter-buttons">
      <UButton
        v-for="mode in filterModes"
        :key="mode.value"
        :variant="filterMode === mode.value ? 'solid' : 'ghost'"
        size="sm"
        @click="setFilterMode(mode.value)"
      >
        {{ mode.label }}
        <template #trailing>
          <UBadge v-if="mode.count > 0" size="xs" :label="mode.count" />
        </template>
      </UButton>
    </div>

    <!-- Sort dropdown -->
    <UDropdownMenu :items="sortOptions">
      <UButton variant="ghost" size="sm" trailing-icon="i-heroicons-chevron-down">
        {{ sortLabel }}
      </UButton>
    </UDropdownMenu>
  </div>
</template>
```

**Filter modes**:
```typescript
const filterModes = computed(() => [
  { value: 'all', label: 'All', count: catalogStore.assetIds.length },
  { value: 'picks', label: 'Picks', count: catalogStore.pickCount },
  { value: 'rejects', label: 'Rejects', count: catalogStore.rejectCount },
  { value: 'unflagged', label: 'Unflagged', count: catalogStore.unflaggedCount },
])
```

**Sort options**:
```typescript
const sortOptions = [
  [
    { label: 'Date (newest)', value: 'captureDate-desc', icon: 'i-heroicons-calendar' },
    { label: 'Date (oldest)', value: 'captureDate-asc', icon: 'i-heroicons-calendar' },
  ],
  [
    { label: 'Name (A-Z)', value: 'filename-asc', icon: 'i-heroicons-bars-3-bottom-left' },
    { label: 'Name (Z-A)', value: 'filename-desc', icon: 'i-heroicons-bars-3-bottom-right' },
  ],
  [
    { label: 'Size (largest)', value: 'fileSize-desc', icon: 'i-heroicons-arrow-trending-up' },
    { label: 'Size (smallest)', value: 'fileSize-asc', icon: 'i-heroicons-arrow-trending-down' },
  ],
]
```

**Styles**:
```css
.filter-bar {
  @apply flex items-center justify-between;
  @apply px-4 py-2 border-b border-gray-800;
}

.filter-buttons {
  @apply flex gap-1;
}
```

#### 6.4.2 Verification

- [ ] Filter buttons update store state
- [ ] Count badges show correct numbers
- [ ] Active filter has solid variant
- [ ] Sort dropdown works
- [ ] Grid updates when filter changes

---

### Phase 6.5: PermissionRecovery Component

**Goal**: Modal for re-authorizing folders when permissions are lost.

#### 6.5.1 Create `apps/web/app/stores/permissionRecovery.ts`

```typescript
interface FolderIssue {
  folderId: string
  folderName: string
  folderPath: string
  permissionState: 'prompt' | 'denied'
  error?: string
}

export const usePermissionRecoveryStore = defineStore('permissionRecovery', () => {
  const showModal = ref(false)
  const folderIssues = ref<FolderIssue[]>([])
  const isRechecking = ref(false)

  const hasIssues = computed(() => folderIssues.value.length > 0)
  const accessibleCount = computed(() => /* count accessible folders */)

  async function checkFolderPermissions(folders: FolderRecord[]): Promise<void>
  async function reauthorizeFolder(folderId: string): Promise<boolean>
  async function retryAll(): Promise<void>
  function clearIssues(): void

  return {
    showModal,
    folderIssues,
    isRechecking,
    hasIssues,
    accessibleCount,
    checkFolderPermissions,
    reauthorizeFolder,
    retryAll,
    clearIssues,
  }
})
```

#### 6.5.2 Create `apps/web/app/components/catalog/PermissionRecovery.vue`

**Template structure**:
```vue
<template>
  <UModal
    v-model:open="showModal"
    title="Folder Access Required"
    :dismissible="false"
  >
    <template #content>
      <p class="text-gray-400 mb-4">
        The following folders need to be re-authorized to continue.
      </p>

      <div class="folder-list">
        <div v-for="issue in folderIssues" :key="issue.folderId" class="folder-item">
          <div class="folder-info">
            <p class="font-medium">{{ issue.folderName }}</p>
            <p class="text-sm text-gray-500">{{ issue.folderPath }}</p>
          </div>
          <div class="folder-actions">
            <UBadge
              :color="issue.permissionState === 'prompt' ? 'yellow' : 'red'"
              :label="issue.permissionState === 'prompt' ? 'Needs permission' : 'Denied'"
            />
            <UButton
              size="sm"
              @click="reauthorizeFolder(issue.folderId)"
            >
              Re-authorize
            </UButton>
          </div>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton variant="ghost" @click="selectNewFolder">
        Choose Different Folder
      </UButton>
      <UButton @click="retryAll">
        Retry All
      </UButton>
      <UButton
        color="primary"
        @click="continueWithAccessible"
        :disabled="accessibleCount === 0"
      >
        Continue with {{ accessibleCount }} accessible
      </UButton>
    </template>
  </UModal>
</template>
```

**Styles**:
```css
.folder-list {
  @apply space-y-2;
}

.folder-item {
  @apply flex items-center justify-between;
  @apply p-3 rounded-lg bg-gray-900;
}

.folder-info {
  @apply flex-1 min-w-0;
}

.folder-actions {
  @apply flex items-center gap-2;
}
```

#### 6.5.3 Verification

- [ ] Modal appears when permissions lost
- [ ] Shows folder name and path
- [ ] Re-authorize button triggers file picker
- [ ] Success updates folder access
- [ ] "Continue" proceeds with accessible folders
- [ ] Modal closes after resolution

---

### Phase 6.6: Page Integration

**Goal**: Wire components together on the catalog page.

#### 6.6.1 Update `apps/web/app/pages/index.vue` or create catalog page

```vue
<template>
  <div class="catalog-page">
    <!-- Permission recovery modal -->
    <PermissionRecovery />

    <!-- Header with folder name and actions -->
    <header class="catalog-header">
      <h1 v-if="folderPath" class="text-xl font-bold">{{ folderName }}</h1>
      <UButton v-else @click="selectFolder">Choose Folder</UButton>
    </header>

    <!-- Filter bar -->
    <FilterBar v-if="hasAssets" />

    <!-- Grid or empty state -->
    <CatalogGrid v-if="hasAssets" />
    <div v-else class="empty-state">
      <UIcon name="i-heroicons-folder-open" class="w-16 h-16 text-gray-600" />
      <p class="text-gray-500">No photos found</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const catalogStore = useCatalogStore()
const { selectFolder } = useCatalog()

const folderPath = computed(() => catalogStore.folderPath)
const folderName = computed(() => folderPath.value?.split('/').pop())
const hasAssets = computed(() => catalogStore.assetIds.length > 0)
</script>
```

#### 6.6.2 Verification

- [ ] Page loads without errors
- [ ] Folder selection works
- [ ] Grid displays after scanning
- [ ] Filter bar shows correct counts
- [ ] Keyboard shortcuts work
- [ ] Permission modal appears when needed

---

## Testing

### Unit Tests (Vitest)

Create `apps/web/test/components/catalog/`:
- `CatalogThumbnail.test.ts` - loading states, click handling
- `FilterBar.test.ts` - filter button selection, sort dropdown
- `useGridKeyboard.test.ts` - navigation algorithm

### E2E Tests (Playwright)

Add to `apps/web/e2e/`:
- `catalog-grid.spec.ts`:
  - Virtual scroll performance with 1000+ items
  - Keyboard navigation
  - Filter mode switching
  - Multi-select with Shift/Ctrl

---

## File Summary

```
apps/web/app/
├── components/catalog/
│   ├── CatalogGrid.vue           # Phase 6.3
│   ├── CatalogThumbnail.vue      # Phase 6.2
│   ├── FilterBar.vue             # Phase 6.4
│   └── PermissionRecovery.vue    # Phase 6.5
├── composables/
│   ├── useGridKeyboard.ts        # Phase 6.1
│   └── useIntersectionObserver.ts # Phase 6.1
└── stores/
    └── permissionRecovery.ts     # Phase 6.5
```

---

## Verification Checklist

After all phases complete:

- [ ] `pnpm typecheck` passes
- [ ] Grid scrolls smoothly with 1000+ items
- [ ] Thumbnails load viewport-first
- [ ] Arrow keys navigate grid
- [ ] P/X/U flag photos
- [ ] Filter modes work (All/Picks/Rejects/Unflagged)
- [ ] Sort by date/name/size works
- [ ] Multi-select with Shift/Ctrl+click
- [ ] Permission recovery modal shows when needed
- [ ] Page displays correctly on load

---

## Implementation Order

1. **Phase 6.1**: Composables (useIntersectionObserver, useGridKeyboard)
2. **Phase 6.2**: CatalogThumbnail component
3. **Phase 6.3**: CatalogGrid component with virtual scrolling
4. **Phase 6.4**: FilterBar component
5. **Phase 6.5**: PermissionRecovery store and component
6. **Phase 6.6**: Page integration and testing
