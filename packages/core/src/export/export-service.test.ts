/**
 * Tests for ExportService
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ExportService, filterAssetsForExport, createExportService } from './export-service'
import type { ExportServiceDependencies, ExportOptions, ExportProgress } from './types'
import type { Asset } from '../catalog/types'

// ============================================================================
// Mock Dependencies Factory
// ============================================================================

function createMockDependencies(): ExportServiceDependencies {
  return {
    decodeImage: vi.fn().mockResolvedValue({
      data: new Uint8Array([1, 2, 3]),
      width: 100,
      height: 100,
    }),
    applyRotation: vi.fn().mockImplementation(async (pixels, w, h) => ({
      data: new Uint8Array(pixels),
      width: w,
      height: h,
    })),
    applyCrop: vi.fn().mockImplementation(async (pixels, w, h) => ({
      data: new Uint8Array(pixels),
      width: Math.round(w * 0.5),
      height: Math.round(h * 0.5),
    })),
    applyAdjustments: vi.fn().mockImplementation(async (pixels, w, h) => ({
      data: new Uint8Array(pixels),
      width: w,
      height: h,
    })),
    applyToneCurve: vi.fn().mockImplementation(async (pixels, w, h) => ({
      data: new Uint8Array(pixels),
      width: w,
      height: h,
    })),
    resize: vi.fn().mockImplementation(async (pixels, _w, _h, newW, newH) => ({
      data: new Uint8Array(pixels),
      width: newW,
      height: newH,
    })),
    encodeJpeg: vi.fn().mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff])),
    getEditState: vi.fn().mockResolvedValue(null),
    loadImageBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3, 4])),
  }
}

// ============================================================================
// Mock FileSystemDirectoryHandle
// ============================================================================

function createMockDirectoryHandle(options: {
  existingFiles?: string[]
} = {}): FileSystemDirectoryHandle {
  const existingFiles = new Set(options.existingFiles || [])
  const writtenFiles = new Map<string, Uint8Array>()

  const mockWritable = {
    write: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  }

  return {
    name: 'test-export-folder',
    kind: 'directory',
    getFileHandle: vi.fn().mockImplementation(async (filename: string, opts?: { create?: boolean }) => {
      if (!opts?.create && !existingFiles.has(filename)) {
        const error = new Error('NotFoundError')
        error.name = 'NotFoundError'
        throw error
      }
      return {
        name: filename,
        kind: 'file',
        createWritable: vi.fn().mockResolvedValue(mockWritable),
      }
    }),
  } as unknown as FileSystemDirectoryHandle
}

// ============================================================================
// Mock Asset Factory
// ============================================================================

function createMockAsset(overrides: Partial<Asset> = {}): Asset {
  return {
    id: crypto.randomUUID(),
    folderId: '1',
    path: 'test',
    filename: 'DSC1234',
    extension: 'arw',
    flag: 'none',
    captureDate: new Date('2026-01-21'),
    modifiedDate: new Date('2026-01-21'),
    fileSize: 1024,
    thumbnailStatus: 'ready',
    thumbnailUrl: 'blob:test',
    ...overrides,
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('ExportService', () => {
  let mockDeps: ExportServiceDependencies
  let service: ExportService

  beforeEach(() => {
    mockDeps = createMockDependencies()
    service = new ExportService(mockDeps)
  })

  describe('exportAssets', () => {
    it('exports single asset successfully', async () => {
      const asset = createMockAsset()
      const options: ExportOptions = {
        destinationHandle: createMockDirectoryHandle(),
        filenameTemplate: '{orig}_{seq:4}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      const result = await service.exportAssets([asset], options)

      expect(result.successCount).toBe(1)
      expect(result.failureCount).toBe(0)
      expect(result.failures).toHaveLength(0)
      expect(result.destinationPath).toBe('test-export-folder')
    })

    it('exports multiple assets', async () => {
      const assets = [
        createMockAsset({ filename: 'DSC0001' }),
        createMockAsset({ filename: 'DSC0002' }),
        createMockAsset({ filename: 'DSC0003' }),
      ]
      const options: ExportOptions = {
        destinationHandle: createMockDirectoryHandle(),
        filenameTemplate: '{orig}_{seq:4}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      const result = await service.exportAssets(assets, options)

      expect(result.successCount).toBe(3)
      expect(result.failureCount).toBe(0)
    })

    it('reports progress during export', async () => {
      const assets = [
        createMockAsset({ filename: 'DSC0001' }),
        createMockAsset({ filename: 'DSC0002' }),
      ]
      const options: ExportOptions = {
        destinationHandle: createMockDirectoryHandle(),
        filenameTemplate: '{orig}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      const progressUpdates: ExportProgress[] = []
      await service.exportAssets(assets, options, (p) => progressUpdates.push({ ...p }))

      // Should have 3 progress updates: one for each asset + final
      expect(progressUpdates.length).toBeGreaterThanOrEqual(2)
      expect(progressUpdates[0].current).toBe(1)
      expect(progressUpdates[0].total).toBe(2)
      expect(progressUpdates[progressUpdates.length - 1].complete).toBe(true)
    })

    it('handles export errors gracefully', async () => {
      const asset = createMockAsset()
      mockDeps.loadImageBytes = vi.fn().mockRejectedValue(new Error('File not found'))

      const options: ExportOptions = {
        destinationHandle: createMockDirectoryHandle(),
        filenameTemplate: '{orig}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      const result = await service.exportAssets([asset], options)

      expect(result.successCount).toBe(0)
      expect(result.failureCount).toBe(1)
      expect(result.failures[0].error).toContain('File not found')
    })

    it('handles filename collisions with existing files', async () => {
      const asset = createMockAsset({ filename: 'existing' })
      const dirHandle = createMockDirectoryHandle({ existingFiles: ['existing.jpg'] })

      const options: ExportOptions = {
        destinationHandle: dirHandle,
        filenameTemplate: '{orig}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      const result = await service.exportAssets([asset], options)

      expect(result.successCount).toBe(1)
      // The service should have created a file with a different name
      expect(dirHandle.getFileHandle).toHaveBeenCalledWith('existing.jpg', { create: false })
    })

    it('applies edit state when present', async () => {
      const asset = createMockAsset()
      mockDeps.getEditState = vi.fn().mockResolvedValue({
        adjustments: {
          exposure: 0.5,
          contrast: 10,
          temperature: 0,
          tint: 0,
          saturation: 0,
          vibrance: 0,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          toneCurve: { points: [] },
        },
        rotation: { angle: 45, straighten: 0 },
        crop: { left: 0, top: 0, width: 0.5, height: 0.5 },
        toneCurve: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
      })

      const options: ExportOptions = {
        destinationHandle: createMockDirectoryHandle(),
        filenameTemplate: '{orig}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      await service.exportAssets([asset], options)

      expect(mockDeps.applyRotation).toHaveBeenCalled()
      expect(mockDeps.applyCrop).toHaveBeenCalled()
      expect(mockDeps.applyAdjustments).toHaveBeenCalled()
      expect(mockDeps.applyToneCurve).toHaveBeenCalled()
    })

    it('skips rotation when angle is 0', async () => {
      const asset = createMockAsset()
      mockDeps.getEditState = vi.fn().mockResolvedValue({
        rotation: { angle: 0, straighten: 0 },
      })

      const options: ExportOptions = {
        destinationHandle: createMockDirectoryHandle(),
        filenameTemplate: '{orig}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      await service.exportAssets([asset], options)

      expect(mockDeps.applyRotation).not.toHaveBeenCalled()
    })

    it('resizes when resizeLongEdge is specified', async () => {
      const asset = createMockAsset()
      mockDeps.decodeImage = vi.fn().mockResolvedValue({
        data: new Uint8Array([1, 2, 3]),
        width: 4000,
        height: 3000,
      })

      const options: ExportOptions = {
        destinationHandle: createMockDirectoryHandle(),
        filenameTemplate: '{orig}',
        quality: 90,
        resizeLongEdge: 2048,
        scope: 'all',
      }

      await service.exportAssets([asset], options)

      expect(mockDeps.resize).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        4000,
        3000,
        2048,
        1536
      )
    })

    it('does not resize when image is smaller than target', async () => {
      const asset = createMockAsset()
      mockDeps.decodeImage = vi.fn().mockResolvedValue({
        data: new Uint8Array([1, 2, 3]),
        width: 1000,
        height: 800,
      })

      const options: ExportOptions = {
        destinationHandle: createMockDirectoryHandle(),
        filenameTemplate: '{orig}',
        quality: 90,
        resizeLongEdge: 2048,
        scope: 'all',
      }

      await service.exportAssets([asset], options)

      expect(mockDeps.resize).not.toHaveBeenCalled()
    })

    it('uses startSequence for sequence numbering', async () => {
      const assets = [createMockAsset()]
      const dirHandle = createMockDirectoryHandle()

      const options: ExportOptions = {
        destinationHandle: dirHandle,
        filenameTemplate: '{seq:4}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
        startSequence: 100,
      }

      await service.exportAssets(assets, options)

      // Filename should be 0100.jpg
      expect(dirHandle.getFileHandle).toHaveBeenCalledWith('0100.jpg', { create: true })
    })

    it('adds .jpg extension when not present', async () => {
      const asset = createMockAsset({ filename: 'photo' })
      const dirHandle = createMockDirectoryHandle()

      const options: ExportOptions = {
        destinationHandle: dirHandle,
        filenameTemplate: '{orig}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      await service.exportAssets([asset], options)

      expect(dirHandle.getFileHandle).toHaveBeenCalledWith('photo.jpg', { create: true })
    })

    it('uses capture date in template', async () => {
      const asset = createMockAsset({
        filename: 'photo',
        captureDate: new Date('2026-01-15'),
      })
      const dirHandle = createMockDirectoryHandle()

      const options: ExportOptions = {
        destinationHandle: dirHandle,
        filenameTemplate: '{date}_{orig}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      await service.exportAssets([asset], options)

      expect(dirHandle.getFileHandle).toHaveBeenCalledWith('2026-01-15_photo.jpg', { create: true })
    })

    it('falls back to modified date when capture date is null', async () => {
      const asset = createMockAsset({
        filename: 'photo',
        captureDate: null,
        modifiedDate: new Date('2026-01-20'),
      })
      const dirHandle = createMockDirectoryHandle()

      const options: ExportOptions = {
        destinationHandle: dirHandle,
        filenameTemplate: '{date}_{orig}',
        quality: 90,
        resizeLongEdge: 0,
        scope: 'all',
      }

      await service.exportAssets([asset], options)

      expect(dirHandle.getFileHandle).toHaveBeenCalledWith('2026-01-20_photo.jpg', { create: true })
    })
  })
})

describe('filterAssetsForExport', () => {
  const assets: Asset[] = [
    createMockAsset({ id: '1', flag: 'pick' }),
    createMockAsset({ id: '2', flag: 'pick' }),
    createMockAsset({ id: '3', flag: 'reject' }),
    createMockAsset({ id: '4', flag: 'none' }),
    createMockAsset({ id: '5', flag: 'none' }),
  ]

  describe('scope: picks', () => {
    it('returns only picked assets', () => {
      const result = filterAssetsForExport(assets, 'picks')
      expect(result).toHaveLength(2)
      expect(result.every((a) => a.flag === 'pick')).toBe(true)
    })
  })

  describe('scope: selected', () => {
    it('returns only selected assets', () => {
      const selectedIds = new Set(['1', '3', '5'])
      const result = filterAssetsForExport(assets, 'selected', selectedIds)
      // Rejects are excluded by default
      expect(result).toHaveLength(2)
      expect(result.map((a) => a.id)).toEqual(['1', '5'])
    })

    it('includes rejected when includeRejected is true', () => {
      const selectedIds = new Set(['1', '3', '5'])
      const result = filterAssetsForExport(assets, 'selected', selectedIds, true)
      expect(result).toHaveLength(3)
      expect(result.map((a) => a.id)).toEqual(['1', '3', '5'])
    })
  })

  describe('scope: all', () => {
    it('returns all non-rejected assets by default', () => {
      const result = filterAssetsForExport(assets, 'all')
      expect(result).toHaveLength(4)
      expect(result.every((a) => a.flag !== 'reject')).toBe(true)
    })

    it('includes rejected when includeRejected is true', () => {
      const result = filterAssetsForExport(assets, 'all', new Set(), true)
      expect(result).toHaveLength(5)
    })
  })
})

describe('createExportService', () => {
  it('creates an ExportService instance', () => {
    const deps = createMockDependencies()
    const service = createExportService(deps)
    expect(service).toBeInstanceOf(ExportService)
  })
})
