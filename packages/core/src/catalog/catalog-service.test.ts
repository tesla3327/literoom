/**
 * Unit tests for CatalogService.
 *
 * Tests cover:
 * - Service creation and state management
 * - Asset management (getAsset, getAssets)
 * - Flag management (setFlag, setFlagBatch)
 * - Thumbnail and preview request forwarding
 * - Event callbacks
 * - Service lifecycle (destroy)
 *
 * Note: CatalogService uses File System Access API which requires browser
 * environment. These tests use mocked dependencies to test the service logic
 * in isolation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CatalogService, createCatalogService } from './catalog-service'
import { ThumbnailPriority, CatalogError } from './types'
import type { IScanService, IThumbnailService, ScannedFile, ScanOptions } from './types'
import type { IDecodeService } from '../decode/decode-service'
import type { EditedThumbnailEditState } from '../decode/worker-messages'

// ============================================================================
// Mock Helpers
// ============================================================================

/**
 * Create a mock scan service.
 */
function createMockScanService(): IScanService {
  return {
    scan: vi.fn(async function* (
      _directory: FileSystemDirectoryHandle,
      _options?: ScanOptions
    ): AsyncGenerator<ScannedFile[], void, unknown> {
      // Yield empty batches by default
      yield []
    }),
  }
}

/**
 * Create a mock thumbnail service.
 */
function createMockThumbnailService(): IThumbnailService {
  return {
    requestThumbnail: vi.fn(),
    updatePriority: vi.fn(),
    cancel: vi.fn(),
    cancelAll: vi.fn(),
    clearMemoryCache: vi.fn(),
    onThumbnailReady: null,
    onThumbnailError: null,
    queueSize: 0,
    isProcessing: false,
    requestPreview: vi.fn(),
    updatePreviewPriority: vi.fn(),
    cancelPreview: vi.fn(),
    cancelAllPreviews: vi.fn(),
    clearPreviewCache: vi.fn(),
    onPreviewReady: null,
    onPreviewError: null,
    previewQueueSize: 0,
    isProcessingPreviews: false,
    invalidateThumbnail: vi.fn().mockResolvedValue(undefined),
    regenerateThumbnail: vi.fn().mockResolvedValue(undefined),
  }
}

/**
 * Create a mock decode service.
 */
function createMockDecodeService(): IDecodeService {
  return {
    state: { status: 'ready' },
    isReady: true,
    decodeJpeg: vi.fn(),
    decodeRawThumbnail: vi.fn(),
    generateThumbnail: vi.fn(),
    generatePreview: vi.fn(),
    detectFileType: vi.fn(),
    applyAdjustments: vi.fn(),
    computeHistogram: vi.fn(),
    applyToneCurve: vi.fn(),
    applyRotation: vi.fn(),
    applyCrop: vi.fn(),
    encodeJpeg: vi.fn(),
    applyMaskedAdjustments: vi.fn(),
    generateEditedThumbnail: vi.fn(),
    destroy: vi.fn(),
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('CatalogService', () => {
  let mockDecodeService: IDecodeService

  beforeEach(() => {
    mockDecodeService = createMockDecodeService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('create', () => {
    it('creates service in ready state', async () => {
      const service = await CatalogService.create(mockDecodeService)

      expect(service.state.status).toBe('ready')
      expect(service.isReady).toBe(true)

      service.destroy()
    })
  })

  describe('state management', () => {
    it('returns a copy of state', async () => {
      const service = await CatalogService.create(mockDecodeService)

      const state1 = service.state
      const state2 = service.state

      // Should be different object instances
      expect(state1).not.toBe(state2)
      // But with same values
      expect(state1).toEqual(state2)

      service.destroy()
    })

    it('isReady reflects state status', async () => {
      const service = await CatalogService.create(mockDecodeService)

      expect(service.isReady).toBe(true)
      expect(service.state.status).toBe('ready')

      service.destroy()

      // After destroy, state should be initializing
      expect(service.state.status).toBe('initializing')
      expect(service.isReady).toBe(false)
    })
  })

  describe('getCurrentFolder', () => {
    it('returns null when no folder selected', async () => {
      const service = await CatalogService.create(mockDecodeService)

      expect(service.getCurrentFolder()).toBeNull()

      service.destroy()
    })
  })

  describe('getAsset', () => {
    it('returns undefined for unknown asset', async () => {
      const service = await CatalogService.create(mockDecodeService)

      const asset = service.getAsset('unknown-id')

      expect(asset).toBeUndefined()

      service.destroy()
    })
  })

  describe('getAssets', () => {
    it('returns empty array when no assets loaded', async () => {
      const service = await CatalogService.create(mockDecodeService)

      const assets = service.getAssets()

      expect(assets).toEqual([])

      service.destroy()
    })
  })

  describe('setFlag', () => {
    it('does nothing for unknown asset', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const onUpdate = vi.fn()
      service.onAssetUpdated = onUpdate

      await service.setFlag('unknown-id', 'pick')

      expect(onUpdate).not.toHaveBeenCalled()

      service.destroy()
    })
  })

  describe('setFlagBatch', () => {
    // NOTE: This test requires IndexedDB which isn't available in Node.js test environment
    // The setFlagBatch method uses Dexie's where() method which requires IndexedDB
    it.skip('handles empty asset list (requires IndexedDB)', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const onUpdate = vi.fn()
      service.onAssetUpdated = onUpdate

      await service.setFlagBatch([], 'pick')

      expect(onUpdate).not.toHaveBeenCalled()

      service.destroy()
    })
  })

  describe('requestThumbnail', () => {
    it('does nothing for unknown asset', async () => {
      const service = await CatalogService.create(mockDecodeService)

      // Should not throw
      service.requestThumbnail('unknown-id', ThumbnailPriority.VISIBLE)

      service.destroy()
    })
  })

  describe('updateThumbnailPriority', () => {
    it('can be called without error', async () => {
      const service = await CatalogService.create(mockDecodeService)

      // Should not throw
      service.updateThumbnailPriority('unknown-id', ThumbnailPriority.VISIBLE)

      service.destroy()
    })
  })

  describe('requestPreview', () => {
    it('does nothing for unknown asset', async () => {
      const service = await CatalogService.create(mockDecodeService)

      // Should not throw
      service.requestPreview('unknown-id', ThumbnailPriority.VISIBLE)

      service.destroy()
    })
  })

  describe('updatePreviewPriority', () => {
    it('can be called without error', async () => {
      const service = await CatalogService.create(mockDecodeService)

      // Should not throw
      service.updatePreviewPriority('unknown-id', ThumbnailPriority.VISIBLE)

      service.destroy()
    })
  })

  describe('regenerateThumbnail', () => {
    it('throws for unknown asset', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const editState: EditedThumbnailEditState = {}

      await expect(
        service.regenerateThumbnail('unknown-id', editState)
      ).rejects.toThrow(CatalogError)

      service.destroy()
    })
  })

  describe('scanFolder', () => {
    it('throws when no folder selected', async () => {
      const service = await CatalogService.create(mockDecodeService)

      await expect(service.scanFolder()).rejects.toThrow(CatalogError)
      await expect(service.scanFolder()).rejects.toThrow('No folder selected')

      service.destroy()
    })
  })

  describe('rescanFolder', () => {
    it('throws when no folder selected', async () => {
      const service = await CatalogService.create(mockDecodeService)

      await expect(service.rescanFolder()).rejects.toThrow(CatalogError)

      service.destroy()
    })
  })

  describe('cancelScan', () => {
    it('can be called safely when not scanning', async () => {
      const service = await CatalogService.create(mockDecodeService)

      // Should not throw
      service.cancelScan()

      service.destroy()
    })
  })

  describe('event callbacks', () => {
    it('allows setting onAssetsAdded callback', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const callback = vi.fn()

      service.onAssetsAdded = callback
      expect(service.onAssetsAdded).toBe(callback)

      service.onAssetsAdded = null
      expect(service.onAssetsAdded).toBeNull()

      service.destroy()
    })

    it('allows setting onAssetUpdated callback', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const callback = vi.fn()

      service.onAssetUpdated = callback
      expect(service.onAssetUpdated).toBe(callback)

      service.onAssetUpdated = null
      expect(service.onAssetUpdated).toBeNull()

      service.destroy()
    })

    it('allows setting onThumbnailReady callback', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const callback = vi.fn()

      service.onThumbnailReady = callback
      expect(service.onThumbnailReady).toBe(callback)

      service.onThumbnailReady = null
      expect(service.onThumbnailReady).toBeNull()

      service.destroy()
    })

    it('allows setting onPreviewReady callback', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const callback = vi.fn()

      service.onPreviewReady = callback
      expect(service.onPreviewReady).toBe(callback)

      service.onPreviewReady = null
      expect(service.onPreviewReady).toBeNull()

      service.destroy()
    })
  })

  describe('destroy', () => {
    it('clears state and assets', async () => {
      const service = await CatalogService.create(mockDecodeService)

      service.destroy()

      expect(service.state.status).toBe('initializing')
      expect(service.isReady).toBe(false)
      expect(service.getAssets()).toEqual([])
      expect(service.getCurrentFolder()).toBeNull()
    })

    it('can be called multiple times safely', async () => {
      const service = await CatalogService.create(mockDecodeService)

      service.destroy()
      service.destroy()
      service.destroy()

      expect(service.state.status).toBe('initializing')
    })
  })

  // NOTE: These tests require IndexedDB which isn't available in Node.js test environment
  // They are skipped but documented here for browser-based integration tests
  describe('loadFromDatabase', () => {
    it.skip('returns false when no folders in database (requires IndexedDB)', async () => {
      const service = await CatalogService.create(mockDecodeService)

      // Mock database to return empty
      const result = await service.loadFromDatabase()

      // Default behavior without mocking Dexie would return false
      expect(typeof result).toBe('boolean')

      service.destroy()
    })
  })

  describe('listFolders', () => {
    it.skip('returns array of folder info (requires IndexedDB)', async () => {
      const service = await CatalogService.create(mockDecodeService)

      const folders = await service.listFolders()

      expect(Array.isArray(folders)).toBe(true)

      service.destroy()
    })

    it.skip('accepts limit parameter (requires IndexedDB)', async () => {
      const service = await CatalogService.create(mockDecodeService)

      const folders = await service.listFolders(3)

      expect(Array.isArray(folders)).toBe(true)
      expect(folders.length).toBeLessThanOrEqual(3)

      service.destroy()
    })
  })

  describe('loadFolderById', () => {
    it.skip('returns false for non-existent folder (requires IndexedDB)', async () => {
      const service = await CatalogService.create(mockDecodeService)

      const result = await service.loadFolderById(99999)

      expect(result).toBe(false)

      service.destroy()
    })
  })

  describe('createCatalogService factory', () => {
    it('creates a CatalogService instance', async () => {
      const service = await createCatalogService(mockDecodeService)

      expect(service).toBeInstanceOf(CatalogService)
      expect(service.isReady).toBe(true)

      service.destroy()
    })
  })
})

describe('CatalogError', () => {
  it('has correct error properties', () => {
    const cause = new Error('original error')
    const error = new CatalogError('Test error', 'PERMISSION_DENIED', cause)

    expect(error.name).toBe('CatalogError')
    expect(error.message).toBe('Test error')
    expect(error.code).toBe('PERMISSION_DENIED')
    expect(error.cause).toBe(cause)
  })

  it('works without cause', () => {
    const error = new CatalogError('No cause', 'FOLDER_NOT_FOUND')

    expect(error.code).toBe('FOLDER_NOT_FOUND')
    expect(error.cause).toBeUndefined()
  })

  it('supports all error codes', () => {
    const codes = [
      'PERMISSION_DENIED',
      'FOLDER_NOT_FOUND',
      'SCAN_CANCELLED',
      'DATABASE_ERROR',
      'STORAGE_FULL',
      'THUMBNAIL_ERROR',
      'UNKNOWN',
    ] as const

    for (const code of codes) {
      const error = new CatalogError(`Test ${code}`, code)
      expect(error.code).toBe(code)
    }
  })
})
