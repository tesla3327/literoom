# Crop Tool Confirm Before Applying - Implementation Plan

**Date**: 2026-01-23
**Research**: `docs/research/2026-01-23-crop-confirm-before-apply-synthesis.md`

## Overview

Implement a confirmation workflow for the crop tool where changes are only applied when the user explicitly confirms them, rather than being applied immediately.

## Phase 1: Add Pending Crop State to EditUI Store

**File**: `apps/web/app/stores/editUI.ts`

Add new state and methods:
```typescript
// State
const pendingCrop = ref<CropRectangle | null>(null)
const hasPendingCrop = computed(() => pendingCrop.value !== null)

// Methods
function setPendingCrop(crop: CropRectangle | null): void {
  pendingCrop.value = crop ? { ...crop } : null
}

function initializePendingCrop(): void {
  // Copy current crop from edit store to pending
  const editStore = useEditStore()
  pendingCrop.value = editStore.cropTransform.crop
    ? { ...editStore.cropTransform.crop }
    : { left: 0, top: 0, width: 1, height: 1 }
}

function applyPendingCrop(): void {
  const editStore = useEditStore()
  if (pendingCrop.value) {
    const crop = pendingCrop.value
    // Check if it's full image
    if (crop.left === 0 && crop.top === 0 && crop.width === 1 && crop.height === 1) {
      editStore.setCrop(null)
    } else {
      editStore.setCrop(pendingCrop.value)
    }
  }
  pendingCrop.value = null
  deactivateCropTool()
}

function cancelPendingCrop(): void {
  pendingCrop.value = null
  deactivateCropTool()
}

function resetPendingCrop(): void {
  pendingCrop.value = { left: 0, top: 0, width: 1, height: 1 }
}
```

Update `activateCropTool()` to initialize pending:
```typescript
function activateCropTool(): void {
  initializePendingCrop()
  isCropToolActive.value = true
}
```

**Tests**: Add to `apps/web/test/editUIStore.test.ts`

## Phase 2: Create EditCropActionBar Component

**File**: `apps/web/app/components/edit/EditCropActionBar.vue` (NEW)

```vue
<script setup lang="ts">
const editUIStore = useEditUIStore()
const editStore = useEditStore()

const hasExistingCrop = computed(() =>
  editStore.cropTransform.crop !== null
)

function handleApply() {
  editUIStore.applyPendingCrop()
}

function handleCancel() {
  editUIStore.cancelPendingCrop()
}

function handleReset() {
  editUIStore.resetPendingCrop()
}
</script>

<template>
  <div class="flex items-center justify-between p-3 bg-gray-800/90 backdrop-blur rounded-lg shadow-lg">
    <div class="flex items-center gap-2">
      <span class="text-sm text-gray-300">Adjust crop region</span>
    </div>
    <div class="flex items-center gap-2">
      <UButton
        v-if="hasExistingCrop"
        size="sm"
        variant="ghost"
        @click="handleReset"
      >
        Reset
      </UButton>
      <UButton
        size="sm"
        variant="soft"
        @click="handleCancel"
      >
        Cancel
      </UButton>
      <UButton
        size="sm"
        color="primary"
        @click="handleApply"
      >
        Set Crop
      </UButton>
    </div>
  </div>
</template>
```

## Phase 3: Modify useCropOverlay to Use Pending State

**File**: `apps/web/app/composables/useCropOverlay.ts`

Key changes:
1. Read from `editUIStore.pendingCrop` instead of `editStore.cropTransform.crop`
2. Write to `editUIStore.setPendingCrop()` instead of `editStore.setCrop()`
3. Remove debounced store updates (no longer needed since we're not persisting during drag)

```typescript
// Change from:
const localCrop = ref<CropRectangle>(
  editStore.cropTransform.crop
    ? { ...editStore.cropTransform.crop }
    : { left: 0, top: 0, width: 1, height: 1 }
)

// Change to:
const localCrop = ref<CropRectangle>(
  editUIStore.pendingCrop
    ? { ...editUIStore.pendingCrop }
    : { left: 0, top: 0, width: 1, height: 1 }
)

// Change commitCrop to update pending:
function commitCrop(): void {
  editUIStore.setPendingCrop({ ...localCrop.value })
}

// Update watcher to sync from pending state:
watch(
  () => editUIStore.pendingCrop,
  (newCrop) => {
    if (newCrop && !isDragging.value) {
      localCrop.value = { ...newCrop }
      render()
    }
  },
  { deep: true }
)
```

## Phase 4: Integrate Action Bar into Preview Canvas

**File**: `apps/web/app/components/edit/EditPreviewCanvas.vue`

Add the action bar component above the preview when crop tool is active:

```vue
<template>
  <div class="relative w-full h-full flex flex-col">
    <!-- Crop Action Bar -->
    <Transition name="slide-down">
      <EditCropActionBar
        v-if="editUIStore.isCropToolActive"
        class="absolute top-4 left-1/2 -translate-x-1/2 z-30"
      />
    </Transition>

    <!-- Existing preview content -->
    <div class="relative flex-1 ...">
      <!-- ... existing content ... -->
    </div>
  </div>
</template>
```

## Phase 5: Add Keyboard Shortcuts

**File**: `apps/web/app/pages/edit/[id].vue`

Add keyboard handlers in the existing `handleKeydown` function:

```typescript
function handleKeydown(e: KeyboardEvent) {
  // ... existing code ...

  // Crop tool shortcuts
  if (editUIStore.isCropToolActive) {
    if (e.key === 'Enter') {
      e.preventDefault()
      editUIStore.applyPendingCrop()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      editUIStore.cancelPendingCrop()
      return
    }
  }

  // ... rest of existing code ...
}
```

## Phase 6: Update EditControlsPanel

**File**: `apps/web/app/components/edit/EditControlsPanel.vue`

Update the accordion watcher to not auto-deactivate (let buttons control it):

```typescript
watch(
  () => expandedSections.value.includes('crop'),
  (isCropExpanded) => {
    if (isCropExpanded) {
      editUIStore.activateCropTool()
    }
    // Remove: auto-deactivate when collapsing
    // Let the Apply/Cancel buttons handle deactivation
  },
  { immediate: true },
)
```

Also collapse the accordion when crop tool is deactivated:

```typescript
watch(
  () => editUIStore.isCropToolActive,
  (isActive) => {
    if (!isActive && expandedSections.value.includes('crop')) {
      // Remove 'crop' from expanded sections
      expandedSections.value = expandedSections.value.filter(s => s !== 'crop')
    }
  }
)
```

## Phase 7: Update Tests

### editUIStore.test.ts
Add tests for:
- `initializePendingCrop()` - copies from edit store
- `setPendingCrop()` - updates pending state
- `applyPendingCrop()` - commits to edit store
- `cancelPendingCrop()` - clears pending, deactivates
- `resetPendingCrop()` - sets to full image

### EditCropActionBar.test.ts (NEW)
- Renders Apply, Cancel buttons
- Reset button shows only when existing crop
- Apply calls `applyPendingCrop()`
- Cancel calls `cancelPendingCrop()`
- Reset calls `resetPendingCrop()`

### crop-rotate.spec.ts (E2E)
Update workflow tests:
- Verify action bar appears when crop section expanded
- Test Apply button applies crop
- Test Cancel button reverts changes
- Test Enter key applies
- Test Escape key cancels

## Acceptance Criteria

1. ✅ Crop tool shows action bar when active
2. ✅ Changes only apply when "Set Crop" clicked
3. ✅ Cancel reverts to previous crop state
4. ✅ Enter key applies crop
5. ✅ Escape key cancels crop
6. ✅ Reset button clears crop to full image
7. ✅ Accordion collapses after apply/cancel
8. ✅ All existing tests pass
9. ✅ New tests for pending state

## Files Summary

| File | Action |
|------|--------|
| `apps/web/app/stores/editUI.ts` | Modify - add pending crop state |
| `apps/web/app/components/edit/EditCropActionBar.vue` | Create - new component |
| `apps/web/app/composables/useCropOverlay.ts` | Modify - use pending state |
| `apps/web/app/components/edit/EditPreviewCanvas.vue` | Modify - add action bar |
| `apps/web/app/pages/edit/[id].vue` | Modify - keyboard shortcuts |
| `apps/web/app/components/edit/EditControlsPanel.vue` | Modify - accordion behavior |
| `apps/web/test/editUIStore.test.ts` | Modify - add pending tests |
| `apps/web/test/EditCropActionBar.test.ts` | Create - component tests |
| `apps/web/e2e/crop-rotate.spec.ts` | Modify - update E2E tests |
