/**
 * Unit tests for the Scan Service.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ScanService, createScanService } from './scan-service'
import { CatalogError, type ScannedFile } from './types'

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Create a mock File-like object for testing.
 */
function createMockFile(
  name: string,
  options: { size?: number; lastModified?: number } = {}
): { size: number; lastModified: number; name: string } {
  const { size = 1024, lastModified = Date.now() } = options
  return { size, lastModified, name }
}

/**
 * Create a mock file handle.
 */
function createMockFileHandle(
  name: string,
  options: { size?: number; lastModified?: number } = {}
): FileSystemFileHandle {
  const mockFile = createMockFile(name, options)

  return {
    kind: 'file',
    name,
    getFile: vi.fn().mockResolvedValue(mockFile),
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
  } as unknown as FileSystemFileHandle
}

/**
 * Create a mock directory handle.
 */
function createMockDirectoryHandle(
  name: string,
  entries: (FileSystemFileHandle | FileSystemDirectoryHandle)[]
): FileSystemDirectoryHandle {
  return {
    kind: 'directory',
    name,
    values: vi.fn().mockImplementation(async function* () {
      for (const entry of entries) {
        yield entry
      }
    }),
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn(),
    removeEntry: vi.fn(),
    resolve: vi.fn(),
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
    keys: vi.fn(),
    entries: vi.fn(),
  } as unknown as FileSystemDirectoryHandle
}

/**
 * Collect all files from an async generator.
 */
async function collectAllFiles(
  generator: AsyncGenerator<ScannedFile[], void, unknown>
): Promise<ScannedFile[]> {
  const allFiles: ScannedFile[] = []
  for await (const batch of generator) {
    allFiles.push(...batch)
  }
  return allFiles
}

// ============================================================================
// Tests
// ============================================================================

describe('ScanService', () => {
  let scanService: ScanService

  beforeEach(() => {
    scanService = new ScanService()
  })

  describe('scan', () => {
    it('should yield JPEG files', async () => {
      const directory = createMockDirectoryHandle('photos', [
        createMockFileHandle('photo1.jpg'),
        createMockFileHandle('photo2.jpeg'),
      ])

      const files = await collectAllFiles(scanService.scan(directory))

      expect(files).toHaveLength(2)
      expect(files[0].filename).toBe('photo1')
      expect(files[0].extension).toBe('jpg')
      expect(files[1].filename).toBe('photo2')
      expect(files[1].extension).toBe('jpeg')
    })

    it('should yield ARW files', async () => {
      const directory = createMockDirectoryHandle('photos', [
        createMockFileHandle('DSC00001.ARW'),
        createMockFileHandle('DSC00002.arw'),
      ])

      const files = await collectAllFiles(scanService.scan(directory))

      expect(files).toHaveLength(2)
      expect(files[0].filename).toBe('DSC00001')
      expect(files[0].extension).toBe('arw')
      expect(files[1].filename).toBe('DSC00002')
      expect(files[1].extension).toBe('arw')
    })

    it('should ignore unsupported file types', async () => {
      const directory = createMockDirectoryHandle('photos', [
        createMockFileHandle('photo.jpg'),
        createMockFileHandle('document.pdf'),
        createMockFileHandle('video.mp4'),
        createMockFileHandle('readme.txt'),
        createMockFileHandle('raw.ARW'),
      ])

      const files = await collectAllFiles(scanService.scan(directory))

      expect(files).toHaveLength(2)
      expect(files[0].filename).toBe('photo')
      expect(files[1].filename).toBe('raw')
    })

    it('should include file metadata', async () => {
      const lastModified = new Date('2024-01-15T10:30:00Z').getTime()
      const directory = createMockDirectoryHandle('photos', [
        createMockFileHandle('photo.jpg', { size: 5242880, lastModified }),
      ])

      const files = await collectAllFiles(scanService.scan(directory))

      expect(files).toHaveLength(1)
      expect(files[0]).toMatchObject({
        path: 'photo.jpg',
        filename: 'photo',
        extension: 'jpg',
        fileSize: 5242880,
      })
      expect(files[0].modifiedDate.getTime()).toBe(lastModified)
      expect(typeof files[0].getFile).toBe('function')
    })

    it('should scan subdirectories recursively', async () => {
      const subdir = createMockDirectoryHandle('day1', [
        createMockFileHandle('photo1.jpg'),
        createMockFileHandle('photo2.jpg'),
      ])

      const directory = createMockDirectoryHandle('photos', [
        createMockFileHandle('cover.jpg'),
        subdir,
      ])

      const files = await collectAllFiles(scanService.scan(directory))

      expect(files).toHaveLength(3)
      expect(files.map((f) => f.path)).toContain('cover.jpg')
      expect(files.map((f) => f.path)).toContain('day1/photo1.jpg')
      expect(files.map((f) => f.path)).toContain('day1/photo2.jpg')
    })

    it('should not scan subdirectories when recursive is false', async () => {
      const subdir = createMockDirectoryHandle('day1', [
        createMockFileHandle('photo1.jpg'),
      ])

      const directory = createMockDirectoryHandle('photos', [
        createMockFileHandle('cover.jpg'),
        subdir,
      ])

      const files = await collectAllFiles(scanService.scan(directory, { recursive: false }))

      expect(files).toHaveLength(1)
      expect(files[0].path).toBe('cover.jpg')
    })

    it('should handle deeply nested directories', async () => {
      const level3 = createMockDirectoryHandle('level3', [
        createMockFileHandle('deep.jpg'),
      ])
      const level2 = createMockDirectoryHandle('level2', [level3])
      const level1 = createMockDirectoryHandle('level1', [level2])
      const directory = createMockDirectoryHandle('root', [level1])

      const files = await collectAllFiles(scanService.scan(directory))

      expect(files).toHaveLength(1)
      expect(files[0].path).toBe('level1/level2/level3/deep.jpg')
    })

    it('should handle empty directories', async () => {
      const directory = createMockDirectoryHandle('empty', [])

      const files = await collectAllFiles(scanService.scan(directory))

      expect(files).toHaveLength(0)
    })

    it('should yield files in batches', async () => {
      // Create 120 files (more than one batch of 50)
      const fileHandles = Array.from({ length: 120 }, (_, i) =>
        createMockFileHandle(`photo${i.toString().padStart(3, '0')}.jpg`)
      )
      const directory = createMockDirectoryHandle('photos', fileHandles)

      const batches: ScannedFile[][] = []
      for await (const batch of scanService.scan(directory)) {
        batches.push(batch)
      }

      // Should have multiple batches
      expect(batches.length).toBeGreaterThan(1)
      // First batch should be 50 files
      expect(batches[0]).toHaveLength(50)
      // Total should be 120 files
      const totalFiles = batches.reduce((sum, batch) => sum + batch.length, 0)
      expect(totalFiles).toBe(120)
    })

    it('should support AbortController cancellation', async () => {
      // Create many files to ensure we have time to abort
      const fileHandles = Array.from({ length: 100 }, (_, i) =>
        createMockFileHandle(`photo${i}.jpg`)
      )
      const directory = createMockDirectoryHandle('photos', fileHandles)

      const controller = new AbortController()
      const files: ScannedFile[] = []

      // Abort after first batch
      let batchCount = 0
      try {
        for await (const batch of scanService.scan(directory, { signal: controller.signal })) {
          files.push(...batch)
          batchCount++
          if (batchCount >= 1) {
            controller.abort()
          }
        }
      } catch (error) {
        expect(error).toBeInstanceOf(CatalogError)
        expect((error as CatalogError).code).toBe('SCAN_CANCELLED')
      }

      // Should have gotten at least one batch before cancellation
      expect(files.length).toBeGreaterThan(0)
      // Should not have gotten all files
      expect(files.length).toBeLessThan(100)
    })

    it('should skip files that cannot be accessed', async () => {
      const goodFile = createMockFileHandle('good.jpg')
      const badFile = {
        kind: 'file',
        name: 'bad.jpg',
        getFile: vi.fn().mockRejectedValue(new Error('Access denied')),
      } as unknown as FileSystemFileHandle

      const directory = createMockDirectoryHandle('photos', [goodFile, badFile])

      const files = await collectAllFiles(scanService.scan(directory))

      // Should only have the accessible file
      expect(files).toHaveLength(1)
      expect(files[0].filename).toBe('good')
    })

    it('should throw PERMISSION_DENIED for NotAllowedError', async () => {
      const directory = {
        kind: 'directory',
        name: 'protected',
        values: vi.fn().mockImplementation(async function* () {
          throw new DOMException('Permission denied', 'NotAllowedError')
        }),
      } as unknown as FileSystemDirectoryHandle

      await expect(collectAllFiles(scanService.scan(directory))).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
      })
    })

    it('should throw FOLDER_NOT_FOUND for NotFoundError', async () => {
      const directory = {
        kind: 'directory',
        name: 'missing',
        values: vi.fn().mockImplementation(async function* () {
          throw new DOMException('Folder not found', 'NotFoundError')
        }),
      } as unknown as FileSystemDirectoryHandle

      await expect(collectAllFiles(scanService.scan(directory))).rejects.toMatchObject({
        code: 'FOLDER_NOT_FOUND',
      })
    })

    it('should handle files with no extension', async () => {
      const directory = createMockDirectoryHandle('photos', [
        createMockFileHandle('photo.jpg'),
        createMockFileHandle('noextension'),
        createMockFileHandle('.hidden'),
      ])

      const files = await collectAllFiles(scanService.scan(directory))

      // Only the .jpg file should be included
      expect(files).toHaveLength(1)
      expect(files[0].filename).toBe('photo')
    })

    it('should handle files with multiple dots in name', async () => {
      const directory = createMockDirectoryHandle('photos', [
        createMockFileHandle('photo.final.edit.jpg'),
        createMockFileHandle('2024.01.15.photo.ARW'),
      ])

      const files = await collectAllFiles(scanService.scan(directory))

      expect(files).toHaveLength(2)
      expect(files[0].filename).toBe('photo.final.edit')
      expect(files[0].extension).toBe('jpg')
      expect(files[1].filename).toBe('2024.01.15.photo')
      expect(files[1].extension).toBe('arw')
    })
  })

  describe('createScanService', () => {
    it('should create a new ScanService instance', () => {
      const service = createScanService()

      expect(service).toBeInstanceOf(ScanService)
      expect(typeof service.scan).toBe('function')
    })
  })
})
