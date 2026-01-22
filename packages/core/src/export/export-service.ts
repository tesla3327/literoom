/**
 * Export Service - Coordinates the export pipeline.
 *
 * The ExportService handles the complete export workflow:
 * 1. Load original image bytes
 * 2. Decode image to pixels
 * 3. Apply rotation (if present)
 * 4. Apply crop (if present)
 * 5. Apply adjustments (if present)
 * 6. Apply tone curve (if present)
 * 7. Resize (if requested)
 * 8. Encode to JPEG
 * 9. Write to destination folder
 *
 * The service is designed to be dependency-injected for testability.
 */

import type { Asset, CropRectangle, RotationParameters, Adjustments } from '../catalog/types'
import type { ToneCurve } from '../decode/types'
import type {
  ExportOptions,
  ExportProgress,
  ExportProgressCallback,
  ExportResult,
  ExportFailure,
  ExportEditState,
  ExportServiceDependencies,
} from './types'
import {
  renderTemplate,
  extractOriginalFilename,
  formatDateForTemplate,
} from './filename-template'

// ============================================================================
// Export Service
// ============================================================================

/**
 * Service for exporting edited images as JPEG files.
 *
 * @example
 * ```typescript
 * const exportService = new ExportService({
 *   decodeImage: decodeService.decodeJpeg.bind(decodeService),
 *   applyRotation: decodeService.applyRotation.bind(decodeService),
 *   // ... other dependencies
 * })
 *
 * const result = await exportService.exportAssets(
 *   assets,
 *   options,
 *   (progress) => console.log(`${progress.current}/${progress.total}`)
 * )
 * ```
 */
export class ExportService {
  constructor(private readonly deps: ExportServiceDependencies) {}

  /**
   * Export assets to the destination folder.
   *
   * @param assets - Assets to export
   * @param options - Export options (destination, quality, resize, etc.)
   * @param onProgress - Progress callback
   * @returns Export result with success/failure counts
   */
  async exportAssets(
    assets: Asset[],
    options: ExportOptions,
    onProgress?: ExportProgressCallback
  ): Promise<ExportResult> {
    const {
      destinationHandle,
      filenameTemplate,
      quality,
      resizeLongEdge,
      startSequence = 1,
    } = options

    const result: ExportResult = {
      successCount: 0,
      failureCount: 0,
      failures: [],
      destinationPath: destinationHandle.name,
    }

    // Track used filenames to avoid duplicates within this export
    const usedFilenames = new Set<string>()

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]!
      const seq = startSequence + i
      const origFilename = extractOriginalFilename(asset.filename)

      // Report progress
      onProgress?.({
        total: assets.length,
        current: i + 1,
        currentFilename: asset.filename,
        complete: false,
      })

      try {
        // Process and export the asset
        const jpegBytes = await this.processAsset(
          asset,
          quality,
          resizeLongEdge
        )

        // Generate filename with collision handling
        const date = asset.captureDate
          ? formatDateForTemplate(asset.captureDate)
          : asset.modifiedDate
            ? formatDateForTemplate(asset.modifiedDate)
            : undefined

        let baseFilename = renderTemplate(filenameTemplate, {
          orig: origFilename,
          seq,
          date,
        })

        // Ensure .jpg extension
        if (
          !baseFilename.toLowerCase().endsWith('.jpg') &&
          !baseFilename.toLowerCase().endsWith('.jpeg')
        ) {
          baseFilename += '.jpg'
        }

        // Handle collisions
        const finalFilename = await this.resolveFilenameCollision(
          destinationHandle,
          baseFilename,
          usedFilenames
        )
        usedFilenames.add(finalFilename.toLowerCase())

        // Write file
        await this.writeFile(destinationHandle, finalFilename, jpegBytes)

        result.successCount++
      } catch (error) {
        result.failureCount++
        result.failures.push({
          assetId: asset.id,
          filename: asset.filename,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    // Final progress
    onProgress?.({
      total: assets.length,
      current: assets.length,
      currentFilename: '',
      complete: true,
    })

    return result
  }

  /**
   * Process a single asset through the edit pipeline and encode to JPEG.
   */
  private async processAsset(
    asset: Asset,
    quality: number,
    resizeLongEdge: number
  ): Promise<Uint8Array> {
    // 1. Load original image bytes
    const imageBytes = await this.deps.loadImageBytes(asset)

    // 2. Decode image
    let decoded = await this.deps.decodeImage(
      imageBytes,
      `${asset.filename}.${asset.extension}`
    )

    // 3. Get edit state
    const editState = await this.deps.getEditState(asset.id)

    // 4. Apply edits if present
    if (editState) {
      decoded = await this.applyEdits(decoded, editState)
    }

    // 5. Resize if requested
    if (resizeLongEdge > 0) {
      const longEdge = Math.max(decoded.width, decoded.height)
      if (longEdge > resizeLongEdge) {
        const scale = resizeLongEdge / longEdge
        const newWidth = Math.round(decoded.width * scale)
        const newHeight = Math.round(decoded.height * scale)
        decoded = await this.deps.resize(
          decoded.data,
          decoded.width,
          decoded.height,
          newWidth,
          newHeight
        )
      }
    }

    // 6. Encode to JPEG
    return this.deps.encodeJpeg(
      decoded.data,
      decoded.width,
      decoded.height,
      quality
    )
  }

  /**
   * Apply all edits from the edit state to the decoded image.
   * Order: Rotation -> Crop -> Adjustments -> Tone Curve
   */
  private async applyEdits(
    decoded: { data: Uint8Array; width: number; height: number },
    editState: ExportEditState
  ): Promise<{ data: Uint8Array; width: number; height: number }> {
    let result = decoded

    // Apply rotation (angle + straighten)
    if (editState.rotation) {
      const totalAngle = editState.rotation.angle + editState.rotation.straighten
      if (totalAngle !== 0) {
        result = await this.deps.applyRotation(
          result.data,
          result.width,
          result.height,
          totalAngle,
          true // Use Lanczos for high-quality export
        )
      }
    }

    // Apply crop
    if (editState.crop) {
      result = await this.deps.applyCrop(
        result.data,
        result.width,
        result.height,
        editState.crop
      )
    }

    // Apply adjustments
    if (editState.adjustments) {
      result = await this.deps.applyAdjustments(
        result.data,
        result.width,
        result.height,
        editState.adjustments
      )
    }

    // Apply tone curve
    if (editState.toneCurve && editState.toneCurve.points.length > 0) {
      result = await this.deps.applyToneCurve(
        result.data,
        result.width,
        result.height,
        editState.toneCurve.points
      )
    }

    return result
  }

  /**
   * Resolve filename collisions by appending a number suffix.
   */
  private async resolveFilenameCollision(
    dirHandle: FileSystemDirectoryHandle,
    baseFilename: string,
    usedFilenames: Set<string>
  ): Promise<string> {
    let finalFilename = baseFilename
    let collisionCount = 0

    while (
      usedFilenames.has(finalFilename.toLowerCase()) ||
      (await this.fileExists(dirHandle, finalFilename))
    ) {
      collisionCount++
      const ext = finalFilename.substring(finalFilename.lastIndexOf('.'))
      const base = baseFilename.substring(0, baseFilename.lastIndexOf('.'))
      finalFilename = `${base}_${collisionCount}${ext}`
    }

    return finalFilename
  }

  /**
   * Check if a file exists in the directory.
   */
  private async fileExists(
    dirHandle: FileSystemDirectoryHandle,
    filename: string
  ): Promise<boolean> {
    try {
      await dirHandle.getFileHandle(filename, { create: false })
      return true
    } catch (error) {
      // NotFoundError means file doesn't exist
      if ((error as Error).name === 'NotFoundError') {
        return false
      }
      // Other errors indicate the file exists but we can't access it
      return true
    }
  }

  /**
   * Write bytes to a file in the destination directory.
   */
  private async writeFile(
    dirHandle: FileSystemDirectoryHandle,
    filename: string,
    bytes: Uint8Array
  ): Promise<void> {
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true })
    const writable = await fileHandle.createWritable()
    try {
      // Copy to a regular Uint8Array to ensure compatibility with Blob
      const buffer = new Uint8Array(bytes)
      await writable.write(new Blob([buffer], { type: 'image/jpeg' }))
    } finally {
      await writable.close()
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new ExportService instance.
 */
export function createExportService(
  deps: ExportServiceDependencies
): ExportService {
  return new ExportService(deps)
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Filter assets based on export options.
 *
 * @param assets - All assets in the catalog
 * @param scope - Export scope (picks, selected, all)
 * @param selectedIds - Set of selected asset IDs (for 'selected' scope)
 * @param includeRejected - Whether to include rejected assets
 * @returns Filtered array of assets to export
 */
export function filterAssetsForExport(
  assets: Asset[],
  scope: 'picks' | 'selected' | 'all',
  selectedIds: Set<string> = new Set(),
  includeRejected = false
): Asset[] {
  switch (scope) {
    case 'picks':
      return assets.filter((a) => a.flag === 'pick')

    case 'selected':
      return assets.filter((a) => {
        if (!selectedIds.has(a.id)) return false
        if (!includeRejected && a.flag === 'reject') return false
        return true
      })

    case 'all':
      if (includeRejected) {
        return assets
      }
      return assets.filter((a) => a.flag !== 'reject')
  }
}
