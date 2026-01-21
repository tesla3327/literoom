/**
 * Scan Service for discovering image files in a folder.
 *
 * The Scan Service implements folder scanning with:
 * - Async generator pattern for progressive UI updates
 * - Batched yielding for responsive performance
 * - AbortController support for cancellation
 * - Recursive subdirectory traversal
 * - Extension-based file filtering
 */

import {
  type IScanService,
  type ScannedFile,
  type ScanOptions,
  CatalogError,
  SUPPORTED_EXTENSIONS,
  getExtension,
  getFilenameWithoutExtension,
  isSupportedExtension,
} from './types'

// ============================================================================
// Constants
// ============================================================================

/** Number of files to yield in each batch for UI responsiveness */
const BATCH_SIZE = 50

// ============================================================================
// Scan Service Implementation
// ============================================================================

/**
 * Service for scanning directories for supported image files.
 *
 * Usage:
 * ```typescript
 * const scanService = new ScanService()
 * const controller = new AbortController()
 *
 * for await (const batch of scanService.scan(directoryHandle, { signal: controller.signal })) {
 *   // Process batch of files
 *   for (const file of batch) {
 *     console.log(file.path, file.filename, file.extension)
 *   }
 * }
 * ```
 */
export class ScanService implements IScanService {
  /**
   * Scan a directory for supported image files.
   *
   * @param directory - FileSystemDirectoryHandle to scan
   * @param options - Scan options including recursive flag and abort signal
   * @yields Batches of ScannedFile objects for progressive loading
   * @throws CatalogError with code 'SCAN_CANCELLED' if aborted
   * @throws CatalogError with code 'PERMISSION_DENIED' if access is denied
   */
  async *scan(
    directory: FileSystemDirectoryHandle,
    options: ScanOptions = {}
  ): AsyncGenerator<ScannedFile[], void, unknown> {
    const { recursive = true, signal } = options

    // Delegate to the recursive implementation
    yield* this.scanDirectory(directory, '', recursive, signal)
  }

  /**
   * Recursively scan a directory and its subdirectories.
   *
   * @param directory - Directory handle to scan
   * @param relativePath - Path relative to the root directory
   * @param recursive - Whether to scan subdirectories
   * @param signal - Optional abort signal for cancellation
   */
  private async *scanDirectory(
    directory: FileSystemDirectoryHandle,
    relativePath: string,
    recursive: boolean,
    signal?: AbortSignal
  ): AsyncGenerator<ScannedFile[], void, unknown> {
    const batch: ScannedFile[] = []

    try {
      for await (const entry of directory.values()) {
        // Check for cancellation before processing each entry
        if (signal?.aborted) {
          // Yield any remaining items before throwing
          if (batch.length > 0) {
            yield batch
          }
          throw new CatalogError('Scan was cancelled', 'SCAN_CANCELLED')
        }

        const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name

        if (entry.kind === 'file') {
          const ext = getExtension(entry.name)

          if (isSupportedExtension(ext)) {
            const fileHandle = entry as FileSystemFileHandle

            // Get file metadata
            let file: File
            try {
              file = await fileHandle.getFile()
            } catch (error) {
              // Skip files we can't access
              continue
            }

            const scannedFile: ScannedFile = {
              path: entryPath,
              filename: getFilenameWithoutExtension(entry.name),
              extension: ext,
              fileSize: file.size,
              modifiedDate: new Date(file.lastModified),
              getFile: () => fileHandle.getFile(),
            }

            batch.push(scannedFile)

            // Yield batch when full
            if (batch.length >= BATCH_SIZE) {
              yield [...batch]
              batch.length = 0
            }
          }
        } else if (entry.kind === 'directory' && recursive) {
          // Yield any accumulated files before recursing
          if (batch.length > 0) {
            yield [...batch]
            batch.length = 0
          }

          // Recursively scan subdirectory
          const subdirectory = entry as FileSystemDirectoryHandle
          yield* this.scanDirectory(subdirectory, entryPath, recursive, signal)
        }
      }

      // Yield remaining files
      if (batch.length > 0) {
        yield batch
      }
    } catch (error) {
      // Re-throw CatalogErrors
      if (error instanceof CatalogError) {
        throw error
      }

      // Handle permission errors
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
          throw new CatalogError(
            `Permission denied accessing folder: ${relativePath || 'root'}`,
            'PERMISSION_DENIED',
            error
          )
        }
        if (error.name === 'NotFoundError') {
          throw new CatalogError(
            `Folder not found: ${relativePath || 'root'}`,
            'FOLDER_NOT_FOUND',
            error
          )
        }
      }

      // Wrap unknown errors
      throw new CatalogError(
        `Error scanning folder: ${error instanceof Error ? error.message : String(error)}`,
        'UNKNOWN',
        error instanceof Error ? error : undefined
      )
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new ScanService instance.
 */
export function createScanService(): IScanService {
  return new ScanService()
}
