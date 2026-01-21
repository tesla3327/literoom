# Phase 8: Edit View Implementation Plan

**Date**: 2026-01-21
**Status**: Ready for Implementation
**Research**: [Edit View Synthesis](../research/2026-01-21-edit-view-synthesis.md)

---

## Overview

Phase 8 implements the photo editing view with:
1. Single photo preview with zoom/pan
2. Basic adjustment sliders (10 controls)
3. Real-time preview updates
4. Edit state persistence

This phase focuses on the **vertical slice** approach: deliver a working edit experience before adding advanced features (tone curve, crop, histogram) in subsequent phases.

---

## Implementation Phases

### Phase 8.1: Edit Page Shell

**Goal**: Create the edit view layout with navigation and preview display.

#### 8.1.1 Create `/edit/[id]` route

Create `apps/web/app/pages/edit/[id].vue`:

```vue
<script setup lang="ts">
const route = useRoute()
const assetId = computed(() => route.params.id as string)

const catalogStore = useCatalogStore()
const asset = computed(() => catalogStore.assets.get(assetId.value))

// Navigate back
const router = useRouter()
function goBack() {
  router.push('/')
}
</script>

<template>
  <div class="h-screen flex flex-col bg-gray-950">
    <!-- Header -->
    <header class="h-12 border-b border-gray-800 flex items-center px-4 gap-4">
      <UButton variant="ghost" icon="i-heroicons-arrow-left" @click="goBack" />
      <span class="text-sm text-gray-400">{{ asset?.filename }}</span>
    </header>

    <!-- Main content -->
    <div class="flex-1 flex overflow-hidden">
      <!-- Left panel: histogram (placeholder) -->
      <aside class="w-64 border-r border-gray-800 p-4">
        <div class="text-sm text-gray-500">Histogram (coming soon)</div>
      </aside>

      <!-- Center: preview canvas -->
      <main class="flex-1 relative">
        <EditPreviewCanvas :asset-id="assetId" />
      </main>

      <!-- Right panel: edit controls -->
      <aside class="w-80 border-l border-gray-800 overflow-y-auto">
        <EditControlsPanel :asset-id="assetId" />
      </aside>
    </div>

    <!-- Bottom: filmstrip -->
    <EditFilmstrip class="h-24 border-t border-gray-800" />
  </div>
</template>
```

#### 8.1.2 Create `EditPreviewCanvas.vue`

Create `apps/web/app/components/EditPreviewCanvas.vue`:

```vue
<script setup lang="ts">
import type { Asset } from '@literoom/core/catalog'

const props = defineProps<{
  assetId: string
}>()

const catalogStore = useCatalogStore()
const asset = computed(() => catalogStore.assets.get(props.assetId))

// Canvas ref
const canvasRef = ref<HTMLCanvasElement | null>(null)

// Preview state
const isLoading = ref(true)
const previewUrl = ref<string | null>(null)

// Load preview when asset changes
watch(() => props.assetId, async (id) => {
  if (!id) return
  isLoading.value = true

  // TODO: Load full preview from decode service
  // For now, use thumbnail
  const a = catalogStore.assets.get(id)
  if (a?.thumbnailUrl) {
    previewUrl.value = a.thumbnailUrl
    isLoading.value = false
  }
}, { immediate: true })
</script>

<template>
  <div class="absolute inset-0 flex items-center justify-center bg-gray-900">
    <div v-if="isLoading" class="text-gray-500">Loading preview...</div>
    <img
      v-else-if="previewUrl"
      :src="previewUrl"
      :alt="asset?.filename"
      class="max-w-full max-h-full object-contain"
    />
  </div>
</template>
```

#### 8.1.3 Create placeholder components

**EditControlsPanel.vue**:
```vue
<script setup lang="ts">
defineProps<{ assetId: string }>()
</script>

<template>
  <div class="p-4">
    <h2 class="text-lg font-semibold mb-4">Edit</h2>
    <p class="text-sm text-gray-500">Controls coming soon...</p>
  </div>
</template>
```

**EditFilmstrip.vue**:
```vue
<script setup lang="ts">
const catalogStore = useCatalogStore()
</script>

<template>
  <div class="flex items-center gap-2 px-4 overflow-x-auto">
    <div
      v-for="id in catalogStore.assetIds.slice(0, 20)"
      :key="id"
      class="w-16 h-16 flex-shrink-0 bg-gray-800 rounded"
    >
      <img
        v-if="catalogStore.assets.get(id)?.thumbnailUrl"
        :src="catalogStore.assets.get(id)?.thumbnailUrl"
        class="w-full h-full object-cover rounded"
      />
    </div>
  </div>
</template>
```

#### 8.1.4 Add navigation from grid

Update `CatalogThumbnail.vue` to navigate on double-click:
```vue
<script setup lang="ts">
const router = useRouter()

function handleDoubleClick() {
  router.push(`/edit/${props.assetId}`)
}
</script>

<template>
  <div @dblclick="handleDoubleClick">
    <!-- existing content -->
  </div>
</template>
```

#### 8.1.5 Verification

- [ ] `/edit/[id]` route loads correctly
- [ ] Header shows filename and back button
- [ ] Three-panel layout displays correctly
- [ ] Double-click thumbnail navigates to edit
- [ ] Back button returns to grid

---

### Phase 8.2: Edit State Store

**Goal**: Create Pinia store for managing edit state.

#### 8.2.1 Create `apps/web/app/stores/edit.ts`

```typescript
import type { EditState, Adjustments } from '@literoom/core/catalog'
import { defineStore } from 'pinia'

export interface EditState {
  version: 1
  adjustments: Adjustments
}

export interface Adjustments {
  temperature: number
  tint: number
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  vibrance: number
  saturation: number
}

const DEFAULT_ADJUSTMENTS: Adjustments = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
}

export const useEditStore = defineStore('edit', () => {
  // Current asset being edited
  const currentAssetId = ref<string | null>(null)

  // Edit state
  const adjustments = ref<Adjustments>({ ...DEFAULT_ADJUSTMENTS })

  // Track if edits have been modified
  const isDirty = ref(false)

  // Load edit state for an asset
  async function loadForAsset(assetId: string) {
    currentAssetId.value = assetId
    // TODO: Load from database
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    isDirty.value = false
  }

  // Update a single adjustment
  function setAdjustment<K extends keyof Adjustments>(key: K, value: number) {
    adjustments.value[key] = value
    isDirty.value = true
  }

  // Reset to defaults
  function reset() {
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    isDirty.value = true
  }

  // Save to database
  async function save() {
    if (!currentAssetId.value) return
    // TODO: Save to database
    isDirty.value = false
  }

  return {
    currentAssetId,
    adjustments,
    isDirty,
    loadForAsset,
    setAdjustment,
    reset,
    save,
  }
})
```

#### 8.2.2 Verification

- [ ] Store initializes with default values
- [ ] `loadForAsset` sets current asset ID
- [ ] `setAdjustment` updates values and marks dirty
- [ ] `reset` restores defaults
- [ ] Store is reactive

---

### Phase 8.3: Basic Adjustments UI

**Goal**: Implement slider controls for all 10 adjustments.

#### 8.3.1 Create `EditAdjustmentSlider.vue`

```vue
<script setup lang="ts">
const props = defineProps<{
  label: string
  modelValue: number
  min: number
  max: number
  step?: number
}>()

const emit = defineEmits<{
  'update:modelValue': [value: number]
}>()

const displayValue = computed(() => {
  const val = props.modelValue
  if (val > 0) return `+${val.toFixed(props.step && props.step < 1 ? 2 : 0)}`
  return val.toFixed(props.step && props.step < 1 ? 2 : 0)
})
</script>

<template>
  <div class="flex items-center gap-3 py-1">
    <span class="w-24 text-sm text-gray-400">{{ label }}</span>
    <USlider
      :model-value="modelValue"
      :min="min"
      :max="max"
      :step="step ?? 1"
      class="flex-1"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <span class="w-12 text-right text-sm font-mono text-gray-300">
      {{ displayValue }}
    </span>
  </div>
</template>
```

#### 8.3.2 Update `EditControlsPanel.vue`

```vue
<script setup lang="ts">
defineProps<{ assetId: string }>()

const editStore = useEditStore()

// Adjustment configurations
const adjustments = [
  { key: 'temperature', label: 'Temperature', min: -100, max: 100 },
  { key: 'tint', label: 'Tint', min: -100, max: 100 },
  { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01 },
  { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
  { key: 'whites', label: 'Whites', min: -100, max: 100 },
  { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
  { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
  { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
] as const

function handleAdjustmentChange(key: string, value: number) {
  editStore.setAdjustment(key as keyof Adjustments, value)
}
</script>

<template>
  <div class="p-4 space-y-6">
    <!-- Header with reset -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">Edit</h2>
      <UButton
        variant="ghost"
        size="xs"
        icon="i-heroicons-arrow-path"
        :disabled="!editStore.isDirty"
        @click="editStore.reset()"
      >
        Reset
      </UButton>
    </div>

    <!-- Basic Adjustments -->
    <UAccordion
      :items="[{ label: 'Basic', value: 'basic', defaultOpen: true }]"
      type="single"
      collapsible
    >
      <template #basic>
        <div class="space-y-1 pt-2">
          <EditAdjustmentSlider
            v-for="adj in adjustments"
            :key="adj.key"
            :label="adj.label"
            :model-value="editStore.adjustments[adj.key]"
            :min="adj.min"
            :max="adj.max"
            :step="adj.step"
            @update:model-value="handleAdjustmentChange(adj.key, $event)"
          />
        </div>
      </template>
    </UAccordion>
  </div>
</template>
```

#### 8.3.3 Wire edit page to store

Update `apps/web/app/pages/edit/[id].vue`:

```vue
<script setup lang="ts">
const route = useRoute()
const assetId = computed(() => route.params.id as string)

const editStore = useEditStore()

// Load edit state when asset changes
watch(assetId, async (id) => {
  if (id) {
    await editStore.loadForAsset(id)
  }
}, { immediate: true })
</script>
```

#### 8.3.4 Verification

- [ ] All 10 sliders display correctly
- [ ] Slider values update in store
- [ ] Display shows formatted values (+/- prefix)
- [ ] Reset button clears all values
- [ ] Accordion expands/collapses

---

### Phase 8.4: Preview with Edits

**Goal**: Apply adjustments to preview in real-time.

This phase requires WASM changes. For MVP, we'll implement a placeholder that shows the concept works.

#### 8.4.1 Create preview composable

Create `apps/web/app/composables/useEditPreview.ts`:

```typescript
import { useDebounceFn } from '@vueuse/core'

export function useEditPreview(assetId: Ref<string>) {
  const editStore = useEditStore()
  const catalogStore = useCatalogStore()

  const previewUrl = ref<string | null>(null)
  const isRendering = ref(false)
  const renderQuality = ref<'draft' | 'full'>('full')

  // Get source image URL
  const sourceUrl = computed(() => {
    const asset = catalogStore.assets.get(assetId.value)
    return asset?.thumbnailUrl ?? null
  })

  // Debounced render function
  const debouncedRender = useDebounceFn(async () => {
    if (!sourceUrl.value) return

    isRendering.value = true
    renderQuality.value = 'draft'

    // TODO: Apply adjustments via WASM
    // For now, just use source URL
    previewUrl.value = sourceUrl.value

    isRendering.value = false
    renderQuality.value = 'full'
  }, 300)

  // Watch for adjustment changes
  watch(
    () => editStore.adjustments,
    () => {
      debouncedRender()
    },
    { deep: true }
  )

  // Initial load
  watch(assetId, () => {
    previewUrl.value = sourceUrl.value
  }, { immediate: true })

  return {
    previewUrl,
    isRendering,
    renderQuality,
  }
}
```

#### 8.4.2 Update EditPreviewCanvas

```vue
<script setup lang="ts">
const props = defineProps<{
  assetId: string
}>()

const { previewUrl, isRendering, renderQuality } = useEditPreview(
  toRef(props, 'assetId')
)
</script>

<template>
  <div class="absolute inset-0 flex items-center justify-center bg-gray-900">
    <!-- Loading indicator -->
    <div
      v-if="isRendering"
      class="absolute top-4 right-4 text-xs text-gray-400"
    >
      Rendering...
    </div>

    <!-- Quality indicator -->
    <div
      v-if="renderQuality === 'draft'"
      class="absolute top-4 left-4 text-xs text-yellow-500"
    >
      Draft
    </div>

    <!-- Preview image -->
    <img
      v-if="previewUrl"
      :src="previewUrl"
      class="max-w-full max-h-full object-contain"
    />
  </div>
</template>
```

#### 8.4.3 Verification

- [ ] Preview displays source image
- [ ] Rendering indicator shows during updates
- [ ] Debouncing prevents excessive renders
- [ ] Preview updates when sliders change (visual placeholder)

---

### Phase 8.5: Keyboard Shortcuts

**Goal**: Add keyboard navigation for edit view.

#### 8.5.1 Update edit page with keyboard handling

```vue
<script setup lang="ts">
// ... existing code ...

// Keyboard shortcuts
function handleKeydown(e: KeyboardEvent) {
  // Ignore when typing in inputs
  if (e.target instanceof HTMLInputElement) return

  switch (e.key) {
    case 'Escape':
      goBack()
      break
    case 'ArrowLeft':
      navigatePrev()
      break
    case 'ArrowRight':
      navigateNext()
      break
  }
}

// Navigate to prev/next asset
const selectionStore = useSelectionStore()
const filteredIds = computed(() => catalogStore.filteredAssetIds)

function navigatePrev() {
  const idx = filteredIds.value.indexOf(assetId.value)
  if (idx > 0) {
    router.push(`/edit/${filteredIds.value[idx - 1]}`)
  }
}

function navigateNext() {
  const idx = filteredIds.value.indexOf(assetId.value)
  if (idx < filteredIds.value.length - 1) {
    router.push(`/edit/${filteredIds.value[idx + 1]}`)
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>
```

#### 8.5.2 Verification

- [ ] Escape returns to grid
- [ ] Left/Right arrows navigate between photos
- [ ] Shortcuts don't fire when typing

---

## File Summary

```
apps/web/app/
├── pages/
│   └── edit/
│       └── [id].vue              # 8.1.1 - Edit page route
├── components/
│   ├── EditPreviewCanvas.vue     # 8.1.2 - Preview canvas
│   ├── EditControlsPanel.vue     # 8.1.3, 8.3.2 - Controls panel
│   ├── EditFilmstrip.vue         # 8.1.3 - Filmstrip navigation
│   └── EditAdjustmentSlider.vue  # 8.3.1 - Slider component
├── composables/
│   └── useEditPreview.ts         # 8.4.1 - Preview management
└── stores/
    └── edit.ts                   # 8.2.1 - Edit state store
```

---

## Verification Checklist

After all phases complete:

**Edit Page Shell (8.1):**
- [ ] Edit page loads at `/edit/[id]`
- [ ] Three-panel layout (left/center/right)
- [ ] Header with filename and back button
- [ ] Filmstrip shows other photos
- [ ] Double-click thumbnail opens edit

**Edit State Store (8.2):**
- [ ] Store manages adjustment values
- [ ] Dirty flag tracks changes
- [ ] Reset function works

**Basic Adjustments UI (8.3):**
- [ ] All 10 sliders display
- [ ] Values update reactively
- [ ] Reset button works
- [ ] Accordion organization

**Preview with Edits (8.4):**
- [ ] Preview displays source image
- [ ] Rendering indicator during updates
- [ ] Debounced updates

**Keyboard Shortcuts (8.5):**
- [ ] Escape → back to grid
- [ ] Left/Right → prev/next photo

---

## Future Phases

After Phase 8, continue with:

- **Phase 9**: WASM Edit Pipeline - `apply_adjustments()` function
- **Phase 10**: Histogram Display - Canvas rendering + clipping overlay
- **Phase 11**: Tone Curve Editor - Interactive curve UI
- **Phase 12**: Crop & Transform - Crop overlay, rotation, straighten
- **Phase 13**: Copy/Paste Settings - Clipboard management
- **Phase 14**: Export Dialog - File export workflow

---

## Dependencies

No new dependencies required. Using:
- Nuxt UI (USlider, UAccordion, UButton)
- VueUse (useDebounceFn)
- Pinia (store)
- Vue Router (navigation)
