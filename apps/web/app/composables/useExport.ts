/**
 * Export Composable
 *
 * Provides export functionality:
 * - Get assets to export based on scope
 * - Select destination folder
 * - Run the export process
 * - Progress tracking via store
 */
import type { Asset, CropRectangle, MaskStack } from '@literoom/core/catalog'
import type { IDecodeService, Adjustments as DecodeAdjustments, MaskStackData } from '@literoom/core/decode'
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
   * Generate synthetic JPEG bytes for demo mode.
   * Creates a canvas with a gradient and converts to JPEG.
   */
  async function generateDemoImageBytes(asset: Asset): Promise<Uint8Array> {
    // Extract index from asset id (e.g., "demo-25" -> 25)
    const indexMatch = asset.id.match(/\d+$/)
    const index = indexMatch ? parseInt(indexMatch[0], 10) : 0

    // Create canvas for generating synthetic image
    const canvas = document.createElement('canvas')
    const size = 1024 // Generate at reasonable resolution
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!

    // Generate deterministic variations based on index
    const hueBase = (index * 37) % 360
    const pattern = index % 5

    // Create gradient background
    const gradient = ctx.createLinearGradient(0, 0, size, size)
    gradient.addColorStop(0, `hsl(${hueBase}, 70%, 50%)`)
    gradient.addColorStop(0.5, `hsl(${(hueBase + 60) % 360}, 60%, 40%)`)
    gradient.addColorStop(1, `hsl(${(hueBase + 120) % 360}, 50%, 30%)`)
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size, size)

    // Add visual patterns for variety
    ctx.globalAlpha = 0.3
    switch (pattern) {
      case 0: // Circles
        for (let i = 0; i < 5; i++) {
          ctx.beginPath()
          ctx.arc(
            size * (0.2 + (i * 0.15)),
            size * (0.3 + (i * 0.1)),
            size * (0.1 + (i * 0.05)),
            0,
            Math.PI * 2,
          )
          ctx.fillStyle = `hsl(${(hueBase + i * 30) % 360}, 80%, 70%)`
          ctx.fill()
        }
        break
      case 1: // Diagonal stripes
        ctx.strokeStyle = `hsl(${(hueBase + 180) % 360}, 60%, 60%)`
        ctx.lineWidth = size * 0.02
        for (let i = -size; i < size * 2; i += size * 0.1) {
          ctx.beginPath()
          ctx.moveTo(i, 0)
          ctx.lineTo(i + size, size)
          ctx.stroke()
        }
        break
      case 2: // Squares
        for (let i = 0; i < 4; i++) {
          ctx.fillStyle = `hsl(${(hueBase + i * 45) % 360}, 70%, 60%)`
          ctx.fillRect(
            size * (0.1 + (i * 0.2)),
            size * (0.15 + (i * 0.15)),
            size * 0.3,
            size * 0.3,
          )
        }
        break
      case 3: { // Radial gradient overlay
        const radialGradient = ctx.createRadialGradient(
          size / 2, size / 2, 0,
          size / 2, size / 2, size / 2,
        )
        radialGradient.addColorStop(0, `hsla(${(hueBase + 180) % 360}, 80%, 70%, 0.8)`)
        radialGradient.addColorStop(1, 'transparent')
        ctx.fillStyle = radialGradient
        ctx.fillRect(0, 0, size, size)
        break
      }
      case 4: // Triangles
        ctx.fillStyle = `hsl(${(hueBase + 90) % 360}, 70%, 65%)`
        ctx.beginPath()
        ctx.moveTo(size * 0.5, size * 0.1)
        ctx.lineTo(size * 0.9, size * 0.9)
        ctx.lineTo(size * 0.1, size * 0.9)
        ctx.closePath()
        ctx.fill()
        break
    }

    ctx.globalAlpha = 1.0

    // Add text label with asset info
    ctx.fillStyle = 'white'
    ctx.font = `bold ${size * 0.05}px sans-serif`
    ctx.textAlign = 'center'
    ctx.shadowColor = 'black'
    ctx.shadowBlur = 4
    ctx.fillText(`Demo Image ${index + 1}`, size / 2, size * 0.95)

    // Convert canvas to JPEG bytes
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            reject(new Error('Failed to create JPEG blob'))
            return
          }
          blob.arrayBuffer().then(
            buffer => resolve(new Uint8Array(buffer)),
            reject,
          )
        },
        'image/jpeg',
        0.92,
      )
    })
  }

  /**
   * Load raw image bytes for an asset.
   * In demo mode, generates synthetic JPEG bytes.
   * In real mode, uses the catalog service's folder handle to navigate to the file.
   */
  async function loadImageBytes(asset: Asset): Promise<Uint8Array> {
    const config = useRuntimeConfig()
    const isDemoMode = config.public.demoMode

    // Demo mode: generate synthetic image bytes
    if (isDemoMode) {
      return generateDemoImageBytes(asset)
    }

    // Real mode: load from file system
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
   * First checks the current edit store, then the session cache.
   */
  async function getEditState(assetId: string): Promise<ExportEditState | null> {
    // Use the edit store's cache-aware method to get edits
    const cachedState = editStore.getEditStateForAsset(assetId)

    if (cachedState) {
      return {
        adjustments: cachedState.adjustments,
        toneCurve: cachedState.adjustments.toneCurve,
        crop: cachedState.cropTransform.crop,
        rotation: cachedState.cropTransform.rotation,
        masks: cachedState.masks,
      }
    }

    // No edits found - export without modifications
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
      applyMaskedAdjustments: async (pixels, width, height, maskStack: MaskStack) => {
        // Convert MaskStack to MaskStackData for the decode service
        const maskStackData: MaskStackData = {
          linearMasks: maskStack.linearMasks.map(m => ({
            startX: m.start.x,
            startY: m.start.y,
            endX: m.end.x,
            endY: m.end.y,
            feather: m.feather,
            enabled: m.enabled,
            adjustments: m.adjustments,
          })),
          radialMasks: maskStack.radialMasks.map(m => ({
            centerX: m.center.x,
            centerY: m.center.y,
            radiusX: m.radiusX,
            radiusY: m.radiusY,
            rotation: m.rotation,
            feather: m.feather,
            invert: m.invert,
            enabled: m.enabled,
            adjustments: m.adjustments,
          })),
        }
        const result = await decodeService.applyMaskedAdjustments(pixels, width, height, maskStackData)
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
        // Log detailed failures to console
        console.warn('[Export] Some exports failed:', result.failures)
        const failedFiles = result.failures.slice(0, 3).map(f => f.filename).join(', ')
        const moreText = result.failures.length > 3 ? ` and ${result.failures.length - 3} more` : ''
        toast.add({
          title: 'Export completed with errors',
          description: `${result.successCount} succeeded, ${result.failureCount} failed (${failedFiles}${moreText}). Check console for details.`,
          color: 'warning',
        })
      }
      else {
        // Log detailed failures to console
        console.error('[Export] All exports failed:', result.failures)
        const firstError = result.failures[0]?.error || 'Unknown error'
        toast.add({
          title: 'Export failed',
          description: `All ${result.failureCount} images failed to export. Error: ${firstError}`,
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
