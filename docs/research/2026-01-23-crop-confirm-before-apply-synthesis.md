# Crop Tool Confirm Before Applying - Research Synthesis

**Date**: 2026-01-23
**Status**: Complete

## Problem Statement

Currently crop changes are applied immediately as the user drags crop handles. This makes it difficult to preview the crop before committing.

### Expected Behavior
1. When entering the crop tool, show the full image with current crop region outlined
2. Allow the user to adjust the crop region without immediately applying it
3. Display a "Set Crop" or "Apply Crop" button at the top of the edit pane
4. Only apply the crop when the user clicks the button or presses Enter
5. When re-entering the crop tool later, show full expanded view (including cropped-out areas)

## Current Implementation Analysis

### State Architecture

**Edit Store** (`apps/web/app/stores/edit.ts`):
- `cropTransform: ref<CropTransform>` - The actual crop values
- `setCrop(crop)` - Immediately updates store and marks dirty
- All changes are persisted to IndexedDB immediately

**EditUI Store** (`apps/web/app/stores/editUI.ts`):
- `isCropToolActive: ref(false)` - Controls overlay visibility only
- Separate from actual crop values (UI state vs data state)

**useCropOverlay Composable** (`apps/web/app/composables/useCropOverlay.ts`):
- `localCrop` - Local state for responsive UI during drag
- Debounced store updates (32ms) during drag
- `commitCrop()` - Writes to store on mouse up

### Current Flow
```
User drags handle
    ↓
localCrop updated (immediate visual feedback)
    ↓
debouncedStoreUpdate() [32ms debounce]
    ↓
commitCrop() → editStore.setCrop()
    ↓
Preview re-renders with crop applied
```

### What Already Works
1. Full image shown when crop tool is active ✅
2. Overlay with handles, grid, dark mask ✅
3. Re-entering crop shows full image ✅

### What Needs to Change
1. Stop immediate store updates during crop editing
2. Add "pending" crop state that doesn't affect preview
3. Add Apply/Cancel buttons and keyboard shortcuts
4. Only commit to store when explicitly applied

## Proposed Architecture

### New State: Pending Crop

Add to `editUIStore`:
```typescript
// Pending crop state (not yet applied to edit store)
const pendingCrop = ref<CropRectangle | null>(null)
const hasPendingCrop = computed(() => pendingCrop.value !== null)

// Methods
function setPendingCrop(crop: CropRectangle | null): void
function applyPendingCrop(): void  // Commits to editStore
function cancelPendingCrop(): void  // Discards pending, reverts to stored
function resetPendingCrop(): void   // Resets to no crop
```

### Modified Flow
```
User drags handle
    ↓
pendingCrop updated (visual feedback in overlay only)
    ↓
Preview shows full image + crop overlay
    ↓
User clicks "Apply Crop" or presses Enter
    ↓
editStore.setCrop(pendingCrop)
    ↓
Preview re-renders with crop applied
    ↓
pendingCrop cleared, tool deactivated
```

### UI Changes

**Crop Action Bar** (new component):
- Appears at top of edit pane when crop tool is active
- Contains:
  - "Apply Crop" button (primary)
  - "Cancel" button (secondary)
  - "Reset" button (if there's an existing crop)
- Keyboard shortcuts:
  - Enter → Apply
  - Escape → Cancel

**Preview Behavior**:
- When crop tool active: Show full image, overlay shows pending crop
- When crop tool inactive: Show cropped result (existing behavior)

## Key Files to Modify

1. `apps/web/app/stores/editUI.ts` - Add pending crop state
2. `apps/web/app/composables/useCropOverlay.ts` - Use pending crop instead of store
3. `apps/web/app/components/edit/EditCropActionBar.vue` - NEW: Action buttons
4. `apps/web/app/components/edit/EditPreviewCanvas.vue` - Integrate action bar
5. `apps/web/app/pages/edit/[id].vue` - Keyboard shortcuts
6. `apps/web/app/components/edit/EditControlsPanel.vue` - Connect accordion to pending state

## Test Coverage Considerations

Existing tests to update:
- `editUIStore.test.ts` - Add pending crop state tests
- `cropUtils.test.ts` - Already comprehensive, no changes
- `crop-rotate.spec.ts` - Update E2E for new workflow

New tests needed:
- Pending crop state management
- Apply/cancel button interactions
- Keyboard shortcut tests
- Workflow: activate → adjust → apply → verify
- Workflow: activate → adjust → cancel → verify reverted

## Implementation Phases

1. **Phase 1**: Add pending crop state to editUI store
2. **Phase 2**: Create EditCropActionBar component
3. **Phase 3**: Modify useCropOverlay to use pending state
4. **Phase 4**: Integrate action bar into preview canvas
5. **Phase 5**: Add keyboard shortcuts
6. **Phase 6**: Update tests

## Risk Assessment

- **Low Risk**: Adding pending state is additive
- **Low Risk**: Action bar is new component
- **Medium Risk**: Modifying useCropOverlay flow - needs careful testing
- **Low Risk**: Keyboard shortcuts follow existing patterns

## References

- Issue: `docs/issues.md` - "Crop tool should confirm before applying"
- Current implementation: `apps/web/app/composables/useCropOverlay.ts`
- State management: `apps/web/app/stores/editUI.ts`
