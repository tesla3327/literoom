# Local Masks UI Implementation Plan

**Created**: 2026-01-21 21:50 EST
**Based on**: Research synthesis from 4 parallel agents

## Overview

Implement the user interface for Local Adjustment Masks (Phase 7). The backend infrastructure is complete - this phase focuses on creating the UI for creating and editing linear and radial gradient masks.

---

## Phase 7.1: Edit UI Store Extensions

**Objective**: Add mask-related UI state to editUI store.

**File**: `apps/web/app/stores/editUI.ts`

**Changes**:
```typescript
// New state
const isMaskToolActive = ref(false)
const maskDrawingMode = ref<'linear' | 'radial' | null>(null)

// New methods
function activateMaskTool(): void {
  isMaskToolActive.value = true
}

function deactivateMaskTool(): void {
  isMaskToolActive.value = false
  maskDrawingMode.value = null
}

function setMaskDrawingMode(mode: 'linear' | 'radial' | null): void {
  maskDrawingMode.value = mode
  if (mode) isMaskToolActive.value = true
}

// Export new state/methods
```

---

## Phase 7.2: Mask Panel Component

**Objective**: Create the mask list panel UI for adding/managing masks.

**New File**: `apps/web/app/components/edit/EditMaskPanel.vue`

**Template Structure**:
```vue
<script setup lang="ts">
const editStore = useEditStore()
const editUIStore = useEditUIStore()

// Mask list combining linear and radial
const allMasks = computed(() => {
  if (!editStore.masks) return []
  return [
    ...editStore.masks.linearMasks.map(m => ({ type: 'linear' as const, mask: m })),
    ...editStore.masks.radialMasks.map(m => ({ type: 'radial' as const, mask: m })),
  ]
})

function handleAddLinear() {
  editUIStore.setMaskDrawingMode('linear')
}

function handleAddRadial() {
  editUIStore.setMaskDrawingMode('radial')
}

function handleSelectMask(id: string) {
  editStore.selectMask(id)
}

function handleToggleMask(id: string) {
  editStore.toggleMaskEnabled(id)
}

function handleDeleteMask(id: string) {
  editStore.deleteMask(id)
}
</script>

<template>
  <div class="space-y-3">
    <!-- Add mask buttons -->
    <div class="flex gap-2">
      <UButton size="xs" variant="outline" @click="handleAddLinear">
        <UIcon name="i-heroicons-minus" class="w-3 h-3 mr-1" />
        Linear
      </UButton>
      <UButton size="xs" variant="outline" @click="handleAddRadial">
        <UIcon name="i-heroicons-stop" class="w-3 h-3 mr-1" />
        Radial
      </UButton>
    </div>

    <!-- Mask list -->
    <div v-if="allMasks.length > 0" class="space-y-1">
      <div
        v-for="{ type, mask } in allMasks"
        :key="mask.id"
        class="flex items-center gap-2 p-2 rounded hover:bg-gray-800"
        :class="{ 'bg-gray-800 ring-1 ring-blue-500': editStore.selectedMaskId === mask.id }"
        @click="handleSelectMask(mask.id)"
      >
        <!-- Visibility toggle -->
        <button
          class="p-1 rounded hover:bg-gray-700"
          :title="mask.enabled ? 'Hide mask' : 'Show mask'"
          @click.stop="handleToggleMask(mask.id)"
        >
          <UIcon
            :name="mask.enabled ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
            class="w-4 h-4"
            :class="mask.enabled ? 'text-gray-300' : 'text-gray-600'"
          />
        </button>

        <!-- Mask type icon and name -->
        <UIcon
          :name="type === 'linear' ? 'i-heroicons-minus' : 'i-heroicons-stop'"
          class="w-4 h-4 text-gray-400"
        />
        <span class="flex-1 text-sm text-gray-300">
          {{ type === 'linear' ? 'Linear' : 'Radial' }} Mask
        </span>

        <!-- Delete button -->
        <button
          class="p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-red-400"
          title="Delete mask"
          @click.stop="handleDeleteMask(mask.id)"
        >
          <UIcon name="i-heroicons-trash" class="w-4 h-4" />
        </button>
      </div>
    </div>

    <!-- Empty state -->
    <div v-else class="text-sm text-gray-500 text-center py-4">
      No masks yet. Click a button above to add one.
    </div>

    <!-- Drawing mode indicator -->
    <div
      v-if="editUIStore.maskDrawingMode"
      class="text-xs text-blue-400 flex items-center gap-1"
    >
      <UIcon name="i-heroicons-cursor-arrow-rays" class="w-3 h-3" />
      <span>Click and drag on the image to create a {{ editUIStore.maskDrawingMode }} gradient</span>
    </div>
  </div>
</template>
```

---

## Phase 7.3: Mask Adjustments Component

**Objective**: Create per-mask adjustment sliders.

**New File**: `apps/web/app/components/edit/EditMaskAdjustments.vue`

**Template Structure**:
```vue
<script setup lang="ts">
import type { MaskAdjustments } from '@literoom/core/catalog'

const editStore = useEditStore()

// Adjustment configuration (same as global, excluding toneCurve)
const adjustmentConfigs = [
  { key: 'exposure' as const, label: 'Exposure', min: -5, max: 5, step: 0.01 },
  { key: 'contrast' as const, label: 'Contrast', min: -100, max: 100 },
  { key: 'highlights' as const, label: 'Highlights', min: -100, max: 100 },
  { key: 'shadows' as const, label: 'Shadows', min: -100, max: 100 },
  { key: 'whites' as const, label: 'Whites', min: -100, max: 100 },
  { key: 'blacks' as const, label: 'Blacks', min: -100, max: 100 },
  { key: 'temperature' as const, label: 'Temp', min: -100, max: 100 },
  { key: 'tint' as const, label: 'Tint', min: -100, max: 100 },
  { key: 'vibrance' as const, label: 'Vibrance', min: -100, max: 100 },
  { key: 'saturation' as const, label: 'Saturation', min: -100, max: 100 },
]

function handleAdjustmentChange(key: keyof MaskAdjustments, value: number) {
  if (editStore.selectedMaskId) {
    editStore.setMaskAdjustment(editStore.selectedMaskId, key, value)
  }
}

function getAdjustmentValue(key: keyof MaskAdjustments): number {
  if (!editStore.selectedMask) return 0
  return editStore.selectedMask.mask.adjustments[key] ?? 0
}
</script>

<template>
  <div v-if="editStore.selectedMask" class="space-y-2">
    <div class="text-xs font-medium text-gray-500 uppercase tracking-wider">
      Mask Adjustments
    </div>
    <div class="space-y-0.5">
      <EditAdjustmentSlider
        v-for="adj in adjustmentConfigs"
        :key="adj.key"
        :label="adj.label"
        :model-value="getAdjustmentValue(adj.key)"
        :min="adj.min"
        :max="adj.max"
        :step="adj.step"
        @update:model-value="handleAdjustmentChange(adj.key, $event)"
      />
    </div>
  </div>
  <div v-else class="text-sm text-gray-500 text-center py-4">
    Select a mask to edit its adjustments
  </div>
</template>
```

---

## Phase 7.4: Integrate Mask Panel into Controls

**Objective**: Add masks section to EditControlsPanel accordion.

**File**: `apps/web/app/components/edit/EditControlsPanel.vue`

**Changes**:

1. Update accordion items:
```typescript
const accordionItems = [
  { value: 'basic', label: 'Basic', slot: 'basic' },
  { value: 'tonecurve', label: 'Tone Curve', slot: 'tonecurve' },
  { value: 'crop', label: 'Crop & Transform', slot: 'crop' },
  { value: 'masks', label: 'Masks', slot: 'masks' },  // NEW
]
```

2. Add watch for masks section expansion:
```typescript
watch(
  () => expandedSections.value.includes('masks'),
  (isMasksExpanded) => {
    if (isMasksExpanded) {
      editUIStore.activateMaskTool()
    }
    else {
      editUIStore.deactivateMaskTool()
    }
  },
  { immediate: true },
)
```

3. Add template slot:
```vue
<!-- Masks Section -->
<template #masks-body>
  <div class="pt-2 space-y-4">
    <EditMaskPanel />
    <hr class="border-gray-700" />
    <EditMaskAdjustments />
  </div>
</template>
```

---

## Phase 7.5: Mask Utilities

**Objective**: Create shared utilities for mask rendering and interaction.

**New File**: `apps/web/app/composables/maskUtils.ts`

**Contents**:
```typescript
import type { LinearGradientMask, RadialGradientMask } from '@literoom/core/catalog'

// ============================================================================
// Constants
// ============================================================================

export const HANDLE_SIZE = 10
export const HANDLE_HIT_RADIUS = 20

export const MASK_COLORS = {
  selectedLine: '#3b82f6',
  selectedHandle: '#3b82f6',
  selectedFill: 'rgba(59, 130, 246, 0.15)',
  unselectedLine: '#888888',
  unselectedHandle: '#888888',
  unselectedFill: 'rgba(100, 100, 100, 0.1)',
  featherLine: '#60a5fa',
}

// ============================================================================
// Coordinate Conversions
// ============================================================================

export function toCanvasCoords(
  normX: number,
  normY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: normX * canvasWidth,
    y: normY * canvasHeight,
  }
}

export function toNormalizedCoords(
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number; y: number } {
  return {
    x: Math.max(0, Math.min(1, canvasX / canvasWidth)),
    y: Math.max(0, Math.min(1, canvasY / canvasHeight)),
  }
}

export function getCanvasCoords(
  event: MouseEvent,
  canvas: HTMLCanvasElement,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  }
}

// ============================================================================
// Linear Gradient Handle Positions
// ============================================================================

export type LinearHandle = 'start' | 'end'

export function getLinearHandlePositions(
  mask: LinearGradientMask,
  canvasWidth: number,
  canvasHeight: number,
): Record<LinearHandle, { x: number; y: number }> {
  return {
    start: toCanvasCoords(mask.start.x, mask.start.y, canvasWidth, canvasHeight),
    end: toCanvasCoords(mask.end.x, mask.end.y, canvasWidth, canvasHeight),
  }
}

export function findLinearHandleAt(
  canvasX: number,
  canvasY: number,
  mask: LinearGradientMask,
  canvasWidth: number,
  canvasHeight: number,
): LinearHandle | null {
  const positions = getLinearHandlePositions(mask, canvasWidth, canvasHeight)

  for (const handle of ['start', 'end'] as LinearHandle[]) {
    const pos = positions[handle]
    const dist = Math.sqrt((canvasX - pos.x) ** 2 + (canvasY - pos.y) ** 2)
    if (dist <= HANDLE_HIT_RADIUS) return handle
  }

  return null
}

// ============================================================================
// Radial Gradient Handle Positions
// ============================================================================

export type RadialHandle = 'center' | 'radiusX+' | 'radiusX-' | 'radiusY+' | 'radiusY-'

export function getRadialHandlePositions(
  mask: RadialGradientMask,
  canvasWidth: number,
  canvasHeight: number,
): Record<RadialHandle, { x: number; y: number }> {
  const center = toCanvasCoords(mask.center.x, mask.center.y, canvasWidth, canvasHeight)
  const rx = mask.radiusX * canvasWidth
  const ry = mask.radiusY * canvasHeight
  const cos = Math.cos(mask.rotation * Math.PI / 180)
  const sin = Math.sin(mask.rotation * Math.PI / 180)

  return {
    center,
    'radiusX+': { x: center.x + rx * cos, y: center.y + rx * sin },
    'radiusX-': { x: center.x - rx * cos, y: center.y - rx * sin },
    'radiusY+': { x: center.x - ry * sin, y: center.y + ry * cos },
    'radiusY-': { x: center.x + ry * sin, y: center.y - ry * cos },
  }
}

export function findRadialHandleAt(
  canvasX: number,
  canvasY: number,
  mask: RadialGradientMask,
  canvasWidth: number,
  canvasHeight: number,
): RadialHandle | null {
  const positions = getRadialHandlePositions(mask, canvasWidth, canvasHeight)

  for (const handle of ['center', 'radiusX+', 'radiusX-', 'radiusY+', 'radiusY-'] as RadialHandle[]) {
    const pos = positions[handle]
    const dist = Math.sqrt((canvasX - pos.x) ** 2 + (canvasY - pos.y) ** 2)
    if (dist <= HANDLE_HIT_RADIUS) return handle
  }

  return null
}

// ============================================================================
// Rendering Functions
// ============================================================================

export function drawLinearMask(
  ctx: CanvasRenderingContext2D,
  mask: LinearGradientMask,
  canvasWidth: number,
  canvasHeight: number,
  isSelected: boolean,
  activeHandle: LinearHandle | null,
): void {
  const colors = isSelected ? {
    line: MASK_COLORS.selectedLine,
    handle: MASK_COLORS.selectedHandle,
    fill: MASK_COLORS.selectedFill,
  } : {
    line: MASK_COLORS.unselectedLine,
    handle: MASK_COLORS.unselectedHandle,
    fill: MASK_COLORS.unselectedFill,
  }

  const positions = getLinearHandlePositions(mask, canvasWidth, canvasHeight)

  // Draw gradient line
  ctx.beginPath()
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 2
  ctx.moveTo(positions.start.x, positions.start.y)
  ctx.lineTo(positions.end.x, positions.end.y)
  ctx.stroke()

  // Draw handles
  for (const handle of ['start', 'end'] as LinearHandle[]) {
    const pos = positions[handle]
    const isActive = activeHandle === handle

    ctx.beginPath()
    ctx.arc(pos.x, pos.y, HANDLE_SIZE / 2, 0, Math.PI * 2)
    ctx.fillStyle = isActive ? colors.handle : '#ffffff'
    ctx.fill()
    ctx.strokeStyle = colors.handle
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

export function drawRadialMask(
  ctx: CanvasRenderingContext2D,
  mask: RadialGradientMask,
  canvasWidth: number,
  canvasHeight: number,
  isSelected: boolean,
  activeHandle: RadialHandle | null,
): void {
  const colors = isSelected ? {
    line: MASK_COLORS.selectedLine,
    handle: MASK_COLORS.selectedHandle,
    fill: MASK_COLORS.selectedFill,
  } : {
    line: MASK_COLORS.unselectedLine,
    handle: MASK_COLORS.unselectedHandle,
    fill: MASK_COLORS.unselectedFill,
  }

  const center = toCanvasCoords(mask.center.x, mask.center.y, canvasWidth, canvasHeight)
  const rx = mask.radiusX * canvasWidth
  const ry = mask.radiusY * canvasHeight

  // Draw ellipse
  ctx.save()
  ctx.translate(center.x, center.y)
  ctx.rotate(mask.rotation * Math.PI / 180)

  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = colors.fill
  ctx.fill()
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 2
  ctx.stroke()

  ctx.restore()

  // Draw handles
  const positions = getRadialHandlePositions(mask, canvasWidth, canvasHeight)
  for (const handle of ['center', 'radiusX+', 'radiusX-', 'radiusY+', 'radiusY-'] as RadialHandle[]) {
    const pos = positions[handle]
    const isActive = activeHandle === handle

    ctx.beginPath()
    ctx.arc(pos.x, pos.y, HANDLE_SIZE / 2, 0, Math.PI * 2)
    ctx.fillStyle = isActive ? colors.handle : '#ffffff'
    ctx.fill()
    ctx.strokeStyle = colors.handle
    ctx.lineWidth = 2
    ctx.stroke()
  }
}

// ============================================================================
// Debounce Utility
// ============================================================================

export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  delay: number,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }) as T & { cancel: () => void }

  debounced.cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced
}
```

---

## Phase 7.6: Mask Overlay Composable

**Objective**: Create composable for mask overlay canvas interaction.

**New File**: `apps/web/app/composables/useMaskOverlay.ts`

This is the most complex phase. The composable will handle:
- Rendering all masks on the overlay canvas
- Handle hit detection and dragging
- Drawing mode for creating new masks
- Local state + debounced store sync

**Key Structure**:
```typescript
export function useMaskOverlay(options: UseMaskOverlayOptions) {
  const canvasRef = options.canvasRef
  const editStore = useEditStore()
  const editUIStore = useEditUIStore()

  // Local state
  const activeLinearHandle = ref<LinearHandle | null>(null)
  const activeRadialHandle = ref<RadialHandle | null>(null)
  const hoveredMaskId = ref<string | null>(null)
  const isDrawing = ref(false)
  const drawStart = ref<{ x: number; y: number } | null>(null)

  // Rendering
  function render(): void { ... }

  // Event handlers
  function handleMouseDown(e: MouseEvent): void { ... }
  function handleMouseMove(e: MouseEvent): void { ... }
  function handleMouseUp(e: MouseEvent): void { ... }
  function handleMouseLeave(e: MouseEvent): void { ... }

  // Computed
  const cursorStyle = computed(() => { ... })

  // Setup/teardown
  onMounted(() => { ... })
  onUnmounted(() => { ... })

  return { cursorStyle, isDrawing }
}
```

---

## Phase 7.7: Preview Canvas Integration

**Objective**: Add mask overlay canvas to EditPreviewCanvas.vue.

**File**: `apps/web/app/components/edit/EditPreviewCanvas.vue`

**Changes**:

1. Import composable:
```typescript
import { useMaskOverlay } from '~/composables/useMaskOverlay'
```

2. Add canvas ref and composable:
```typescript
const maskCanvasRef = ref<HTMLCanvasElement | null>(null)

const { cursorStyle: maskCursorStyle, isDrawing: isMaskDrawing } = useMaskOverlay({
  canvasRef: maskCanvasRef,
  displayWidth: computed(() => renderedDimensions.value.width),
  displayHeight: computed(() => renderedDimensions.value.height),
})
```

3. Add canvas element in template (after crop canvas):
```vue
<!-- Mask overlay canvas -->
<canvas
  v-if="editUIStore.isMaskToolActive"
  ref="maskCanvasRef"
  class="absolute top-0 left-0"
  :style="{ zIndex: 25, cursor: maskCursorStyle }"
  :width="renderedDimensions.width"
  :height="renderedDimensions.height"
/>
```

---

## Phase 7.8: Create Mask Functions

**Objective**: Add factory functions for creating new masks with defaults.

**File**: `packages/core/src/catalog/types.ts` (or create mask utilities file)

**Functions needed** (may already exist):
```typescript
export function createLinearMask(
  start: Point2D,
  end: Point2D,
): LinearGradientMask {
  return {
    id: crypto.randomUUID(),
    start,
    end,
    feather: 0.5,
    enabled: true,
    adjustments: {},
  }
}

export function createRadialMask(
  center: Point2D,
  radiusX: number,
  radiusY: number,
): RadialGradientMask {
  return {
    id: crypto.randomUUID(),
    center,
    radiusX,
    radiusY,
    rotation: 0,
    feather: 0.5,
    invert: false,
    enabled: true,
    adjustments: {},
  }
}
```

---

## Testing Plan

### Unit Tests
- `maskUtils.ts` - coordinate conversions, hit detection, handle positions
- Store actions coverage (already exists)

### Integration Tests
- Creating masks via UI buttons
- Selecting/deselecting masks
- Deleting masks
- Adjusting mask properties

### Manual Visual Tests
- Mask rendering on canvas
- Handle dragging responsiveness
- Cursor feedback
- Preview updates when masks change

---

## Summary of Changes

### New Files (4)
1. `apps/web/app/components/edit/EditMaskPanel.vue`
2. `apps/web/app/components/edit/EditMaskAdjustments.vue`
3. `apps/web/app/composables/maskUtils.ts`
4. `apps/web/app/composables/useMaskOverlay.ts`

### Modified Files (3)
1. `apps/web/app/stores/editUI.ts` - Add mask tool state
2. `apps/web/app/components/edit/EditControlsPanel.vue` - Add masks accordion section
3. `apps/web/app/components/edit/EditPreviewCanvas.vue` - Add mask overlay canvas

### Estimated Complexity
- Phase 7.1: Low (store additions)
- Phase 7.2: Medium (new component)
- Phase 7.3: Medium (new component)
- Phase 7.4: Low (template additions)
- Phase 7.5: Medium (utilities)
- Phase 7.6: High (complex interaction logic)
- Phase 7.7: Low (canvas integration)
- Phase 7.8: Low (factory functions)

---

## Next Steps

Start with Phase 7.1 (Edit UI Store Extensions) as it's the foundation for the rest.
