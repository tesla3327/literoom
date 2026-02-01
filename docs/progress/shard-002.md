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

