<script setup lang="ts">
/**
 * EditControlsPanel Component
 *
 * Right panel in edit view containing:
 * - Basic Adjustments (10 sliders)
 * - Tone Curve
 * - Crop & Transform
 */
import type { Adjustments } from '@literoom/core/catalog'

interface Props {
  /** The asset ID being edited */
  assetId: string
  /** Image width in pixels */
  imageWidth?: number
  /** Image height in pixels */
  imageHeight?: number
}

const props = defineProps<Props>()

// ============================================================================
// Stores
// ============================================================================

const editStore = useEditStore()
const editUIStore = useEditUIStore()
const _catalogStore = useCatalogStore()
const { openCopyModal, pasteSettings, canPaste, clipboardSummary } = useCopyPasteSettings()

// ============================================================================
// Computed
// ============================================================================

// Prefixed with _ because it's not currently used but will be needed for future features
const _asset = computed(() => _catalogStore.assets.get(props.assetId))

// ============================================================================
// Adjustment Configuration
// ============================================================================

/**
 * Numeric adjustment keys (excludes toneCurve).
 */
type NumericAdjustmentKey = Exclude<keyof Adjustments, 'toneCurve'>

/**
 * Configuration for each adjustment slider.
 * Key maps to numeric Adjustments interface properties only.
 */
interface AdjustmentConfig {
  key: NumericAdjustmentKey
  label: string
  min: number
  max: number
  step?: number
}

/**
 * Configuration for a group of adjustments.
 */
interface AdjustmentGroup {
  name: string
  sliders: AdjustmentConfig[]
}

/**
 * Adjustments organized into Lightroom-style groups.
 */
const adjustmentGroups: AdjustmentGroup[] = [
  {
    name: 'White Balance',
    sliders: [
      { key: 'temperature', label: 'Temp', min: -100, max: 100 },
      { key: 'tint', label: 'Tint', min: -100, max: 100 },
    ],
  },
  {
    name: 'Tone',
    sliders: [
      { key: 'exposure', label: 'Exposure', min: -5, max: 5, step: 0.01 },
      { key: 'contrast', label: 'Contrast', min: -100, max: 100 },
      { key: 'highlights', label: 'Highlights', min: -100, max: 100 },
      { key: 'shadows', label: 'Shadows', min: -100, max: 100 },
      { key: 'whites', label: 'Whites', min: -100, max: 100 },
      { key: 'blacks', label: 'Blacks', min: -100, max: 100 },
    ],
  },
  {
    name: 'Presence',
    sliders: [
      { key: 'vibrance', label: 'Vibrance', min: -100, max: 100 },
      { key: 'saturation', label: 'Saturation', min: -100, max: 100 },
    ],
  },
]

// ============================================================================
// Accordion Configuration
// ============================================================================

const accordionItems = [
  { value: 'basic', label: 'Basic', slot: 'basic' },
  { value: 'tonecurve', label: 'Tone Curve', slot: 'tonecurve' },
  { value: 'crop', label: 'Crop & Transform', slot: 'crop' },
  { value: 'masks', label: 'Masks', slot: 'masks' },
]

/**
 * Track expanded accordion sections.
 * Basic is expanded by default.
 */
const expandedSections = ref<string[]>(['basic'])

/**
 * Watch crop accordion expansion to toggle crop tool overlay.
 * When crop section is expanded, show the crop overlay on the main preview.
 * Note: We don't deactivate on collapse - let Apply/Cancel handle that.
 */
watch(
  () => expandedSections.value.includes('crop'),
  (isCropExpanded) => {
    if (isCropExpanded && !editUIStore.isCropToolActive) {
      editUIStore.activateCropTool()
    }
  },
  { immediate: true },
)

/**
 * Watch crop tool deactivation to collapse accordion.
 * When user clicks Apply or Cancel, the accordion should also collapse.
 */
watch(
  () => editUIStore.isCropToolActive,
  (isActive) => {
    if (!isActive && expandedSections.value.includes('crop')) {
      // Remove 'crop' from expanded sections
      expandedSections.value = expandedSections.value.filter(s => s !== 'crop')
    }
  },
)

/**
 * Watch masks accordion expansion to toggle mask tool overlay.
 * When masks section is expanded, show the mask overlay on the main preview.
 * When collapsed, hide the mask overlay and exit drawing mode.
 */
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

// ============================================================================
// Event Handlers
// ============================================================================

/**
 * Handle adjustment change from slider.
 */
function handleAdjustmentChange(key: NumericAdjustmentKey, value: number) {
  editStore.setAdjustment(key, value)
}

/**
 * Reset all adjustments to defaults.
 */
function handleReset() {
  editStore.reset()
}
</script>

<template>
  <div
    class="p-4 space-y-4"
    data-testid="edit-controls-panel"
  >
    <!-- Header with actions -->
    <div class="flex items-center justify-between">
      <h2 class="text-lg font-semibold">
        Edit
      </h2>
      <div class="flex items-center gap-1">
        <!-- Copy/Paste buttons -->
        <UButton
          variant="ghost"
          size="xs"
          icon="i-heroicons-document-duplicate"
          data-testid="copy-settings-button"
          @click="openCopyModal"
        >
          Copy
        </UButton>
        <UButton
          variant="ghost"
          size="xs"
          icon="i-heroicons-clipboard-document"
          :disabled="!canPaste"
          :title="canPaste ? `Paste: ${clipboardSummary}` : 'Nothing to paste'"
          data-testid="paste-settings-button"
          @click="pasteSettings()"
        >
          Paste
        </UButton>
        <!-- Reset button -->
        <UButton
          variant="ghost"
          size="xs"
          icon="i-heroicons-arrow-path"
          :disabled="!editStore.hasModifications"
          data-testid="reset-adjustments"
          @click="handleReset"
        >
          Reset
        </UButton>
      </div>
    </div>

    <!-- Accordion for grouped controls -->
    <!-- unmount-on-hide=false keeps child components mounted when collapsed,
         preserving mask state and preventing re-initialization -->
    <UAccordion
      v-model="expandedSections"
      type="multiple"
      :items="accordionItems"
      :unmount-on-hide="false"
    >
      <!-- Basic Adjustments Section -->
      <template #basic-body>
        <div class="pt-2 space-y-4">
          <div
            v-for="group in adjustmentGroups"
            :key="group.name"
          >
            <!-- Group header -->
            <div class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
              {{ group.name }}
            </div>
            <!-- Group sliders -->
            <div class="space-y-0.5">
              <EditAdjustmentSlider
                v-for="adj in group.sliders"
                :key="adj.key"
                :label="adj.label"
                :model-value="editStore.adjustments[adj.key]"
                :min="adj.min"
                :max="adj.max"
                :step="adj.step"
                :data-testid="`slider-${adj.key}`"
                @update:model-value="handleAdjustmentChange(adj.key, $event)"
              />
            </div>
          </div>
        </div>
      </template>

      <!-- Tone Curve Section -->
      <template #tonecurve-body>
        <div class="pt-2">
          <EditToneCurveEditor
            :asset-id="assetId"
            data-testid="tone-curve-section"
          />
        </div>
      </template>

      <!-- Crop & Transform Section -->
      <template #crop-body>
        <div class="pt-2 space-y-6">
          <!-- Rotation Controls -->
          <EditRotationControls />

          <!-- Divider -->
          <hr class="border-gray-700" />

          <!-- Crop Editor -->
          <EditCropEditor
            :asset-id="assetId"
            :image-width="imageWidth ?? 1920"
            :image-height="imageHeight ?? 1080"
          />
        </div>
      </template>

      <!-- Masks Section -->
      <template #masks-body>
        <div class="pt-2 space-y-4">
          <EditMaskPanel />
          <hr class="border-gray-700" />
          <EditMaskAdjustments />
        </div>
      </template>
    </UAccordion>

    <!-- Dirty indicator -->
    <div
      v-if="editStore.isDirty"
      class="text-xs text-yellow-500 flex items-center gap-1"
    >
      <UIcon
        name="i-heroicons-pencil"
        class="w-3 h-3"
      />
      <span>Unsaved changes</span>
    </div>

    <!-- Error indicator -->
    <div
      v-if="editStore.error"
      class="text-xs text-red-500 flex items-center gap-1"
    >
      <UIcon
        name="i-heroicons-exclamation-triangle"
        class="w-3 h-3"
      />
      <span>{{ editStore.error }}</span>
    </div>
  </div>
</template>
