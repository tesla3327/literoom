# Filter Mode Persistence Research Synthesis

**Date**: 2026-01-31
**Issue**: Filter mode resets after edit view navigation

## Problem Statement

When a user selects a filter (e.g., "Picks") in the catalog grid and then navigates to the edit view and back, the filter resets to "All" instead of preserving the selected filter.

## Research Findings

### 1. Current Filter State Implementation

**File**: `apps/web/app/stores/catalogUI.ts:22`

```typescript
const filterMode = ref<FilterMode>('all')
```

- Simple Vue `ref` initialized to `'all'`
- No persistence mechanism
- Modified only via `setFilterMode()` action

### 2. Filter State Usage

**FilterBar.vue:114-117**:
```vue
<UButton
  v-for="mode in filterModes"
  :variant="catalogUIStore.filterMode === mode.value ? 'solid' : 'ghost'"
  @click="setFilterMode(mode.value)"
>
```

**edit/[id].vue:64**:
```typescript
const filteredIds = computed(() => uiStore.filteredAssetIds)
```

The edit view uses `filteredAssetIds` for navigation, so preserving the filter is important for consistent behavior.

### 3. No Reset Calls Found

- `resetToDefaults()` is never called from application code (only in tests)
- `setFilterMode()` is only called from `FilterBar.vue` button clicks
- No lifecycle hooks or middleware reset the filter

### 4. Page Navigation Analysis

**Edit page** (`apps/web/app/pages/edit/[id].vue`):
- Uses `router.push('/')` for back navigation (client-side)
- Has `ssr: false` in definePageMeta
- On unmount: calls `editStore.clear()` and `editUIStore.deactivateCropTool()` but NOT `catalogUIStore.resetToDefaults()`

**Index page** (`apps/web/app/pages/index.vue`):
- `onMounted`: calls `initializeApp()` which only loads folders/demo data
- Does NOT call any catalogUIStore reset methods

### 5. Pinia Store Persistence Patterns

The project uses manual persistence:
- **edit.ts**: IndexedDB + in-memory cache
- **editUI.ts**: In-memory LRU cache for zoom state
- **catalogUI.ts**: NO persistence - purely in-memory, resets on page refresh

### 6. Theoretical Behavior

Pinia stores in Nuxt should persist between client-side navigations (`router.push()`). The store instance is created once and reused. The filter value should NOT reset during normal navigation.

### 7. Possible Root Causes

1. **SSR Hydration Mismatch**: Index page has SSR enabled, edit page has SSR disabled. When navigating back, there might be a hydration issue.

2. **Hot Module Replacement (HMR)**: In development, HMR might cause store recreation.

3. **Concurrent Access Issue**: Race condition between store access and page rendering.

4. **Test Environment vs Production**: The issue might only appear in certain environments.

## Recommended Solution

Add **session persistence** to the catalogUIStore using sessionStorage. This ensures:
1. Filter persists during the session (including navigation)
2. Resets on new session (expected UX)
3. Minimal implementation overhead

### Implementation Approach

```typescript
// catalogUI.ts
const filterMode = ref<FilterMode>('all')

// Initialize from sessionStorage on store creation
if (import.meta.client) {
  const stored = sessionStorage.getItem('literoom_filter_mode')
  if (stored && isValidFilterMode(stored)) {
    filterMode.value = stored as FilterMode
  }
}

// Persist on change
function setFilterMode(mode: FilterMode): void {
  filterMode.value = mode
  if (import.meta.client) {
    sessionStorage.setItem('literoom_filter_mode', mode)
  }
}
```

### Alternative: Pinia Persistence Plugin

Could use `pinia-plugin-persistedstate` but that adds complexity for a simple need. Manual sessionStorage is simpler and more explicit.

## Files to Modify

1. `apps/web/app/stores/catalogUI.ts` - Add session persistence for filterMode

## Tests to Add

1. `apps/web/test/catalogUIStore.test.ts` - Test filter persistence across store recreation
