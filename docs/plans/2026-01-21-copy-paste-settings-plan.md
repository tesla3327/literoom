# Copy/Paste Settings Implementation Plan

**Date**: 2026-01-21
**Status**: Ready for Implementation
**Research**: `docs/research/2026-01-21-copy-paste-settings-synthesis.md`

---

## Overview

Implement the copy/paste settings feature that allows users to copy edit settings from one photo and paste them selectively to one or many other photos.

**V1 Requirements** (from spec section 3.6):
- "Copy settings…" action stores settings from current photo into clipboard
- "Paste settings…" opens modal with checkbox groups (Basic, Tone Curve, Crop, Masks)
- Paste to current photo or selected photos in grid
- Show confirmation toast after applying to many photos

---

## Phase 1: Create editClipboard Store

**File**: `apps/web/app/stores/editClipboard.ts`

### Types

```typescript
interface CopiedSettings {
  type: 'literoom-settings'
  version: 1
  timestamp: number
  sourceAssetId: string
  groups: {
    basicAdjustments: boolean
    toneCurve: boolean
    crop: boolean
    rotation: boolean
  }
  data: {
    adjustments?: Partial<Adjustments>
    toneCurve?: ToneCurve
    crop?: CropRectangle | null
    rotation?: RotationParameters
  }
}
```

### Store Implementation

```typescript
export const useEditClipboardStore = defineStore('editClipboard', () => {
  const copiedSettings = ref<CopiedSettings | null>(null)
  const showCopyModal = ref(false)

  // Groups selected for copy (user preferences)
  const selectedGroups = ref({
    basicAdjustments: true,
    toneCurve: true,
    crop: false,      // Excluded by default (safety)
    rotation: false   // Excluded by default (safety)
  })

  function openCopyModal() {
    showCopyModal.value = true
  }

  function closeCopyModal() {
    showCopyModal.value = false
  }

  function setCopiedSettings(settings: CopiedSettings) {
    copiedSettings.value = settings
  }

  function clear() {
    copiedSettings.value = null
  }

  function toggleGroup(group: keyof typeof selectedGroups.value) {
    selectedGroups.value[group] = !selectedGroups.value[group]
  }

  function selectAll() {
    selectedGroups.value = {
      basicAdjustments: true,
      toneCurve: true,
      crop: true,
      rotation: true
    }
  }

  function selectNone() {
    selectedGroups.value = {
      basicAdjustments: false,
      toneCurve: false,
      crop: false,
      rotation: false
    }
  }

  const hasClipboardContent = computed(() => copiedSettings.value !== null)

  return {
    copiedSettings,
    showCopyModal,
    selectedGroups,
    openCopyModal,
    closeCopyModal,
    setCopiedSettings,
    clear,
    toggleGroup,
    selectAll,
    selectNone,
    hasClipboardContent
  }
})
```

---

## Phase 2: Create useCopyPasteSettings Composable

**File**: `apps/web/app/composables/useCopyPasteSettings.ts`

### Implementation

```typescript
export function useCopyPasteSettings() {
  const clipboardStore = useEditClipboardStore()
  const editStore = useEditStore()
  const selectionStore = useSelectionStore()
  const catalogStore = useCatalogStore()
  const { copy: copyToClipboard } = useClipboard()

  const { addToast } = useToast()

  /**
   * Copy settings from current asset
   */
  function copySettings() {
    const currentId = selectionStore.currentId
    if (!currentId) return

    const { basicAdjustments, toneCurve, crop, rotation } = clipboardStore.selectedGroups

    const settings: CopiedSettings = {
      type: 'literoom-settings',
      version: 1,
      timestamp: Date.now(),
      sourceAssetId: currentId,
      groups: { basicAdjustments, toneCurve, crop, rotation },
      data: {}
    }

    if (basicAdjustments) {
      const { toneCurve: _, ...adjustments } = editStore.adjustments
      settings.data.adjustments = adjustments
    }

    if (toneCurve) {
      settings.data.toneCurve = editStore.adjustments.toneCurve
    }

    if (crop) {
      settings.data.crop = editStore.cropTransform.crop
    }

    if (rotation) {
      settings.data.rotation = editStore.cropTransform.rotation
    }

    clipboardStore.setCopiedSettings(settings)
    clipboardStore.closeCopyModal()

    // Also copy to system clipboard (optional)
    copyToClipboard(JSON.stringify(settings))

    addToast({
      title: 'Settings copied',
      description: 'Edit settings copied to clipboard'
    })
  }

  /**
   * Paste settings to target assets
   */
  async function pasteSettings(targetIds?: string[]) {
    const settings = clipboardStore.copiedSettings
    if (!settings) return

    // Determine targets
    const targets = targetIds ??
      (selectionStore.selectedIds.size > 0
        ? [...selectionStore.selectedIds]
        : selectionStore.currentId
          ? [selectionStore.currentId]
          : [])

    if (targets.length === 0) return

    // Apply to each target
    for (const assetId of targets) {
      await applySettingsToAsset(assetId, settings)
    }

    // Show feedback
    if (targets.length === 1) {
      addToast({
        title: 'Settings pasted',
        description: 'Edit settings applied'
      })
    } else {
      addToast({
        title: 'Settings pasted',
        description: `Applied to ${targets.length} photos`
      })
    }
  }

  /**
   * Apply settings to a single asset
   */
  async function applySettingsToAsset(assetId: string, settings: CopiedSettings) {
    // If current asset in edit view, use edit store
    if (assetId === selectionStore.currentId) {
      if (settings.data.adjustments) {
        editStore.setAdjustments(settings.data.adjustments)
      }
      if (settings.data.toneCurve) {
        editStore.setToneCurve(settings.data.toneCurve)
      }
      if (settings.data.crop !== undefined) {
        editStore.setCrop(settings.data.crop)
      }
      if (settings.data.rotation) {
        editStore.setRotation(settings.data.rotation)
      }
    } else {
      // For non-current assets, update via catalog service
      // This would need a new method in CatalogService
      // For v1, only support paste in Edit view (single photo)
      // Grid batch paste can be added in v1.1
    }
  }

  return {
    copySettings,
    pasteSettings,
    hasClipboard: clipboardStore.hasClipboardContent
  }
}
```

---

## Phase 3: Create EditCopySettingsModal Component

**File**: `apps/web/app/components/edit/EditCopySettingsModal.vue`

### Template Structure

```vue
<template>
  <UModal v-model:open="clipboardStore.showCopyModal">
    <template #header>
      <div class="flex items-center justify-between w-full">
        <h3 class="text-lg font-semibold">Copy Settings</h3>
        <div class="flex gap-2">
          <UButton size="xs" variant="ghost" @click="selectAll">All</UButton>
          <UButton size="xs" variant="ghost" @click="selectNone">None</UButton>
        </div>
      </div>
    </template>

    <template #body>
      <div class="space-y-4">
        <!-- Basic Adjustments Group -->
        <div class="space-y-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <UCheckbox v-model="selectedGroups.basicAdjustments" />
            <span class="font-medium">Basic Adjustments</span>
          </label>
          <p class="text-sm text-gray-500 ml-6">
            Exposure, Contrast, Temperature, Tint, Highlights, Shadows, Whites, Blacks, Vibrance, Saturation
          </p>
        </div>

        <!-- Tone Curve Group -->
        <div class="space-y-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <UCheckbox v-model="selectedGroups.toneCurve" />
            <span class="font-medium">Tone Curve</span>
          </label>
          <p class="text-sm text-gray-500 ml-6">
            Curve control points
          </p>
        </div>

        <!-- Crop Group -->
        <div class="space-y-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <UCheckbox v-model="selectedGroups.crop" />
            <span class="font-medium">Crop</span>
          </label>
          <p class="text-sm text-gray-500 ml-6">
            Crop rectangle (excluded by default)
          </p>
        </div>

        <!-- Rotation Group -->
        <div class="space-y-2">
          <label class="flex items-center gap-2 cursor-pointer">
            <UCheckbox v-model="selectedGroups.rotation" />
            <span class="font-medium">Rotation</span>
          </label>
          <p class="text-sm text-gray-500 ml-6">
            Rotation angle and straighten (excluded by default)
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton variant="ghost" @click="cancel">Cancel</UButton>
        <UButton variant="primary" @click="copy">Copy</UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
const clipboardStore = useEditClipboardStore()
const { copySettings } = useCopyPasteSettings()

const selectedGroups = computed(() => clipboardStore.selectedGroups)

function selectAll() {
  clipboardStore.selectAll()
}

function selectNone() {
  clipboardStore.selectNone()
}

function cancel() {
  clipboardStore.closeCopyModal()
}

function copy() {
  copySettings()
}
</script>
```

---

## Phase 4: Implement Paste Logic

Update `useCopyPasteSettings.ts` to handle batch paste in Grid view.

### Edit Store Extension

Add method to `apps/web/app/stores/edit.ts`:

```typescript
/**
 * Apply partial settings from clipboard
 */
function applySettings(settings: CopiedSettings['data']) {
  if (settings.adjustments) {
    setAdjustments(settings.adjustments)
  }
  if (settings.toneCurve) {
    setToneCurve(settings.toneCurve)
  }
  if (settings.crop !== undefined) {
    setCrop(settings.crop)
  }
  if (settings.rotation) {
    setRotation(settings.rotation)
  }
}
```

---

## Phase 5: Add Keyboard Shortcuts

### Edit Page Handler

Update `apps/web/app/pages/edit/[id].vue`:

```typescript
const { copySettings, pasteSettings } = useCopyPasteSettings()
const clipboardStore = useEditClipboardStore()

function handleKeydown(e: KeyboardEvent) {
  // ... existing code ...

  // Copy/Paste shortcuts (Cmd/Ctrl+Shift+C/V)
  if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
    if (e.key.toLowerCase() === 'c') {
      e.preventDefault()
      clipboardStore.openCopyModal()
      return
    }
    if (e.key.toLowerCase() === 'v') {
      e.preventDefault()
      pasteSettings()
      return
    }
  }
}
```

### Grid Page Handler

Update `apps/web/app/components/catalog/CatalogGrid.vue`:

```typescript
function handleKeydown(e: KeyboardEvent) {
  // ... existing code ...

  // Copy/Paste shortcuts for batch operations
  if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
    if (e.key.toLowerCase() === 'v') {
      e.preventDefault()
      pasteSettings()  // Will paste to all selected
      return
    }
  }
}
```

---

## Phase 6: UI Integration

### EditControlsPanel Buttons

Update `apps/web/app/components/edit/EditControlsPanel.vue`:

```vue
<!-- Add to header area -->
<div class="flex gap-2 px-4 py-2 border-b border-gray-700">
  <UButton
    size="sm"
    variant="ghost"
    icon="i-heroicons-document-duplicate"
    @click="openCopyModal"
  >
    Copy
  </UButton>
  <UButton
    size="sm"
    variant="ghost"
    icon="i-heroicons-clipboard-document"
    :disabled="!hasClipboard"
    @click="pasteSettings"
  >
    Paste
  </UButton>
</div>
```

### Toast Notifications

Use Nuxt UI's built-in toast system for feedback.

---

## Files Summary

### Create (4 files)
1. `apps/web/app/stores/editClipboard.ts` - Clipboard state
2. `apps/web/app/composables/useCopyPasteSettings.ts` - Copy/paste logic
3. `apps/web/app/components/edit/EditCopySettingsModal.vue` - Copy dialog
4. `apps/web/app/components/edit/EditPasteToast.vue` - Success feedback (optional)

### Modify (4 files)
1. `apps/web/app/stores/edit.ts` - Add applySettings method
2. `apps/web/app/pages/edit/[id].vue` - Keyboard shortcuts
3. `apps/web/app/components/edit/EditControlsPanel.vue` - Copy/Paste buttons
4. `apps/web/app/components/catalog/CatalogGrid.vue` - Grid paste support

---

## Testing Checklist

- [ ] Copy settings opens modal
- [ ] Modal shows all checkbox groups
- [ ] All/None preset buttons work
- [ ] Copy stores settings to clipboard
- [ ] Paste applies settings to current photo
- [ ] Paste applies settings to multiple selected photos
- [ ] Cmd+Shift+C opens copy modal
- [ ] Cmd+Shift+V pastes settings
- [ ] Toast shows after paste
- [ ] Crop/Rotation excluded by default
- [ ] Settings persist correctly (adjustments, curve, crop, rotation)

---

## Future Enhancements (Post-v1)

1. **Paste preview** - Show before/after comparison
2. **Paste history** - Access recent pastes
3. **Sync settings** - Alternative workflow for batch editing
4. **Selective paste dialog** - Choose what to paste (not just what was copied)
5. **Persist clipboard** - Survive page refresh (localStorage)
