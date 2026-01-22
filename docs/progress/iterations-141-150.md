# Iterations 141-150

## 140: 2026-01-22 10:52 EST: Preview Priority on Edit Entry - Implementation Complete

**Objective**: Implement the preview priority improvements according to the plan created in iteration 139.

**Problem Statement** (from issues.md):
When a thumbnail is visible (appears loaded), users may double-click to enter edit view, but the preview is still generating. This creates confusion.

**Implementation Status**: Complete

### Phase 1: Early Preview Request on Double-Click
- [x] Added `requestPreview()` call before navigation in `CatalogThumbnail.vue`
- Modified `handleDoubleClick()` to call `requestPreview(props.asset.id, ThumbnailPriority.VISIBLE)` before `router.push()`

### Phase 2: Early Preview Request on Keyboard Navigation
- [x] Added `requestPreview()` call before navigation in `CatalogGrid.vue`
- Modified `onViewChange()` callback in `useGridKeyboard` to call `requestPreview(currentId, ThumbnailPriority.VISIBLE)` before `navigateTo()`

### Phase 3: Preview-First Priority in Edit View
- [x] Updated `useEditPreview.ts` to prioritize preview over thumbnail
- Changed from both at Priority 0 to:
  - Preview at `ThumbnailPriority.VISIBLE` (Priority 0 - highest)
  - Thumbnail at `ThumbnailPriority.PRELOAD` (Priority 2 - lower)

**Files Modified** (3 files):
- `apps/web/app/components/catalog/CatalogThumbnail.vue` - Added early preview request on double-click
- `apps/web/app/components/catalog/CatalogGrid.vue` - Added early preview request on keyboard navigation (E/Enter/D)
- `apps/web/app/composables/useEditPreview.ts` - Changed priority order (preview first, thumbnail second)

**Tests**: 363 unit tests pass, build completes successfully

**Result**: When users click or keyboard-navigate to edit view:
1. Preview generation starts immediately (before navigation)
2. Preview gets highest priority in the queue
3. Thumbnail gets lower priority (only needed as fallback)
4. Preview should be ready faster, reducing loading state time

---

## 141: 2026-01-22 11:05 EST: Rescan Folder UI - Implementation Complete

**Objective**: Add a "Rescan Folder" button to the UI so users can trigger folder rescan to detect new/removed files.

**Background**:
The spec requires (section 3.3 - Import and scanning):
> Provide a "Rescan folder" action that:
> - finds new files
> - detects removed files
> - updates cache validity if file modified

The rescan functionality was fully implemented at the service level but had **no UI button** exposed to users.

**Implementation**:

### Phase 1: Add `rescanFolder()` to useCatalog Composable
- Added `rescanFolder()` method that:
  - Checks if folder is loaded (shows warning toast if not)
  - Sets `isScanning` state while scanning
  - Calls `catalogService.rescanFolder()`
  - Shows success toast with new image count or "up to date" message
  - Shows error toast on failure

### Phase 2: Add Rescan Button to FilterBar
- Added Rescan button between thumbnail progress and Export button
- Shows only when folder is loaded and not scanning/exporting
- Uses `i-heroicons-arrow-path` icon (consistent with other refresh actions)
- Added scanning progress indicator with spinning icon and "Rescanning..." text

**Files Modified** (2 files):
- `apps/web/app/composables/useCatalog.ts` - Added `rescanFolder()` method (~50 lines)
- `apps/web/app/components/catalog/FilterBar.vue` - Added button and progress indicator (~30 lines)

**Files Created** (2 files):
- `docs/research/2026-01-22-rescan-folder-ui-research-plan.md`
- `docs/research/2026-01-22-rescan-folder-ui-synthesis.md`
- `docs/plans/2026-01-22-rescan-folder-ui-plan.md`

**Tests**: All 362 unit tests pass

**Result**: Users can now click the "Rescan" button in the FilterBar to detect new/modified files in the current folder. A toast notification shows the result.

---
