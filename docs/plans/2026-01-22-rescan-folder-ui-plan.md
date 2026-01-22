# Rescan Folder UI - Implementation Plan

## Overview

Add a "Rescan" button to the FilterBar that triggers `catalogService.rescanFolder()` to detect new and modified files in the currently loaded folder.

## Phase 1: Add rescanFolder to useCatalog Composable

**File**: `apps/web/app/composables/useCatalog.ts`

Add new method:

```typescript
async function rescanFolder(): Promise<void> {
  if (!catalogService) return

  try {
    catalogStore.setScanning(true)
    await catalogService.rescanFolder()

    const toast = useToast()
    toast.add({
      title: 'Catalog updated',
      description: `Found ${catalogStore.totalCount} images`,
      color: 'success'
    })
  } catch (error) {
    const toast = useToast()
    toast.add({
      title: 'Rescan failed',
      description: error instanceof Error ? error.message : 'Unknown error',
      color: 'error'
    })
  } finally {
    catalogStore.setScanning(false)
  }
}
```

Return the new function from the composable.

---

## Phase 2: Add Rescan Button to FilterBar

**File**: `apps/web/app/components/catalog/FilterBar.vue`

### Step 2.1: Add Import

```typescript
const { rescanFolder } = useCatalog()
```

### Step 2.2: Add Button (in right-side section, before Export button)

```vue
<!-- Rescan button (only show when folder loaded, not scanning/exporting) -->
<UButton
  v-if="!catalogStore.isScanning && !exportStore.isExporting && catalogStore.folderPath"
  variant="ghost"
  size="sm"
  icon="i-heroicons-arrow-path"
  title="Rescan folder for new/modified files"
  data-testid="rescan-button"
  @click="handleRescan"
>
  Rescan
</UButton>

<!-- Rescan progress (shown during rescan) -->
<div
  v-else-if="catalogStore.isScanning && catalogStore.folderPath"
  class="flex items-center gap-2 px-2 py-1 rounded-md bg-gray-800"
  data-testid="rescan-progress"
>
  <UIcon
    name="i-heroicons-arrow-path"
    class="w-4 h-4 text-primary-400 animate-spin"
  />
  <span class="text-sm text-gray-300">Rescanning...</span>
</div>
```

### Step 2.3: Add Handler

```typescript
async function handleRescan() {
  await rescanFolder()
}
```

---

## Phase 3: Add Keyboard Shortcut (Optional)

**File**: `apps/web/app/pages/index.vue`

Add to `handleKeydown`:

```typescript
// Cmd/Ctrl+R for Rescan
if ((e.metaKey || e.ctrlKey) && e.key === 'r' && !e.shiftKey) {
  e.preventDefault()
  rescanFolder()
}
```

**File**: `apps/web/app/components/help/HelpModal.vue`

Add to Grid View shortcuts:

```vue
<div class="flex items-center justify-between py-1">
  <span class="text-gray-300">Rescan folder</span>
  <div class="flex gap-1">
    <UKbd>{{ modifierKey }}</UKbd>
    <UKbd>R</UKbd>
  </div>
</div>
```

---

## Implementation Checklist

- [ ] Add `rescanFolder()` method to `useCatalog.ts`
- [ ] Add toast notification for success/error
- [ ] Add Rescan button to FilterBar
- [ ] Add scanning indicator during rescan
- [ ] Test in demo mode
- [ ] Test in real mode (if possible)
- [ ] (Optional) Add Cmd/Ctrl+R keyboard shortcut
- [ ] (Optional) Add shortcut to help modal

---

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/app/composables/useCatalog.ts` | Add `rescanFolder()` method |
| `apps/web/app/components/catalog/FilterBar.vue` | Add Rescan button and progress indicator |
| `apps/web/app/pages/index.vue` | (Optional) Add keyboard shortcut handler |
| `apps/web/app/components/help/HelpModal.vue` | (Optional) Add shortcut documentation |

---

## Success Criteria

1. ✅ Rescan button visible when folder is loaded
2. ✅ Button disabled/hidden during rescan
3. ✅ Spinner shown during rescan
4. ✅ Toast notification after completion
5. ✅ New files appear in grid after rescan
6. ✅ Works in demo mode
7. ✅ Works in real mode

---

## Risk Assessment

**Low Risk:**
- All changes are additive
- Existing `rescanFolder()` method is already tested
- Uses existing UI patterns and components
- No database schema changes

**Considerations:**
- Demo mode: `MockCatalogService.rescanFolder()` clears and rescans (may cause brief flicker)
- Real mode: Rescan preserves existing assets, only adds new ones
