/**
 * Export Composable
 *
 * Provides export functionality:
 * - Get assets to export based on scope
 * - Select destination folder
 * - Run the export process
 * - Progress tracking via store
 */
import type { Asset, CropRectangle } from '@literoom/core/catalog'
import type { IDecodeService, Adjustments as DecodeAdjustments } from '@literoom/core/decode'
import type { ExportEditState, ExportResult, ExportServiceDependencies } from '@literoom/core/export'
import {
  ExportService,
  filterAssetsForExport,
  validateTemplate,
} from '@literoom/core/export'

export function useExport() {
  const nuxtApp = useNuxtApp()
  const catalogStore = useCatalogStore()
  const selectionStore = useSelectionStore()
  const editStore = useEditStore()
  const exportStore = useExportStore()
  const toast = useToast()

  // Access services from plugin
  const decodeService = nuxtApp.$decodeService as IDecodeService
  const catalogService = nuxtApp.$catalogService

  // ============================================================================
  // Asset Selection
  // ============================================================================

  /**
   * Get assets to export based on current scope and options.
   */
  function getAssetsToExport(): Asset[] {
    const allAssets = catalogStore.getOrderedAssets()

    return filterAssetsForExport(
      allAssets,
      exportStore.scope,
      selectionStore.selectedIds,
      exportStore.includeRejected,
    )
  }

  /**
   * Get the count of assets that will be exported.
   */
  const exportCount = computed(() => getAssetsToExport().length)

  // ============================================================================
  // Destination Selection
  // ============================================================================

  /**
   * Select destination folder for export.
   * Shows native folder picker dialog.
   *
   * @returns true if folder was selected, false if cancelled
   */
  async function selectDestination(): Promise<boolean> {
    try {
      // Use type assertion for File System Access API
      const picker = (window as Window & { showDirectoryPicker?: (options?: {
        mode?: 'read' | 'readwrite'
        id?: string
        startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos'
      }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker

      if (!picker) {
        toast.add({
          title: 'Not supported',
          description: 'Your browser does not support folder selection',
          color: 'error',
        })
        return false
      }

      const handle = await picker({
        mode: 'readwrite',
        id: 'photo-export',
        startIn: 'pictures',
      })
      exportStore.setDestination(handle)
      return true
    }
    catch (error) {
      // AbortError means user cancelled the picker
      if ((error as Error).name !== 'AbortError') {
        toast.add({
          title: 'Could not select folder',
          description: String(error),
          color: 'error',
        })
      }
      return false
    }
  }

  // ============================================================================
  // Load Image Bytes
  // ============================================================================

  /**
   * Load raw image bytes for an asset.
   * Uses the catalog service's folder handle to navigate to the file.
   */
  async function loadImageBytes(asset: Asset): Promise<Uint8Array> {
    const folder = catalogService.getCurrentFolder()
    if (!folder) {
      throw new Error('No folder selected')
    }

    // Navigate to the file through the path
    const pathParts = asset.path.split('/')
    let currentHandle: FileSystemDirectoryHandle | FileSystemFileHandle = folder

    for (let i = 0; i < pathParts.length; i++) {
      const part = pathParts[i]
      if (i === pathParts.length - 1) {
        // Last part is the filename (with extension)
        const filenameWithExt = `${asset.filename}.${asset.extension}`
        currentHandle = await (currentHandle as FileSystemDirectoryHandle).getFileHandle(
          filenameWithExt,
        )
      }
      else if (part) {
        // Navigate to subdirectory (skip empty parts)
        currentHandle = await (currentHandle as FileSystemDirectoryHandle).getDirectoryHandle(
          part,
        )
      }
    }

    // Read file
    const file = await (currentHandle as FileSystemFileHandle).getFile()
    const arrayBuffer = await file.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  }

  // ============================================================================
  // Get Edit State
  // ============================================================================

  /**
   * Get edit state for an asset.
   * Currently only returns edits if the asset is currently loaded in the edit store.
   * TODO: Load from database once edit state persistence is implemented.
   */
  async function getEditState(assetId: string): Promise<ExportEditState | null> {
    // If this is the currently loaded asset, get from edit store
    if (editStore.currentAssetId === assetId) {
      const state = editStore.editState
      return {
        adjustments: state.adjustments,
        toneCurve: state.adjustments.toneCurve,
        crop: state.cropTransform.crop,
        rotation: state.cropTransform.rotation,
      }
    }

    // TODO: Load from database once persistence is implemented
    // For now, return null (export without edits)
    return null
  }

  // ============================================================================
  // Adapter Functions
  // ============================================================================

  /**
   * Convert DecodedImage (with pixels) to the expected export format (with data).
   */
  function adaptDecodedImage(result: { pixels: Uint8Array, width: number, height: number }): {
    data: Uint8Array
    width: number
    height: number
  } {
    return {
      data: result.pixels,
      width: result.width,
      height: result.height,
    }
  }

  // ============================================================================
  // Run Export
  // ============================================================================

  /**
   * Run the export process.
   *
   * @returns Export result if successful, null if cancelled or failed validation
   */
  async function runExport(): Promise<ExportResult | null> {
    const { destinationHandle, filenameTemplate, quality, resizeLongEdge, includeRejected } = exportStore

    // Validate destination
    if (!destinationHandle) {
      toast.add({
        title: 'No destination selected',
        description: 'Please select a destination folder',
        color: 'warning',
      })
      return null
    }

    // Validate template
    const templateErrors = validateTemplate(filenameTemplate)
    if (templateErrors.length > 0) {
      toast.add({
        title: 'Invalid filename template',
        description: templateErrors[0]!.message,
        color: 'error',
      })
      return null
    }

    // Get assets to export
    const assets = getAssetsToExport()
    if (assets.length === 0) {
      const scopeMessage = exportStore.scope === 'picks'
        ? 'No images are marked as picks'
        : exportStore.scope === 'selected'
          ? 'No images selected'
          : 'No images available'

      toast.add({
        title: 'No images to export',
        description: scopeMessage,
        color: 'warning',
      })
      return null
    }

    // Create export service dependencies
    // Note: We adapt the decode service interface to match export dependencies
    const dependencies: ExportServiceDependencies = {
      decodeImage: async (bytes: Uint8Array, _filename: string) => {
        // Use decodeJpeg for JPEG files - for full resolution export
        const result = await decodeService.decodeJpeg(bytes)
        return adaptDecodedImage(result)
      },
      applyRotation: async (pixels, width, height, angleDegrees, useLanczos = true) => {
        const result = await decodeService.applyRotation(pixels, width, height, angleDegrees, useLanczos)
        return adaptDecodedImage(result)
      },
      applyCrop: async (pixels, width, height, crop: CropRectangle) => {
        const result = await decodeService.applyCrop(pixels, width, height, crop)
        return adaptDecodedImage(result)
      },
      applyAdjustments: async (pixels, width, height, adjustments) => {
        const result = await decodeService.applyAdjustments(pixels, width, height, adjustments as DecodeAdjustments)
        return adaptDecodedImage(result)
      },
      applyToneCurve: async (pixels, width, height, points) => {
        const result = await decodeService.applyToneCurve(pixels, width, height, points)
        return adaptDecodedImage(result)
      },
      resize: async (pixels, width, height, newWidth, newHeight) => {
        // For resize, we need to re-encode then decode at smaller size
        // This is a workaround since there's no direct pixel resize API
        // Encode to JPEG, then generate a preview at the target size
        const jpegBytes = await decodeService.encodeJpeg(pixels, width, height, 100)
        const maxEdge = Math.max(newWidth, newHeight)
        const result = await decodeService.generatePreview(jpegBytes, { maxEdge })
        return adaptDecodedImage(result)
      },
      encodeJpeg: async (pixels, width, height, q) => {
        return decodeService.encodeJpeg(pixels, width, height, q)
      },
      getEditState,
      loadImageBytes,
    }

    // Create export service
    const exportService = new ExportService(dependencies)

    try {
      // Run export with progress tracking
      const result = await exportService.exportAssets(
        assets,
        {
          destinationHandle,
          filenameTemplate,
          quality,
          resizeLongEdge,
          scope: exportStore.scope,
          includeRejected,
        },
        (progress) => {
          exportStore.setProgress(progress)
        },
      )

      // Show result
      if (result.failureCount === 0) {
        toast.add({
          title: 'Export complete',
          description: `${result.successCount} image${result.successCount === 1 ? '' : 's'} exported to ${result.destinationPath}`,
          color: 'success',
        })
      }
      else if (result.successCount > 0) {
        toast.add({
          title: 'Export completed with errors',
          description: `${result.successCount} succeeded, ${result.failureCount} failed`,
          color: 'warning',
        })
      }
      else {
        toast.add({
          title: 'Export failed',
          description: `All ${result.failureCount} images failed to export`,
          color: 'error',
        })
      }

      exportStore.closeModal()
      return result
    }
    catch (error) {
      toast.add({
        title: 'Export failed',
        description: String(error),
        color: 'error',
      })
      return null
    }
    finally {
      exportStore.setProgress(null)
    }
  }

  // ============================================================================
  // Return
  // ============================================================================

  return {
    // Asset selection
    getAssetsToExport,
    exportCount,

    // Destination
    selectDestination,

    // Export
    runExport,
  }
}
