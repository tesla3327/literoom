# Rescan Folder UI - Research Synthesis

## Problem Statement

The spec requires (section 3.3) a "Rescan folder" action that finds new files, detects removed files, and updates cache validity. The functionality exists at the service level but has no UI button.

## Current State

### Service Layer (Complete)
- `ICatalogService.rescanFolder()` exists and works
- Implementation delegates to `scanFolder()` which handles duplicates
- Callbacks fire automatically (`onAssetsAdded`)
- Store updates reactively via plugin wiring

### Missing Components
- No UI button to trigger rescan
- No composable wrapper (`useRescan` or similar)
- No feedback for removed files (service doesn't detect them)
- No toast notification after rescan

## Recommended Approach

### UI Placement: FilterBar (Right Side)

Add Rescan button between thumbnail progress and Export button:

```
[All 42] [Picks 8] [Rejects 3] [Unflagged] │ Rescan | Export | Sort ▼
```

**Rationale:**
- Consistent with existing toolbar patterns
- Logical grouping with other folder operations
- Easy to access during culling workflow

### Button Design

| Property | Value |
|----------|-------|
| Icon | `i-heroicons-arrow-path` |
| Label | "Rescan" |
| Variant | `ghost` |
| Size | `sm` |
| Tooltip | "Rescan folder for new/deleted files" |
| Disabled | When no folder selected or scan in progress |
| Loading | Show spinner when `isScanning` |

### Feedback Mechanism

1. **During Rescan**:
   - Button shows loading spinner
   - OR compact progress indicator in FilterBar
   - Reuse existing `catalogStore.isScanning` state

2. **After Rescan**:
   - Toast notification: "Catalog updated - Found X new files"
   - If removed files detected: "Found X new files, Y files removed"

### Removed Files Handling

**Simple Approach (V1)**:
- Don't detect removed files automatically
- User must clear catalog and rescan to remove deleted files

**Future Enhancement**:
- Add `removeAssets(ids)` to store
- Service detects missing files during rescan
- Show removal summary in toast

## Implementation Plan Summary

### Phase 1: Add Rescan Button to FilterBar
- Add button with `i-heroicons-arrow-path` icon
- Wire to `catalogService.rescanFolder()` via new composable method
- Disable when `!catalogStore.folderPath` or `catalogStore.isScanning`

### Phase 2: Add Loading State
- Show spinner on button when `isScanning`
- Reuse existing store state

### Phase 3: Add Toast Notification
- Success toast after rescan completes
- Show count of images found

### Phase 4: Keyboard Shortcut (Optional)
- Cmd/Ctrl+R for rescan
- Add to help modal

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/app/components/catalog/FilterBar.vue` | Add Rescan button |
| `apps/web/app/composables/useCatalog.ts` | Add `rescanFolder()` method |
| `apps/web/app/components/help/HelpModal.vue` | Add shortcut (optional) |

## Effort Estimate

- **Phase 1-3**: ~30 minutes (simple UI addition)
- **Phase 4**: ~10 minutes (keyboard shortcut)
- **Total**: ~40 minutes

## Success Criteria

1. Rescan button visible in FilterBar when folder is loaded
2. Button shows loading state during rescan
3. Toast notification appears after rescan
4. New files detected and shown in grid
5. Works in both demo mode and real mode
