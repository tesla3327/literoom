/**
 * Edit Clipboard Store
 *
 * Manages clipboard state for copy/paste settings:
 * - Copied settings data and source asset
 * - Selected groups for copy (which settings to include)
 * - Modal visibility for copy dialog
 */
import type { Adjustments, CropRectangle, RotationParameters } from '@literoom/core/catalog'
import type { ToneCurve } from '@literoom/core/decode'

// ============================================================================
// Types
// ============================================================================

/**
 * Groups that can be selected for copy/paste.
 */
export interface CopyGroups {
  /** Include basic adjustments (temperature, exposure, etc.) */
  basicAdjustments: boolean
  /** Include tone curve control points */
  toneCurve: boolean
  /** Include crop rectangle */
  crop: boolean
  /** Include rotation settings */
  rotation: boolean
}

/**
 * Data structure for copied settings.
 * Stored in clipboard store and optionally in browser clipboard.
 */
export interface CopiedSettings {
  /** Type marker for validation */
  type: 'literoom-settings'
  /** Schema version for future migrations */
  version: 1
  /** Timestamp when settings were copied */
  timestamp: number
  /** ID of the source asset */
  sourceAssetId: string
  /** Which groups were selected when copying */
  groups: CopyGroups
  /** The actual settings data */
  data: {
    /** Basic adjustments (excludes toneCurve) */
    adjustments?: Partial<Omit<Adjustments, 'toneCurve'>>
    /** Tone curve control points */
    toneCurve?: ToneCurve
    /** Crop rectangle (null means no crop) */
    crop?: CropRectangle | null
    /** Rotation parameters */
    rotation?: RotationParameters
  }
}

/**
 * Default groups to include when copying.
 * Crop and rotation are excluded by default for safety.
 */
export const DEFAULT_COPY_GROUPS: Readonly<CopyGroups> = Object.freeze({
  basicAdjustments: true,
  toneCurve: true,
  crop: false, // Excluded by default (safety)
  rotation: false, // Excluded by default (safety)
})

// ============================================================================
// Store Definition
// ============================================================================

export const useEditClipboardStore = defineStore('editClipboard', () => {
  // ============================================================================
  // State
  // ============================================================================

  /**
   * Currently copied settings.
   * Null if nothing has been copied yet.
   */
  const copiedSettings = ref<CopiedSettings | null>(null)

  /**
   * Whether the copy modal is open.
   */
  const showCopyModal = ref(false)

  /**
   * Groups selected for copy.
   * User can toggle these in the copy modal.
   */
  const selectedGroups = ref<CopyGroups>({ ...DEFAULT_COPY_GROUPS })

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Whether there is content in the clipboard.
   */
  const hasClipboardContent = computed(() => copiedSettings.value !== null)

  /**
   * The source asset ID of the copied settings.
   */
  const sourceAssetId = computed(() => copiedSettings.value?.sourceAssetId ?? null)

  /**
   * Time since settings were copied (for display).
   */
  const copyTimestamp = computed(() => copiedSettings.value?.timestamp ?? null)

  /**
   * Summary of what's in the clipboard (for display).
   */
  const clipboardSummary = computed(() => {
    if (!copiedSettings.value) return null

    const groups = copiedSettings.value.groups
    const items: string[] = []

    if (groups.basicAdjustments) items.push('Basic Adjustments')
    if (groups.toneCurve) items.push('Tone Curve')
    if (groups.crop) items.push('Crop')
    if (groups.rotation) items.push('Rotation')

    return items.join(', ') || 'Nothing'
  })

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Open the copy modal.
   */
  function openCopyModal(): void {
    showCopyModal.value = true
  }

  /**
   * Close the copy modal.
   */
  function closeCopyModal(): void {
    showCopyModal.value = false
  }

  /**
   * Set the copied settings.
   */
  function setCopiedSettings(settings: CopiedSettings): void {
    copiedSettings.value = settings
  }

  /**
   * Clear the clipboard.
   */
  function clear(): void {
    copiedSettings.value = null
  }

  /**
   * Toggle a specific group.
   */
  function toggleGroup(group: keyof CopyGroups): void {
    selectedGroups.value[group] = !selectedGroups.value[group]
  }

  /**
   * Set a specific group's value.
   */
  function setGroup(group: keyof CopyGroups, value: boolean): void {
    selectedGroups.value[group] = value
  }

  /**
   * Select all groups.
   */
  function selectAll(): void {
    selectedGroups.value = {
      basicAdjustments: true,
      toneCurve: true,
      crop: true,
      rotation: true,
    }
  }

  /**
   * Deselect all groups.
   */
  function selectNone(): void {
    selectedGroups.value = {
      basicAdjustments: false,
      toneCurve: false,
      crop: false,
      rotation: false,
    }
  }

  /**
   * Reset selected groups to defaults.
   */
  function resetGroups(): void {
    selectedGroups.value = { ...DEFAULT_COPY_GROUPS }
  }

  /**
   * Check if any groups are selected.
   */
  const hasSelectedGroups = computed(() =>
    selectedGroups.value.basicAdjustments
    || selectedGroups.value.toneCurve
    || selectedGroups.value.crop
    || selectedGroups.value.rotation,
  )

  return {
    // State
    copiedSettings: readonly(copiedSettings),
    showCopyModal,
    selectedGroups,

    // Computed
    hasClipboardContent,
    sourceAssetId,
    copyTimestamp,
    clipboardSummary,
    hasSelectedGroups,

    // Actions
    openCopyModal,
    closeCopyModal,
    setCopiedSettings,
    clear,
    toggleGroup,
    setGroup,
    selectAll,
    selectNone,
    resetGroups,
  }
})
