/**
 * Export Store
 *
 * Manages export state:
 * - Modal visibility
 * - Export options (destination, template, quality, resize)
 * - Export progress
 *
 * Used by the ExportModal component and useExport composable.
 */
import type { ExportScope, ExportProgress } from '@literoom/core/export'

// ============================================================================
// Types
// ============================================================================

/**
 * Resize preset options.
 */
export interface ResizePreset {
  value: number
  label: string
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Available resize presets.
 */
export const RESIZE_PRESETS: ReadonlyArray<ResizePreset> = Object.freeze([
  { value: 0, label: 'Original size' },
  { value: 2048, label: '2048px (Social media)' },
  { value: 3840, label: '3840px (4K)' },
  { value: 5120, label: '5120px (5K)' },
])

/**
 * Default filename template.
 */
export const DEFAULT_FILENAME_TEMPLATE = '{orig}_{seq:4}'

/**
 * Default JPEG quality (Lightroom standard).
 */
export const DEFAULT_JPEG_QUALITY = 90

// ============================================================================
// Store Definition
// ============================================================================

export const useExportStore = defineStore('export', () => {
  // ============================================================================
  // State
  // ============================================================================

  /**
   * Whether the export modal is open.
   */
  const isModalOpen = ref(false)

  /**
   * Destination folder handle for writing files.
   */
  const destinationHandle = ref<FileSystemDirectoryHandle | null>(null)

  /**
   * Display name of the destination folder.
   */
  const destinationName = ref<string>('')

  /**
   * Filename template with tokens.
   */
  const filenameTemplate = ref(DEFAULT_FILENAME_TEMPLATE)

  /**
   * JPEG quality (1-100).
   */
  const quality = ref(DEFAULT_JPEG_QUALITY)

  /**
   * Resize to long edge pixels (0 = no resize).
   */
  const resizeLongEdge = ref(0)

  /**
   * Export scope - which assets to include.
   */
  const scope = ref<ExportScope>('picks')

  /**
   * Include rejected images in export.
   */
  const includeRejected = ref(false)

  /**
   * Whether an export is currently in progress.
   */
  const isExporting = ref(false)

  /**
   * Current export progress.
   */
  const progress = ref<ExportProgress | null>(null)

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Whether the export options are valid.
   */
  const isValid = computed(() => {
    return destinationHandle.value !== null && filenameTemplate.value.trim() !== ''
  })

  /**
   * Progress as a percentage (0-100).
   */
  const progressPercent = computed(() => {
    if (!progress.value || progress.value.total === 0) return 0
    return Math.round((progress.value.current / progress.value.total) * 100)
  })

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Open the export modal.
   */
  function openModal(): void {
    isModalOpen.value = true
  }

  /**
   * Close the export modal.
   */
  function closeModal(): void {
    isModalOpen.value = false
  }

  /**
   * Set the destination folder handle.
   */
  function setDestination(handle: FileSystemDirectoryHandle): void {
    destinationHandle.value = handle
    destinationName.value = handle.name
  }

  /**
   * Clear the destination folder.
   */
  function clearDestination(): void {
    destinationHandle.value = null
    destinationName.value = ''
  }

  /**
   * Set export progress.
   */
  function setProgress(p: ExportProgress | null): void {
    progress.value = p
    isExporting.value = p !== null && !p.complete
  }

  /**
   * Reset all export options to defaults.
   */
  function reset(): void {
    destinationHandle.value = null
    destinationName.value = ''
    filenameTemplate.value = DEFAULT_FILENAME_TEMPLATE
    quality.value = DEFAULT_JPEG_QUALITY
    resizeLongEdge.value = 0
    scope.value = 'picks'
    includeRejected.value = false
    progress.value = null
    isExporting.value = false
  }

  return {
    // State
    isModalOpen,
    destinationHandle,
    destinationName,
    filenameTemplate,
    quality,
    resizeLongEdge,
    scope,
    includeRejected,
    isExporting,
    progress,

    // Computed
    isValid,
    progressPercent,

    // Actions
    openModal,
    closeModal,
    setDestination,
    clearDestination,
    setProgress,
    reset,
  }
})
