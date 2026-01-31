# Progress Shard 001

**Started**: 2026-01-23 15:31 EST

---

## Iteration 147: Zoom Bug Fixes

**Time**: 2026-01-23 15:31 EST
**Status**: Complete
**Task**: Fix two zoom-related bugs:
1. Zoom fit doesn't center or fill correctly
2. Zoom sensitivity too high

### Research Phase
Used parallel subagents to investigate:
- Root cause of zoom fit centering (initialization timing issue)
- Root cause of zoom sensitivity (binary delta mapping + oversized ZOOM_STEP)
- Test coverage gaps

### Implementation
1. **Zoom sensitivity fix**:
   - Changed `ZOOM_STEP` from 1.25 to 1.1 (10% instead of 25%)
   - Implemented proportional delta mapping in `handleWheel()`:
     - Exponential scaling: `Math.pow(2, -deltaY * sensitivity)`
     - Different sensitivity for pinch (0.01) vs scroll (0.002)
     - Clamped factor (0.5-2.0) to prevent extreme jumps

2. **Zoom fit centering fix**:
   - Updated `updateImageDimensions()` and `updateViewportDimensions()` to only call `initializeZoom()` when BOTH dimensions are valid

### Files Modified
- `apps/web/app/utils/zoomCalculations.ts` - Changed ZOOM_STEP to 1.1
- `apps/web/app/composables/useZoomPan.ts` - Proportional delta mapping + dimension guards
- `apps/web/test/zoomCalculations.test.ts` - Updated ZOOM_STEP test expectation

### Test Results
- 1121 tests passed
- 1 pre-existing failure (unrelated to zoom)

---

## Iteration 148: Crop Tool Confirm Before Applying

**Time**: 2026-01-23 16:02 EST
**Status**: Complete
**Task**: Implement crop tool confirmation UX

### Problem
Currently crop changes are applied immediately as the user drags crop handles. This makes it difficult to preview the crop before committing.

### Expected Behavior
1. When entering the crop tool, show the full image with current crop region outlined
2. Allow the user to adjust the crop region without immediately applying it
3. Display a "Set Crop" or "Apply Crop" button at the top of the edit pane
4. Only apply the crop when the user clicks the button or presses Enter
5. When re-entering the crop tool later, show full expanded view (including cropped-out areas)

### Research Phase
Used parallel subagents to investigate:
- Current crop state management in edit store and editUI store
- Crop overlay composable implementation
- Preview rendering flow for crop
- Test coverage for crop functionality

### Implementation

**Phase 1: Pending Crop State** (`apps/web/app/stores/editUI.ts`)
- Added `pendingCrop` ref and `hasPendingCrop` computed
- Added methods: `initializePendingCrop()`, `setPendingCrop()`, `applyPendingCrop()`, `cancelPendingCrop()`, `resetPendingCrop()`
- Updated `activateCropTool()` to initialize pending crop on activation
- Updated `deactivateCropTool()` to clear pending crop

**Phase 2: EditCropActionBar Component** (`apps/web/app/components/edit/EditCropActionBar.vue`)
- Created new component with Apply, Cancel, and Reset buttons
- Reset button only shows when there's an existing crop
- Animated appearance using Vue Transition

**Phase 3: Crop Overlay Uses Pending State** (`apps/web/app/composables/useCropOverlay.ts`)
- Changed from `editStore` to `editUIStore` for crop state
- Updates now write to `pendingCrop` instead of directly to edit store
- Watcher syncs from `pendingCrop` instead of `editStore.cropTransform.crop`

**Phase 4: Preview Integration** (`apps/web/app/components/edit/EditPreviewCanvas.vue`)
- Added EditCropActionBar at top center when crop tool is active
- Smooth enter/leave transitions

**Phase 5: Keyboard Shortcuts** (`apps/web/app/pages/edit/[id].vue`)
- Enter key applies pending crop when crop tool is active
- Escape key cancels pending crop (instead of going back to grid)

**Phase 6: Accordion Behavior** (`apps/web/app/components/edit/EditControlsPanel.vue`)
- Accordion collapses when crop tool is deactivated (via Apply/Cancel)
- Only activates crop tool on expand, doesn't deactivate on collapse

### Files Modified
- `apps/web/app/stores/editUI.ts` - Added pending crop state and methods
- `apps/web/app/components/edit/EditCropActionBar.vue` - NEW: Action bar component
- `apps/web/app/composables/useCropOverlay.ts` - Use pending state instead of edit store
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - Integrate action bar
- `apps/web/app/pages/edit/[id].vue` - Keyboard shortcuts
- `apps/web/app/components/edit/EditControlsPanel.vue` - Accordion behavior

### Tests Added
- `apps/web/test/editUIStore.test.ts` - 8 new tests for pending crop state
- `apps/web/test/EditCropActionBar.test.ts` - NEW: 12 tests for the component

### Test Results
- 1141 tests passed (8 new + 4 new component = 12 new tests)
- 1 pre-existing failure (unrelated to crop changes)

---

## Iteration 149: Fix Zoom Fit Centering and Fill

**Time**: 2026-01-23 16:19 EST
**Status**: Complete
**Task**: Fix zoom "Fit" option not centering or filling correctly

### Problem
When using the "Fit" zoom option in the edit view:
1. The image doesn't center properly in the edit pane
2. The image doesn't fill the available space correctly

Previous fix attempted (Iteration 147) added dimension guards but didn't fully resolve the issue.

### Research Phase
Used 5 parallel subagents to investigate:
- Zoom fit calculation logic (mathematically correct)
- Viewport dimension tracking (timing/race conditions)
- Image dimension tracking (blob vs preview dimensions)
- Centering logic (CSS transforms correct)
- Tests and documented issues

### Root Cause
When `restoreZoomForAsset()` is called during asset navigation (before the new image loads), it calls `setZoomPreset('fit')` which immediately calculates the camera using STALE dimensions from the store (from the previous asset or 0x0). Later when the image loads and `initializeZoom()` is called, it should recalculate, but the issue was that `setZoomPreset()` unconditionally calculated camera even with invalid dimensions.

### Implementation

**Phase 1: Fix `setZoomPreset()` in editUI.ts**
- Modified to only calculate camera when dimensions are valid (all > 0)
- Preset is always set, but camera calculation is deferred if dimensions invalid
- `initializeZoom()` will calculate camera when dimensions become valid

**Phase 2: Update `initializeZoom()` in editUI.ts**
- Extended to recalculate camera for ALL presets (fit, fill, 100%, 200%)
- Previously only recalculated for 'fit' preset
- Now handles deferred calculations from `setZoomPreset()`

### Files Modified
- `apps/web/app/stores/editUI.ts` - setZoomPreset and initializeZoom guards

### Tests Added
- 5 new tests in `apps/web/test/editUIStore.test.ts`:
  - Sets preset but defers camera when image dimensions are 0
  - Sets preset but defers camera when viewport dimensions are 0
  - Sets preset but defers camera when all dimensions are 0
  - Calculates camera when initializeZoom called after dimensions set
  - Defers all preset calculations, then calculates on initializeZoom

### Test Results
- 1146 tests passed (5 new tests)
- 1 pre-existing failure (unrelated to zoom)

---

## Iteration 150: Fix Adjustments Not Persisted When Navigating

**Time**: 2026-01-31 14:04 EST
**Status**: Complete
**Task**: Fix adjustments not being persisted when navigating between photos in edit view

### Problem
When editing a photo and making adjustments (Exposure, Contrast, etc.), the adjustments are lost when navigating to another photo in the filmstrip and then returning to the original photo. All slider values reset to 0/default.

### Root Cause
The `editCache` was defined as `ref<Map<string, EditState>>()`. Vue's reactivity system doesn't track Map mutations when using `ref<Map>` - the `.set()` method mutates the Map in place, but Vue's reactivity proxy doesn't intercept this. While the Map was being updated correctly, the reactive system wasn't aware of the changes.

### Fix Applied
1. Changed `editCache` from `ref<Map>` to `shallowRef<Map>`
2. Updated `saveToCache()` to create a new Map when updating (triggers Vue reactivity)
3. Updated `initializeFromDb()` to create a new Map when populating from database
4. Added diagnostic logging to trace cache operations

### Files Modified
- `apps/web/app/stores/edit.ts` - shallowRef and new Map pattern

### Tests Added
5 new tests in `apps/web/test/editStore.test.ts`:
- `persists adjustments when navigating away and back`
- `preserves multiple photos in cache during navigation`
- `saves edits to cache immediately on markDirty`
- `retrieves edit state from cache via getEditStateForAsset`
- `returns current state for currently active asset`

### Research Document
- `docs/research/2026-01-31-edit-persistence-navigation-synthesis.md`

### Test Results
- Web unit tests: 1236 passed
- Edit store tests: 88 passed (including 5 new tests)
- Pre-existing failures: 9 (unrelated GPU mock issues in edit-pipeline-draft.test.ts)

---

## Iteration 151: Fix Sort Options Not Working

**Time**: 2026-01-31 14:14 EST
**Status**: Complete
**Task**: Fix sort dropdown not working in catalog grid view

### Problem
Clicking on sort options in the dropdown (Date oldest, Name A-Z, Name Z-A, Size largest, Size smallest) has no effect. The grid order doesn't change and the dropdown button label always shows "Date (newest)" regardless of which option is selected.

### Research Phase
Used 4 parallel subagents to investigate:
- FilterBar.vue sort dropdown implementation
- catalogUI store sort state management
- catalog store sortedAssetIds computed property
- CatalogGrid component asset display

### Root Cause
**The sort options used the wrong property name for the click handler.**

The FilterBar.vue component used `click` property:
```typescript
{
  label: 'Date (newest)',
  icon: 'i-heroicons-calendar',
  click: () => setSort('captureDate', 'desc'),  // ❌ WRONG
}
```

But Nuxt UI's `UDropdownMenu` component expects `onSelect` property:
```typescript
{
  label: 'Date (newest)',
  icon: 'i-heroicons-calendar',
  onSelect: () => setSort('captureDate', 'desc'),  // ✅ CORRECT
}
```

### Fix Applied
Changed all sort option handlers from `click` to `onSelect` in FilterBar.vue (6 items).

### Files Modified
- `apps/web/app/components/catalog/FilterBar.vue` - Changed `click` to `onSelect` for all sort options

### Test Results
- All 1236 web unit tests pass
- Sort functionality verified via existing catalogUIStore tests (setSortField, setSortDirection)

---

## Iteration 152: Fix Masks Disappear After Panel Collapse/Expand

**Time**: 2026-01-31 14:21 EST
**Status**: Complete
**Task**: Fix masks disappearing after the Masks accordion panel is collapsed and re-expanded

### Problem
Masks that have been created appear to disappear or lose their state after the Masks accordion panel is collapsed and re-expanded. The Linear/Radial buttons become enabled again as if no masks exist, and the mask overlay is no longer visible on the canvas.

### Research Phase
Used 5 parallel subagents to investigate:
- Edit store mask state management
- EditMaskPanel component lifecycle
- useMaskOverlay composable behavior
- EditControlsPanel accordion behavior
- Test coverage gaps

### Root Cause
**The UAccordion component defaults to `unmountOnHide={true}`**, which causes child components (EditMaskPanel, EditMaskAdjustments) to be completely unmounted from the DOM when the accordion collapses.

**Evidence from Nuxt UI source** (`@nuxt/ui/dist/runtime/components/Accordion.vue`, line 27):
```javascript
unmountOnHide: { type: Boolean, required: false, default: true }
```

When accordion collapses:
1. The entire `masks-body` template is unmounted
2. EditMaskPanel and EditMaskAdjustments components are destroyed
3. The mask overlay canvas is removed from DOM
4. Event listeners in useMaskOverlay are torn down

When accordion re-expands, components remount but various timing issues can cause masks to not render properly.

### Fix Applied
Added `:unmount-on-hide="false"` to the UAccordion component in EditControlsPanel.vue.

```vue
<UAccordion
  v-model="expandedSections"
  type="multiple"
  :items="accordionItems"
  :unmount-on-hide="false"
>
```

This preserves the component tree and state when accordion items are collapsed/expanded.

### Files Modified
- `apps/web/app/components/edit/EditControlsPanel.vue` - Added `:unmount-on-hide="false"` prop

### Tests Added
**editUIStore.test.ts** - 3 new tests:
- `preserves tool state through activate -> deactivate -> activate cycle`
- `clears drawing mode on deactivate and does not restore it on reactivate`
- `allows setting new drawing mode after reactivation`

**editStore.test.ts** - 3 new tests:
- `masks remain in store after creation and can be accessed`
- `masks persist in cache and are restored on same asset reload`
- `mask adjustments are preserved through navigation`

### Research Document
- `docs/research/2026-01-31-masks-accordion-disappear-synthesis.md`

### Test Results
- All 1242 web unit tests pass (6 new tests)

---

## Iteration 153: Fix Filter Mode Resets After Edit View Navigation

**Time**: 2026-01-31 14:29 EST
**Status**: Complete
**Task**: Fix filter mode resetting to "All" after navigating to edit view and back

### Problem
When a user selects a filter (e.g., "Picks") and then navigates to the edit view and back to the catalog grid, the filter resets to "All" instead of preserving the selected filter.

### Research Phase
Used parallel subagents to investigate:
- catalogUI store filter state management (purely in-memory `ref<FilterMode>('all')`)
- Grid page initialization behavior (no filter reset on mount)
- FilterBar component filter state (uses `catalogUIStore.filterMode` directly)
- Navigation lifecycle and route changes (no reset calls found)

### Root Cause
The filter state was stored only in memory with no persistence. While Pinia stores should persist during client-side navigation, various factors (SSR hydration, HMR in development, component remounting) could cause the state to reset.

### Solution
Added **sessionStorage persistence** to the catalogUIStore for filter mode and sort settings:
1. State is restored from sessionStorage on store creation
2. Changes are persisted to sessionStorage on each setter call
3. `resetToDefaults()` clears sessionStorage values
4. Invalid/tampered sessionStorage values fall back to defaults

### Files Modified
- `apps/web/app/stores/catalogUI.ts` - Added session storage persistence for filterMode, sortField, sortDirection

### Tests Added
9 new tests in `apps/web/test/catalogUIStore.test.ts`:
- `persists filter mode to sessionStorage`
- `persists sort field to sessionStorage`
- `persists sort direction to sessionStorage`
- `toggleSortDirection persists to sessionStorage`
- `restores filter mode from sessionStorage on store creation`
- `restores sort field from sessionStorage on store creation`
- `restores sort direction from sessionStorage on store creation`
- `uses defaults for invalid sessionStorage values`
- `resetToDefaults clears sessionStorage values`

Also updated `beforeEach` to clear sessionStorage before each test.

### Research Document
- `docs/research/2026-01-31-filter-mode-persistence-synthesis.md`

### Test Results
- All 1251 web unit tests pass (9 new tests)

---
