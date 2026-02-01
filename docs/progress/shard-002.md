# Progress Shard 002

**Started**: 2026-01-31 21:21 EST

---

## Iteration 161: Fix Masks Panel Collapses Unexpectedly When Scrolling

**Time**: 2026-01-31 21:21 EST
**Status**: Complete
**Task**: Fix the Masks accordion panel collapsing unexpectedly when scrolling the page

### Problem
When the Masks accordion panel is expanded and the user scrolls the page (using mouse wheel or scrollbar), the Masks panel unexpectedly collapses. This forces users to repeatedly re-expand the panel while working with masks.

### Research Phase
Used 5 parallel subagents to investigate:
1. EditControlsPanel accordion state management
2. UAccordion/Reka-UI v-model behavior with scroll events
3. editUI store mask-related state
4. Edit page scroll handlers
5. Existing accordion test patterns

### Root Cause Analysis
The issue was difficult to reproduce programmatically, but research identified that:
- UAccordion wraps Reka-UI's AccordionRoot which uses `useSingleOrMultipleValue` for state management
- Accordion triggers only respond to click events, not scroll
- However, during scroll events, some browser/Vue reactivity behaviors could cause spurious state changes

### Solution Implemented
Added scroll protection to the masks accordion in `EditControlsPanel.vue`:

1. **Scroll Detection**: Tracks when user is scrolling the right panel
   - `isScrolling` ref set to `true` during scroll
   - Timeout clears flag 150ms after scroll ends

2. **Scrollable Parent Detection**: Finds and attaches listener to parent `<aside>` element
   - Uses `findScrollableParent()` to locate element with `overflow-y: auto`
   - Attaches scroll listener on mount, removes on unmount

3. **Spurious Collapse Prevention**: Guards against unintended collapses
   - If masks accordion collapses during scroll AND user is actively working with masks
   - (drawing mode active OR mask selected), restore the expanded state
   - Uses `nextTick()` to restore state after Vue's update cycle

### Files Modified
- `apps/web/app/components/edit/EditControlsPanel.vue` - Added scroll protection logic

### Files Created
- `apps/web/test/masksScrollProtection.test.ts` - 10 tests for scroll protection

### Tests Added
10 new tests covering:
- Scroll detection flag behavior
- Scroll timeout extension during continuous scrolling
- Protection logic with active drawing mode
- Protection logic with selected mask
- Allowing legitimate collapse when not scrolling
- Allowing collapse when not actively working with masks
- Scrollable parent detection
- Edge cases for rapid scrolling and cleanup

### Research Document
- `docs/research/2026-01-31-masks-scroll-collapse-synthesis.md`

### Test Results
- All 1303 web unit tests pass (10 new tests)

---

## Iteration 162: Crop Re-edit Shows Full Uncropped Image

**Time**: 2026-01-31 21:31 EST
**Status**: Complete
**Task**: Fix the crop tool to show full uncropped image when re-editing a previously cropped photo

### Problem
When re-entering the crop tool on an already-cropped image, the view only shows the currently cropped region. Users cannot see the parts of the image that were previously cropped out, making it impossible to expand the crop to include previously excluded areas. This doesn't match Lightroom's behavior where you can always see the full image when adjusting crop.

### Research Phase
Used 5 parallel subagents to investigate:
1. Crop state storage in editUI.ts and edit.ts
2. Preview crop handling in EditPreviewCanvas.vue and useEditPreview.ts
3. Edit pipeline crop application in GPU and WASM paths
4. Crop editor UI components and their relationships
5. Expected Lightroom-style crop re-edit UX

### Root Cause Analysis
In `useEditPreview.ts`, the render pipeline checked `hasCrop` (whether crop exists in store) to decide which rendering path to use:
- **PATH A**: No crop → unified GPU pipeline (shows full image)
- **PATH B**: Has crop → crop applied via WASM (shows cropped image)

The problem was that the code did NOT check `isCropToolActive` before applying crop. When the crop tool was active (user re-editing), the crop was still applied, preventing users from seeing the full uncropped image.

### Solution Implemented
Added `shouldApplyCrop` logic that checks both conditions:
```typescript
const editUIStore = useEditUIStore()
const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive
```

Updated all three rendering paths:
1. **PATH A condition**: Changed from `!hasCrop` to `!shouldApplyCrop`
2. **PATH B condition**: Changed from `hasCrop` to `shouldApplyCrop`
3. **PATH C fallback**: Changed from `if (crop)` to `if (shouldApplyCrop && crop)`

Now when the crop tool is active, the preview shows the full uncropped image with the crop overlay on top, allowing users to expand the crop to include previously excluded areas.

### Files Modified
- `apps/web/app/composables/useEditPreview.ts` - Added import for editUIStore, added shouldApplyCrop logic

### Files Created
- `apps/web/test/cropReeditFullImage.test.ts` - 14 tests for crop re-edit behavior
- `docs/research/2026-01-31-crop-reedit-fullimage-synthesis.md` - Research synthesis
- `docs/plans/2026-01-31-crop-reedit-fullimage-plan.md` - Implementation plan

### Tests Added
14 new tests covering:
- shouldApplyCrop logic (no crop, crop with tool active, crop with tool inactive)
- Crop tool activation/deactivation
- Pending crop initialization, apply, cancel, reset
- Edge cases (rapid activation, with adjustments, with rotation)

### Test Results
- All 1317 web unit tests pass (14 new tests)
- All 2395 core tests pass (except 9 pre-existing GPU mock failures)

