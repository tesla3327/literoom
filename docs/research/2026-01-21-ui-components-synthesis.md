# UI Components Synthesis (Phase 6)

**Date**: 2026-01-21
**Status**: Complete
**Research**: Areas 1-6 completed in parallel

---

## Executive Summary

This synthesis consolidates research from 6 areas to guide implementation of Phase 6 catalog UI components. Key decisions:

1. **Virtual scrolling**: Use @tanstack/vue-virtual with row-only virtualization for simpler implementation
2. **Thumbnail component**: Skeleton loading, intersection observer, store-managed Object URLs
3. **Filter bar**: UFieldGroup with UButton + UBadge, Nuxt UI's defineShortcuts for keyboard
4. **Permission recovery**: UModal with folder list, re-authorization flow
5. **Keyboard navigation**: useGridKeyboard composable with roving tabindex pattern
6. **Styling**: Tailwind dark theme (gray-950), existing store patterns

---

## 1. Virtual Scrolling Grid

### Recommended Approach

Use **row-only virtualization** with @tanstack/vue-virtual (simpler than dual-axis):

```typescript
import { useVirtualizer } from '@tanstack/vue-virtual'

const rowVirtualizer = useVirtualizer({
  count: Math.ceil(assets.length / columnsCount.value),
  getScrollElement: () => scrollContainerRef.value,
  estimateSize: () => itemHeight.value,
  overscan: 5, // Extra rows for smooth scrolling
})
```

### Key Implementation Patterns

1. **Fixed-height scroll container** with `overflow-y: auto`
2. **Responsive columns** via ResizeObserver:
   ```typescript
   const columnsCount = computed(() => {
     if (containerWidth.value < 640) return 2
     if (containerWidth.value < 1024) return 3
     if (containerWidth.value < 1280) return 4
     return 5
   })
   ```
3. **CSS Grid for each row** with transform positioning
4. **Visible item detection** via `virtualizer.getVirtualItems()` indices

### Gotchas to Avoid

- Container MUST have explicit height + `overflow: auto`
- Use `transform: translateY()` for positioning (not margin/top)
- Changing column count requires `virtualizer.measure()` call
- Dynamic heights cause scroll stuttering - use fixed thumbnail sizes

### Dependencies

```bash
cd apps/web && pnpm add @tanstack/vue-virtual
```

---

## 2. Thumbnail Component

### Component Structure

```typescript
interface PhotoThumbnailProps {
  asset: Asset
  isSelected: boolean
  isCurrent: boolean
  hasMultipleSelected: boolean
  thumbnailUrl: string | null
  thumbnailStatus: ThumbnailStatus
  index: number
}

interface PhotoThumbnailEmits {
  click: [event: MouseEvent]
  'visibility-change': [isVisible: boolean]
}
```

### Loading States

1. **Skeleton with shimmer** (CSS animation):
   ```css
   .skeleton {
     background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
     background-size: 200% 100%;
     animation: shimmer 1.5s infinite;
   }
   ```

2. **Error state** with retry button

3. **Ready state** with loaded image

### Selection Visualization

- **Current item**: Blue border + shadow (`border-color: #3b82f6`)
- **Selected item**: Cyan border (`border-color: #06b6d4`)
- **Multi-select indicator**: Checkmark badge in top-right corner

### Flag Badges

- **Position**: Top-left corner (doesn't interfere with selection)
- **Pick**: Green circle with checkmark
- **Reject**: Red circle with X

### Click Handling

Use **centralized click handler in grid** (reduces event listeners):

```vue
<div class="photo-grid" @click="handleGridClick">
  <PhotoThumbnail :data-asset-id="asset.id" ... />
</div>
```

### Intersection Observer Integration

```typescript
const { elementRef } = useIntersectionObserver(
  (isVisible) => {
    thumbnailService.updatePriority(
      assetId,
      isVisible ? ThumbnailPriority.VISIBLE : ThumbnailPriority.BACKGROUND
    )
  },
  { threshold: 0.1, rootMargin: '50px' }
)
```

### Memory Management

- Object URLs stored in **Pinia store only** (not component)
- Store handles revocation on `clear()` or asset removal
- Don't revoke immediately after image loads - keep during session

---

## 3. Filter Bar

### Nuxt UI Component Usage

- **UFieldGroup**: Groups filter buttons together
- **UButton**: Individual filter buttons with `variant`, `active` props
- **UBadge**: Count badges positioned as trailing content
- **UDropdownMenu**: Sort field/direction dropdown

### Recommended Structure

```vue
<template>
  <div class="filter-bar">
    <UFieldGroup>
      <UButton
        v-for="mode in filterModes"
        :key="mode.value"
        :variant="filterMode === mode.value ? 'solid' : 'ghost'"
        @click="setFilterMode(mode.value)"
      >
        {{ mode.label }}
        <template #trailing>
          <UBadge size="sm" :label="mode.count" />
        </template>
      </UButton>
    </UFieldGroup>

    <UDropdownMenu :items="sortOptions" @select="handleSort">
      <UButton variant="outline">
        Sort: {{ currentSortLabel }}
      </UButton>
    </UDropdownMenu>
  </div>
</template>
```

### Store Integration

Already provided by `useCatalogUIStore()`:
- `filterMode`, `sortField`, `sortDirection`
- `setFilterMode()`, `setSortField()`, `toggleSortDirection()`
- `filteredCount`, `flagCounts` computed

### Keyboard Shortcuts

Use Nuxt UI's `defineShortcuts`:

```typescript
defineShortcuts({
  p: () => flagCurrentPhoto('pick'),
  x: () => flagCurrentPhoto('reject'),
  u: () => flagCurrentPhoto('clear'),
})
```

---

## 4. Permission Recovery Modal

### When to Show

- App initialization with saved folders but revoked permissions
- Permission state is `'prompt'` or `'denied'`
- Detection in `CatalogService.loadFromDatabase()`

### Modal Component

```vue
<UModal
  v-model:open="showModal"
  title="Folder Access Recovery"
  :dismissible="false"
>
  <template #content>
    <div v-for="folder in issues" class="folder-item">
      <p>{{ folder.name }}</p>
      <UBadge :color="getStatusColor(folder.permissionState)" />
      <UButton @click="reauthorize(folder)">Re-authorize</UButton>
    </div>
  </template>

  <template #footer>
    <UButton variant="ghost" @click="selectAlternate">Choose Different</UButton>
    <UButton @click="retryAll">Retry All</UButton>
    <UButton @click="proceed" :disabled="accessibleCount === 0">
      Continue with {{ accessibleCount }}
    </UButton>
  </template>
</UModal>
```

### State Management

Create `usePermissionRecoveryStore()`:
- `showModal`, `folderIssues`, `accessibleFolders`
- `checkFolderPermissions()`, `reauthorizeFolder()`, `retryAll()`

### Error Classification

```typescript
type PermissionErrorType =
  | 'HANDLE_NOT_FOUND'
  | 'PERMISSION_DENIED'
  | 'FOLDER_DELETED'
  | 'SECURITY_ERROR'
```

---

## 5. Keyboard Navigation

### Grid Navigation Algorithm

```typescript
function getNextIndex(index, direction, cols, total) {
  const row = Math.floor(index / cols)
  const col = index % cols

  switch (direction) {
    case 'ArrowRight':
      return Math.min(index + 1, total - 1)
    case 'ArrowLeft':
      return Math.max(index - 1, 0)
    case 'ArrowDown':
      return Math.min(index + cols, total - 1)
    case 'ArrowUp':
      return Math.max(index - cols, 0)
  }
}
```

### Focus Management

Use **roving tabindex** pattern:
- Current item: `tabindex="0"` (focusable)
- Other items: `tabindex="-1"` (not focusable via Tab)
- Update tabindex when navigating with arrows

### Composable Structure

```typescript
export function useGridKeyboard(gridItems, onNavigate, onFlag) {
  const currentIndex = ref(0)

  function handleKeydown(event) {
    if (!canHandleShortcuts(event)) return

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft':
      case 'ArrowDown':
      case 'ArrowUp':
        event.preventDefault()
        const newIndex = getNextIndex(currentIndex.value, event.key, cols, total)
        updateFocus(newIndex)
        break
      case 'p': onFlag(currentIndex.value, 'pick'); break
      case 'x': onFlag(currentIndex.value, 'reject'); break
      case 'u': onFlag(currentIndex.value, 'clear'); break
    }
  }

  return { currentIndex, handleKeydown }
}
```

### Input Field Protection

Skip shortcuts when user is typing:

```typescript
function canHandleShortcuts(event) {
  const target = event.target
  return !(
    target.matches('input, textarea') ||
    target.contentEditable === 'true'
  )
}
```

### Required Shortcuts (from spec)

| Key | Action |
|-----|--------|
| P | Pick |
| X | Reject |
| U | Clear flag |
| Arrow keys | Navigate |
| Enter / E | Edit mode |
| G | Grid view |
| D | Develop view |

---

## 6. Existing Codebase Patterns

### Store Patterns to Follow

- Use `defineStore()` with composition API
- `shallowRef` for large collections (Map, Set)
- Computed for derived state (filters, counts)
- Separate data store from UI store from selection store

### Component Patterns

- Script setup with TypeScript
- Tailwind utility classes for styling
- Dark theme: `bg-gray-950`, `text-white`
- Nuxt UI components for common patterns

### CSS Patterns

- Flexbox layouts: `flex flex-col items-center`
- Spacing: `space-y-*`, `p-*`, `gap-*`
- Typography: `text-*` for size/color, `font-bold`
- Dark colors: `bg-gray-950`, `text-gray-400`

### Service Integration

- Services provided via Nuxt plugins
- Access via composables: `useDecode()`, `useCatalog()`
- Async factory pattern: `await Service.create()`

---

## File Organization

```
apps/web/app/
├── components/catalog/
│   ├── CatalogGrid.vue          # Virtual scrolling grid
│   ├── CatalogThumbnail.vue     # Individual thumbnail
│   ├── FilterBar.vue            # Filter mode + sort controls
│   └── PermissionRecovery.vue   # Recovery modal
├── composables/
│   ├── useGridKeyboard.ts       # Keyboard navigation
│   └── useIntersectionObserver.ts # Visibility detection
└── stores/
    └── permissionRecovery.ts    # Recovery state (new)
```

---

## Implementation Order

1. **CatalogThumbnail.vue** - Basic thumbnail with loading/error states
2. **CatalogGrid.vue** - Virtual scrolling with thumbnails
3. **FilterBar.vue** - Filter buttons and sort dropdown
4. **useGridKeyboard** - Keyboard navigation composable
5. **PermissionRecovery.vue** - Recovery modal

---

## Dependencies to Add

```bash
cd apps/web && pnpm add @tanstack/vue-virtual
```

Note: VueUse is already available via Nuxt's auto-imports.

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Row-only virtualization | Simpler than dual-axis, sufficient for fixed-height thumbnails |
| Store-managed Object URLs | Centralized cleanup prevents memory leaks |
| Centralized click handler | Fewer event listeners, clearer control flow |
| Skeleton loading | Better UX than spinner, indicates layout |
| Roving tabindex | W3C accessibility standard for grids |
| Nuxt UI components | Pre-built, accessible, matches existing style |

---

## Sources

- [TanStack Virtual Documentation](https://tanstack.com/virtual/latest)
- [Building Responsive Virtual Grid](https://dev.to/dango0812/building-a-responsive-virtualized-grid-with-tanstack-virtual-37nn)
- [Vue 3 Event Handling](https://vuejs.org/guide/essentials/event-handling)
- [Nuxt UI Components](https://ui.nuxt.com/docs/components)
- [WAI-ARIA Keyboard Interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
- [File System Access API Permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
