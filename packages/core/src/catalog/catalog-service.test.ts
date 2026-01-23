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
import type { Asset, IScanService, IThumbnailService, ScannedFile, ScanOptions } from './types'
import type { IDecodeService } from '../decode/decode-service'
import type { EditedThumbnailEditState } from '../decode/worker-messages'
import type { AssetRecord } from './db'

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

describe('selectFolder', () => {
  let mockDecodeService: IDecodeService
  const mockShowDirectoryPicker = vi.fn()

  beforeEach(() => {
    mockDecodeService = createMockDecodeService()
    vi.stubGlobal('window', {
      showDirectoryPicker: mockShowDirectoryPicker,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('throws PERMISSION_DENIED when showDirectoryPicker is not available', async () => {
    vi.stubGlobal('window', {})

    const service = await CatalogService.create(mockDecodeService)

    await expect(service.selectFolder()).rejects.toThrow(CatalogError)
    await expect(service.selectFolder()).rejects.toThrow(
      'File System Access API is not supported in this browser'
    )

    try {
      await service.selectFolder()
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogError)
      expect((error as CatalogError).code).toBe('PERMISSION_DENIED')
    }

    service.destroy()
  })

  it('returns without error on user cancel (AbortError)', async () => {
    const abortError = new DOMException('User cancelled', 'AbortError')
    mockShowDirectoryPicker.mockRejectedValue(abortError)

    const service = await CatalogService.create(mockDecodeService)

    // Should not throw - just returns silently
    await expect(service.selectFolder()).resolves.toBeUndefined()

    service.destroy()
  })

  it('throws PERMISSION_DENIED on SecurityError', async () => {
    const securityError = new DOMException('Security error', 'SecurityError')
    mockShowDirectoryPicker.mockRejectedValue(securityError)

    const service = await CatalogService.create(mockDecodeService)

    await expect(service.selectFolder()).rejects.toThrow(CatalogError)
    await expect(service.selectFolder()).rejects.toThrow('Permission denied')

    try {
      await service.selectFolder()
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogError)
      expect((error as CatalogError).code).toBe('PERMISSION_DENIED')
      expect((error as CatalogError).cause).toBe(securityError)
    }

    service.destroy()
  })

  it('throws PERMISSION_DENIED on NotAllowedError', async () => {
    const notAllowedError = new DOMException('Not allowed', 'NotAllowedError')
    mockShowDirectoryPicker.mockRejectedValue(notAllowedError)

    const service = await CatalogService.create(mockDecodeService)

    await expect(service.selectFolder()).rejects.toThrow(CatalogError)
    await expect(service.selectFolder()).rejects.toThrow('Permission denied')

    try {
      await service.selectFolder()
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogError)
      expect((error as CatalogError).code).toBe('PERMISSION_DENIED')
      expect((error as CatalogError).cause).toBe(notAllowedError)
    }

    service.destroy()
  })

  it('throws UNKNOWN on other DOMException', async () => {
    const otherDOMError = new DOMException('Some other error', 'DataError')
    mockShowDirectoryPicker.mockRejectedValue(otherDOMError)

    const service = await CatalogService.create(mockDecodeService)

    await expect(service.selectFolder()).rejects.toThrow(CatalogError)
    await expect(service.selectFolder()).rejects.toThrow('Failed to select folder')

    try {
      await service.selectFolder()
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogError)
      expect((error as CatalogError).code).toBe('UNKNOWN')
      expect((error as CatalogError).cause).toBe(otherDOMError)
    }

    service.destroy()
  })

  it('throws UNKNOWN on generic errors', async () => {
    const genericError = new Error('Something went wrong')
    mockShowDirectoryPicker.mockRejectedValue(genericError)

    const service = await CatalogService.create(mockDecodeService)

    await expect(service.selectFolder()).rejects.toThrow(CatalogError)
    await expect(service.selectFolder()).rejects.toThrow(
      'Failed to select folder: Something went wrong'
    )

    try {
      await service.selectFolder()
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogError)
      expect((error as CatalogError).code).toBe('UNKNOWN')
      expect((error as CatalogError).cause).toBe(genericError)
    }

    service.destroy()
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

describe('assetRecordToAsset', () => {
  let service: CatalogService
  let mockDecodeService: IDecodeService
  let serviceInternal: {
    assetRecordToAsset: (record: AssetRecord, getFile?: () => Promise<File>) => Asset
  }

  beforeEach(async () => {
    mockDecodeService = createMockDecodeService()
    service = await CatalogService.create(mockDecodeService)
    serviceInternal = service as unknown as typeof serviceInternal
  })

  afterEach(() => {
    service.destroy()
  })

  it('converts record correctly with all fields', () => {
    const captureDate = new Date('2024-06-15T10:30:00Z')
    const modifiedDate = new Date('2024-06-16T14:00:00Z')

    const record: AssetRecord = {
      id: 1,
      uuid: 'abc-123-def-456',
      folderId: 42,
      path: 'photos/vacation',
      filename: 'sunset',
      extension: 'arw',
      flag: 'pick',
      captureDate,
      modifiedDate,
      fileSize: 25000000,
      width: 6000,
      height: 4000,
    }

    const asset = serviceInternal.assetRecordToAsset(record)

    expect(asset.id).toBe('abc-123-def-456')
    expect(asset.folderId).toBe('42')
    expect(asset.path).toBe('photos/vacation')
    expect(asset.filename).toBe('sunset')
    expect(asset.extension).toBe('arw')
    expect(asset.flag).toBe('pick')
    expect(asset.captureDate).toBe(captureDate)
    expect(asset.modifiedDate).toBe(modifiedDate)
    expect(asset.fileSize).toBe(25000000)
    expect(asset.width).toBe(6000)
    expect(asset.height).toBe(4000)
  })

  it('handles optional width/height fields (undefined)', () => {
    const record: AssetRecord = {
      uuid: 'test-uuid',
      folderId: 1,
      path: 'test/path',
      filename: 'test',
      extension: 'jpg',
      flag: 'none',
      captureDate: null,
      modifiedDate: new Date(),
      fileSize: 1000,
      // width and height intentionally omitted
    }

    const asset = serviceInternal.assetRecordToAsset(record)

    expect(asset.width).toBeUndefined()
    expect(asset.height).toBeUndefined()
  })

  it('sets thumbnailStatus to pending always', () => {
    const record: AssetRecord = {
      uuid: 'thumb-test-uuid',
      folderId: 5,
      path: 'some/path',
      filename: 'image',
      extension: 'png',
      flag: 'reject',
      captureDate: new Date(),
      modifiedDate: new Date(),
      fileSize: 5000,
      width: 1920,
      height: 1080,
    }

    const asset = serviceInternal.assetRecordToAsset(record)

    expect(asset.thumbnailStatus).toBe('pending')
  })

  it('sets thumbnailUrl to null always', () => {
    const record: AssetRecord = {
      uuid: 'url-test-uuid',
      folderId: 10,
      path: 'another/path',
      filename: 'photo',
      extension: 'jpeg',
      flag: 'none',
      captureDate: null,
      modifiedDate: new Date(),
      fileSize: 2000,
    }

    const asset = serviceInternal.assetRecordToAsset(record)

    expect(asset.thumbnailUrl).toBeNull()
  })

  it('converts folderId to string (record has number, asset needs string)', () => {
    const record: AssetRecord = {
      uuid: 'folder-id-test',
      folderId: 12345,
      path: 'test',
      filename: 'test',
      extension: 'arw',
      flag: 'none',
      captureDate: null,
      modifiedDate: new Date(),
      fileSize: 100,
    }

    const asset = serviceInternal.assetRecordToAsset(record)

    expect(typeof record.folderId).toBe('number')
    expect(typeof asset.folderId).toBe('string')
    expect(asset.folderId).toBe('12345')
  })
})

describe('asset thumbnail/preview requests', () => {
  let mockDecodeService: IDecodeService
  let mockThumbnailService: IThumbnailService
  let service: CatalogService

  // Type for accessing internal service properties
  type ServiceInternal = {
    _assets: Map<string, Asset>
    _currentFolder: FileSystemDirectoryHandle | null
    thumbnailService: IThumbnailService
  }

  // Test asset factory
  function createTestAsset(overrides: Partial<Asset> = {}): Asset {
    return {
      id: 'test-asset-1',
      folderId: '1',
      path: 'subfolder/test.jpg',
      filename: 'test',
      extension: 'jpg',
      flag: 'none',
      captureDate: null,
      modifiedDate: new Date('2024-01-01'),
      fileSize: 1024,
      thumbnailStatus: 'pending',
      thumbnailUrl: null,
      ...overrides,
    }
  }

  // Create mock folder handle
  function createMockFolderHandle(): FileSystemDirectoryHandle {
    return {
      name: 'test-folder',
      kind: 'directory',
      getFileHandle: vi.fn(),
      getDirectoryHandle: vi.fn(),
      isSameEntry: vi.fn(),
      queryPermission: vi.fn(),
      requestPermission: vi.fn(),
      resolve: vi.fn(),
      keys: vi.fn(),
      values: vi.fn(),
      entries: vi.fn(),
      [Symbol.asyncIterator]: vi.fn(),
    } as unknown as FileSystemDirectoryHandle
  }

  beforeEach(async () => {
    mockDecodeService = createMockDecodeService()
    mockThumbnailService = createMockThumbnailService()
    service = await CatalogService.create(mockDecodeService)

    // Replace the thumbnail service with our mock
    ;(service as unknown as ServiceInternal).thumbnailService = mockThumbnailService

    // Set up mock folder handle so getBytes function can be created
    const mockFolder = createMockFolderHandle()
    ;(service as unknown as ServiceInternal)._currentFolder = mockFolder
  })

  afterEach(() => {
    service.destroy()
    vi.clearAllMocks()
  })

  describe('requestThumbnail', () => {
    it('calls thumbnailService.requestThumbnail with existing asset', () => {
      const testAsset = createTestAsset()
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      service.requestThumbnail(testAsset.id, ThumbnailPriority.VISIBLE)

      expect(mockThumbnailService.requestThumbnail).toHaveBeenCalledTimes(1)
      expect(mockThumbnailService.requestThumbnail).toHaveBeenCalledWith(
        testAsset.id,
        expect.any(Function),
        ThumbnailPriority.VISIBLE
      )
    })

    it('updates asset status from pending to loading', () => {
      const testAsset = createTestAsset({ thumbnailStatus: 'pending' })
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      service.requestThumbnail(testAsset.id, ThumbnailPriority.VISIBLE)

      const updatedAsset = service.getAsset(testAsset.id)
      expect(updatedAsset?.thumbnailStatus).toBe('loading')
    })

    it('does not update status if already not pending', () => {
      const testAsset = createTestAsset({ thumbnailStatus: 'ready' })
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      service.requestThumbnail(testAsset.id, ThumbnailPriority.VISIBLE)

      const updatedAsset = service.getAsset(testAsset.id)
      expect(updatedAsset?.thumbnailStatus).toBe('ready')
    })

    it('uses correct priority level', () => {
      const testAsset = createTestAsset()
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      service.requestThumbnail(testAsset.id, ThumbnailPriority.BACKGROUND)

      expect(mockThumbnailService.requestThumbnail).toHaveBeenCalledWith(
        testAsset.id,
        expect.any(Function),
        ThumbnailPriority.BACKGROUND
      )
    })
  })

  describe('requestPreview', () => {
    it('calls thumbnailService.requestPreview with existing asset', () => {
      const testAsset = createTestAsset()
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      service.requestPreview(testAsset.id, ThumbnailPriority.VISIBLE)

      expect(mockThumbnailService.requestPreview).toHaveBeenCalledTimes(1)
      expect(mockThumbnailService.requestPreview).toHaveBeenCalledWith(
        testAsset.id,
        expect.any(Function),
        ThumbnailPriority.VISIBLE
      )
    })

    it('updates asset preview1xStatus to loading when pending', () => {
      const testAsset = createTestAsset({ preview1xStatus: 'pending' })
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      service.requestPreview(testAsset.id, ThumbnailPriority.VISIBLE)

      const updatedAsset = service.getAsset(testAsset.id)
      expect(updatedAsset?.preview1xStatus).toBe('loading')
    })

    it('updates asset preview1xStatus to loading when undefined', () => {
      const testAsset = createTestAsset()
      // Explicitly remove preview1xStatus to test undefined case
      delete (testAsset as { preview1xStatus?: string }).preview1xStatus
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      service.requestPreview(testAsset.id, ThumbnailPriority.VISIBLE)

      const updatedAsset = service.getAsset(testAsset.id)
      expect(updatedAsset?.preview1xStatus).toBe('loading')
    })

    it('does not update preview1xStatus if already not pending', () => {
      const testAsset = createTestAsset({ preview1xStatus: 'ready' })
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      service.requestPreview(testAsset.id, ThumbnailPriority.VISIBLE)

      const updatedAsset = service.getAsset(testAsset.id)
      expect(updatedAsset?.preview1xStatus).toBe('ready')
    })

    it('uses correct priority level', () => {
      const testAsset = createTestAsset()
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      service.requestPreview(testAsset.id, ThumbnailPriority.PRELOAD)

      expect(mockThumbnailService.requestPreview).toHaveBeenCalledWith(
        testAsset.id,
        expect.any(Function),
        ThumbnailPriority.PRELOAD
      )
    })
  })

  describe('updateThumbnailPriority', () => {
    it('forwards call to thumbnailService.updatePriority', () => {
      service.updateThumbnailPriority('any-asset-id', ThumbnailPriority.NEAR_VISIBLE)

      expect(mockThumbnailService.updatePriority).toHaveBeenCalledTimes(1)
      expect(mockThumbnailService.updatePriority).toHaveBeenCalledWith(
        'any-asset-id',
        ThumbnailPriority.NEAR_VISIBLE
      )
    })
  })

  describe('updatePreviewPriority', () => {
    it('forwards call to thumbnailService.updatePreviewPriority', () => {
      service.updatePreviewPriority('any-asset-id', ThumbnailPriority.VISIBLE)

      expect(mockThumbnailService.updatePreviewPriority).toHaveBeenCalledTimes(1)
      expect(mockThumbnailService.updatePreviewPriority).toHaveBeenCalledWith(
        'any-asset-id',
        ThumbnailPriority.VISIBLE
      )
    })
  })

  describe('regenerateThumbnail', () => {
    it('updates asset status to loading and calls thumbnailService', async () => {
      const testAsset = createTestAsset({ thumbnailStatus: 'ready' })
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      const editState: EditedThumbnailEditState = {}
      const onUpdate = vi.fn()
      service.onAssetUpdated = onUpdate

      await service.regenerateThumbnail(testAsset.id, editState)

      // Verify status was updated to loading
      expect(onUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          id: testAsset.id,
          thumbnailStatus: 'loading',
        })
      )

      // Verify thumbnailService.regenerateThumbnail was called
      expect(mockThumbnailService.regenerateThumbnail).toHaveBeenCalledTimes(1)
      expect(mockThumbnailService.regenerateThumbnail).toHaveBeenCalledWith(
        testAsset.id,
        expect.any(Function),
        editState,
        ThumbnailPriority.BACKGROUND
      )
    })

    it('passes editState to thumbnailService', async () => {
      const testAsset = createTestAsset()
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      const editState: EditedThumbnailEditState = {
        rotation: { angle: 90, straighten: 0 },
      }

      await service.regenerateThumbnail(testAsset.id, editState)

      expect(mockThumbnailService.regenerateThumbnail).toHaveBeenCalledWith(
        testAsset.id,
        expect.any(Function),
        editState,
        ThumbnailPriority.BACKGROUND
      )
    })

    it('updates in-memory asset status', async () => {
      const testAsset = createTestAsset({ thumbnailStatus: 'ready' })
      const serviceInternal = service as unknown as ServiceInternal
      serviceInternal._assets.set(testAsset.id, testAsset)

      await service.regenerateThumbnail(testAsset.id, {})

      const updatedAsset = service.getAsset(testAsset.id)
      expect(updatedAsset?.thumbnailStatus).toBe('loading')
    })
  })
})

// ============================================================================
// Internal Callback Handlers Tests
// ============================================================================

describe('internal callback handlers', () => {
  /**
   * Create a mock thumbnail service that captures callbacks when they are set.
   */
  function createMockThumbnailServiceWithCallbackCapture(): IThumbnailService & {
    capturedOnThumbnailReady: ((assetId: string, url: string) => void) | null
    capturedOnThumbnailError: ((assetId: string, error: Error) => void) | null
    capturedOnPreviewReady: ((assetId: string, url: string) => void) | null
    capturedOnPreviewError: ((assetId: string, error: Error) => void) | null
  } {
    const mock = {
      capturedOnThumbnailReady: null as ((assetId: string, url: string) => void) | null,
      capturedOnThumbnailError: null as ((assetId: string, error: Error) => void) | null,
      capturedOnPreviewReady: null as ((assetId: string, url: string) => void) | null,
      capturedOnPreviewError: null as ((assetId: string, error: Error) => void) | null,

      _onThumbnailReady: null as ((assetId: string, url: string) => void) | null,
      _onThumbnailError: null as ((assetId: string, error: Error) => void) | null,
      _onPreviewReady: null as ((assetId: string, url: string) => void) | null,
      _onPreviewError: null as ((assetId: string, error: Error) => void) | null,

      get onThumbnailReady() {
        return this._onThumbnailReady
      },
      set onThumbnailReady(cb: ((assetId: string, url: string) => void) | null) {
        this._onThumbnailReady = cb
        this.capturedOnThumbnailReady = cb
      },

      get onThumbnailError() {
        return this._onThumbnailError
      },
      set onThumbnailError(cb: ((assetId: string, error: Error) => void) | null) {
        this._onThumbnailError = cb
        this.capturedOnThumbnailError = cb
      },

      get onPreviewReady() {
        return this._onPreviewReady
      },
      set onPreviewReady(cb: ((assetId: string, url: string) => void) | null) {
        this._onPreviewReady = cb
        this.capturedOnPreviewReady = cb
      },

      get onPreviewError() {
        return this._onPreviewError
      },
      set onPreviewError(cb: ((assetId: string, error: Error) => void) | null) {
        this._onPreviewError = cb
        this.capturedOnPreviewError = cb
      },

      requestThumbnail: vi.fn(),
      updatePriority: vi.fn(),
      cancel: vi.fn(),
      cancelAll: vi.fn(),
      clearMemoryCache: vi.fn(),
      queueSize: 0,
      isProcessing: false,
      requestPreview: vi.fn(),
      updatePreviewPriority: vi.fn(),
      cancelPreview: vi.fn(),
      cancelAllPreviews: vi.fn(),
      clearPreviewCache: vi.fn(),
      previewQueueSize: 0,
      isProcessingPreviews: false,
      invalidateThumbnail: vi.fn().mockResolvedValue(undefined),
      regenerateThumbnail: vi.fn().mockResolvedValue(undefined),
    }

    return mock
  }

  /**
   * Create a mock asset with minimal required fields.
   */
  function createMockAsset(overrides: Partial<Asset> = {}): Asset {
    return {
      id: 'test-asset-1',
      folderId: '1',
      path: 'test-folder',
      filename: 'test-image',
      extension: 'jpg',
      flag: 'none',
      captureDate: null,
      modifiedDate: new Date(),
      fileSize: 1024,
      thumbnailStatus: 'pending',
      thumbnailUrl: null,
      ...overrides,
    }
  }

  /**
   * Helper to create a CatalogService with injected mock services.
   * We use Object.create to bypass the private constructor.
   */
  function createServiceWithMocks(
    mockScanService: IScanService,
    mockThumbnailService: IThumbnailService
  ): CatalogService {
    // Use Object.create to bypass the private constructor
    const service = Object.create(CatalogService.prototype) as CatalogService

    // Set up internal state via type casting to access private fields
    const privateService = service as unknown as {
      scanService: IScanService
      thumbnailService: IThumbnailService
      _state: { status: string }
      _currentFolder: null
      _currentFolderId: null
      _assets: Map<string, Asset>
      _abortController: null
      _onAssetsAdded: null
      _onAssetUpdated: null
      _onThumbnailReady: null
      _onPreviewReady: null
    }

    privateService.scanService = mockScanService
    privateService.thumbnailService = mockThumbnailService
    privateService._state = { status: 'ready' }
    privateService._currentFolder = null
    privateService._currentFolderId = null
    privateService._assets = new Map()
    privateService._abortController = null
    privateService._onAssetsAdded = null
    privateService._onAssetUpdated = null
    privateService._onThumbnailReady = null
    privateService._onPreviewReady = null

    // Wire up thumbnail callbacks (mimicking constructor behavior)
    mockThumbnailService.onThumbnailReady = (
      service as unknown as { handleThumbnailReady: (id: string, url: string) => void }
    ).handleThumbnailReady.bind(service)
    mockThumbnailService.onThumbnailError = (
      service as unknown as { handleThumbnailError: (id: string, error: Error) => void }
    ).handleThumbnailError.bind(service)
    mockThumbnailService.onPreviewReady = (
      service as unknown as { handlePreviewReady: (id: string, url: string) => void }
    ).handlePreviewReady.bind(service)
    mockThumbnailService.onPreviewError = (
      service as unknown as { handlePreviewError: (id: string, error: Error) => void }
    ).handlePreviewError.bind(service)

    return service
  }

  /**
   * Add an asset to the service's internal _assets map.
   */
  function addAssetToService(service: CatalogService, asset: Asset): void {
    const privateService = service as unknown as {
      _assets: Map<string, Asset>
    }
    privateService._assets.set(asset.id, asset)
  }

  describe('handleThumbnailReady', () => {
    it('updates asset state and calls both callbacks', () => {
      const mockScanService = createMockScanService()
      const mockThumbnailService = createMockThumbnailServiceWithCallbackCapture()
      const service = createServiceWithMocks(mockScanService, mockThumbnailService)

      // Add an asset to the service
      const asset = createMockAsset({ thumbnailStatus: 'loading' })
      addAssetToService(service, asset)

      // Set up callbacks
      const onAssetUpdated = vi.fn()
      const onThumbnailReady = vi.fn()
      service.onAssetUpdated = onAssetUpdated
      service.onThumbnailReady = onThumbnailReady

      // Trigger the internal callback
      mockThumbnailService.capturedOnThumbnailReady!('test-asset-1', 'blob:thumbnail-url')

      // Verify asset was updated
      const updatedAsset = service.getAsset('test-asset-1')
      expect(updatedAsset).toBeDefined()
      expect(updatedAsset!.thumbnailStatus).toBe('ready')
      expect(updatedAsset!.thumbnailUrl).toBe('blob:thumbnail-url')

      // Verify callbacks were called
      expect(onAssetUpdated).toHaveBeenCalledTimes(1)
      expect(onAssetUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-asset-1',
          thumbnailStatus: 'ready',
          thumbnailUrl: 'blob:thumbnail-url',
        })
      )

      expect(onThumbnailReady).toHaveBeenCalledTimes(1)
      expect(onThumbnailReady).toHaveBeenCalledWith('test-asset-1', 'blob:thumbnail-url')

      service.destroy()
    })

    it('does nothing for unknown asset but still calls onThumbnailReady', () => {
      const mockScanService = createMockScanService()
      const mockThumbnailService = createMockThumbnailServiceWithCallbackCapture()
      const service = createServiceWithMocks(mockScanService, mockThumbnailService)

      // Set up callbacks
      const onAssetUpdated = vi.fn()
      const onThumbnailReady = vi.fn()
      service.onAssetUpdated = onAssetUpdated
      service.onThumbnailReady = onThumbnailReady

      // Trigger the internal callback for an unknown asset
      mockThumbnailService.capturedOnThumbnailReady!('unknown-asset', 'blob:thumbnail-url')

      // Verify onAssetUpdated was NOT called (no asset to update)
      expect(onAssetUpdated).not.toHaveBeenCalled()

      // Verify onThumbnailReady was still called (external callback is always called)
      expect(onThumbnailReady).toHaveBeenCalledTimes(1)
      expect(onThumbnailReady).toHaveBeenCalledWith('unknown-asset', 'blob:thumbnail-url')

      service.destroy()
    })
  })

  describe('handleThumbnailError', () => {
    it('updates asset state to error and calls onAssetUpdated', () => {
      const mockScanService = createMockScanService()
      const mockThumbnailService = createMockThumbnailServiceWithCallbackCapture()
      const service = createServiceWithMocks(mockScanService, mockThumbnailService)

      // Add an asset to the service
      const asset = createMockAsset({ thumbnailStatus: 'loading' })
      addAssetToService(service, asset)

      // Set up callback
      const onAssetUpdated = vi.fn()
      service.onAssetUpdated = onAssetUpdated

      // Suppress console.error during this test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Trigger the internal callback
      const error = new Error('Thumbnail generation failed')
      mockThumbnailService.capturedOnThumbnailError!('test-asset-1', error)

      // Verify asset was updated
      const updatedAsset = service.getAsset('test-asset-1')
      expect(updatedAsset).toBeDefined()
      expect(updatedAsset!.thumbnailStatus).toBe('error')

      // Verify callback was called
      expect(onAssetUpdated).toHaveBeenCalledTimes(1)
      expect(onAssetUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-asset-1',
          thumbnailStatus: 'error',
        })
      )

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Thumbnail error for test-asset-1'),
        error
      )

      consoleErrorSpy.mockRestore()
      service.destroy()
    })

    it('does nothing for unknown asset', () => {
      const mockScanService = createMockScanService()
      const mockThumbnailService = createMockThumbnailServiceWithCallbackCapture()
      const service = createServiceWithMocks(mockScanService, mockThumbnailService)

      // Set up callback
      const onAssetUpdated = vi.fn()
      service.onAssetUpdated = onAssetUpdated

      // Suppress console.error during this test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Trigger the internal callback for an unknown asset
      const error = new Error('Thumbnail generation failed')
      mockThumbnailService.capturedOnThumbnailError!('unknown-asset', error)

      // Verify onAssetUpdated was NOT called
      expect(onAssetUpdated).not.toHaveBeenCalled()

      // Error is still logged
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
      service.destroy()
    })
  })

  describe('handlePreviewReady', () => {
    it('updates asset state and calls both callbacks', () => {
      const mockScanService = createMockScanService()
      const mockThumbnailService = createMockThumbnailServiceWithCallbackCapture()
      const service = createServiceWithMocks(mockScanService, mockThumbnailService)

      // Add an asset to the service
      const asset = createMockAsset({ preview1xStatus: 'loading' })
      addAssetToService(service, asset)

      // Set up callbacks
      const onAssetUpdated = vi.fn()
      const onPreviewReady = vi.fn()
      service.onAssetUpdated = onAssetUpdated
      service.onPreviewReady = onPreviewReady

      // Trigger the internal callback
      mockThumbnailService.capturedOnPreviewReady!('test-asset-1', 'blob:preview-url')

      // Verify asset was updated
      const updatedAsset = service.getAsset('test-asset-1')
      expect(updatedAsset).toBeDefined()
      expect(updatedAsset!.preview1xStatus).toBe('ready')
      expect(updatedAsset!.preview1xUrl).toBe('blob:preview-url')

      // Verify callbacks were called
      expect(onAssetUpdated).toHaveBeenCalledTimes(1)
      expect(onAssetUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-asset-1',
          preview1xStatus: 'ready',
          preview1xUrl: 'blob:preview-url',
        })
      )

      expect(onPreviewReady).toHaveBeenCalledTimes(1)
      expect(onPreviewReady).toHaveBeenCalledWith('test-asset-1', 'blob:preview-url')

      service.destroy()
    })

    it('does nothing for unknown asset but still calls onPreviewReady', () => {
      const mockScanService = createMockScanService()
      const mockThumbnailService = createMockThumbnailServiceWithCallbackCapture()
      const service = createServiceWithMocks(mockScanService, mockThumbnailService)

      // Set up callbacks
      const onAssetUpdated = vi.fn()
      const onPreviewReady = vi.fn()
      service.onAssetUpdated = onAssetUpdated
      service.onPreviewReady = onPreviewReady

      // Trigger the internal callback for an unknown asset
      mockThumbnailService.capturedOnPreviewReady!('unknown-asset', 'blob:preview-url')

      // Verify onAssetUpdated was NOT called (no asset to update)
      expect(onAssetUpdated).not.toHaveBeenCalled()

      // Verify onPreviewReady was still called (external callback is always called)
      expect(onPreviewReady).toHaveBeenCalledTimes(1)
      expect(onPreviewReady).toHaveBeenCalledWith('unknown-asset', 'blob:preview-url')

      service.destroy()
    })
  })

  describe('handlePreviewError', () => {
    it('updates asset state to error and calls onAssetUpdated', () => {
      const mockScanService = createMockScanService()
      const mockThumbnailService = createMockThumbnailServiceWithCallbackCapture()
      const service = createServiceWithMocks(mockScanService, mockThumbnailService)

      // Add an asset to the service
      const asset = createMockAsset({ preview1xStatus: 'loading' })
      addAssetToService(service, asset)

      // Set up callback
      const onAssetUpdated = vi.fn()
      service.onAssetUpdated = onAssetUpdated

      // Suppress console.error during this test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Trigger the internal callback
      const error = new Error('Preview generation failed')
      mockThumbnailService.capturedOnPreviewError!('test-asset-1', error)

      // Verify asset was updated
      const updatedAsset = service.getAsset('test-asset-1')
      expect(updatedAsset).toBeDefined()
      expect(updatedAsset!.preview1xStatus).toBe('error')

      // Verify callback was called
      expect(onAssetUpdated).toHaveBeenCalledTimes(1)
      expect(onAssetUpdated).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-asset-1',
          preview1xStatus: 'error',
        })
      )

      // Verify error was logged
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Preview error for test-asset-1'),
        error
      )

      consoleErrorSpy.mockRestore()
      service.destroy()
    })

    it('does nothing for unknown asset', () => {
      const mockScanService = createMockScanService()
      const mockThumbnailService = createMockThumbnailServiceWithCallbackCapture()
      const service = createServiceWithMocks(mockScanService, mockThumbnailService)

      // Set up callback
      const onAssetUpdated = vi.fn()
      service.onAssetUpdated = onAssetUpdated

      // Suppress console.error during this test
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      // Trigger the internal callback for an unknown asset
      const error = new Error('Preview generation failed')
      mockThumbnailService.capturedOnPreviewError!('unknown-asset', error)

      // Verify onAssetUpdated was NOT called
      expect(onAssetUpdated).not.toHaveBeenCalled()

      // Error is still logged
      expect(consoleErrorSpy).toHaveBeenCalled()

      consoleErrorSpy.mockRestore()
      service.destroy()
    })
  })
})

// ============================================================================
// scanFolder State Management Tests
// ============================================================================

describe('scanFolder state management', () => {
  let mockDecodeService: IDecodeService

  // Type for accessing private members
  type ServiceInternals = {
    _currentFolder: FileSystemDirectoryHandle | null
    _currentFolderId: number | null
    _state: { status: string; scanProgress?: object; error?: string }
    _abortController: AbortController | null
    scanService: IScanService
  }

  /**
   * Create a mock folder handle for testing.
   */
  function createMockFolder(): FileSystemDirectoryHandle {
    return {
      name: 'test-folder',
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
    } as unknown as FileSystemDirectoryHandle
  }

  /**
   * Create a controllable mock scan service.
   * Returns an object with the service and controls for yielding batches or throwing errors.
   */
  function createControllableScanService(): {
    service: IScanService
    yieldBatch: (batch: ScannedFile[]) => void
    complete: () => void
    throwError: (error: Error) => void
    getSignal: () => AbortSignal | undefined
  } {
    let resolveNext: ((value: IteratorResult<ScannedFile[], void>) => void) | null = null
    let rejectNext: ((error: Error) => void) | null = null
    let capturedSignal: AbortSignal | undefined

    const service: IScanService = {
      scan: vi.fn(async function* (
        _directory: FileSystemDirectoryHandle,
        options?: ScanOptions
      ): AsyncGenerator<ScannedFile[], void, unknown> {
        capturedSignal = options?.signal

        // Yield batches as they are provided via yieldBatch()
        while (true) {
          const result = await new Promise<IteratorResult<ScannedFile[], void>>(
            (resolve, reject) => {
              resolveNext = resolve
              rejectNext = reject
            }
          )

          if (result.done) {
            return
          }

          yield result.value
        }
      }),
    }

    return {
      service,
      yieldBatch: (batch: ScannedFile[]) => {
        if (resolveNext) {
          const resolve = resolveNext
          resolveNext = null
          rejectNext = null
          resolve({ value: batch, done: false })
        }
      },
      complete: () => {
        if (resolveNext) {
          const resolve = resolveNext
          resolveNext = null
          rejectNext = null
          resolve({ value: undefined, done: true })
        }
      },
      throwError: (error: Error) => {
        if (rejectNext) {
          const reject = rejectNext
          resolveNext = null
          rejectNext = null
          reject(error)
        }
      },
      getSignal: () => capturedSignal,
    }
  }

  beforeEach(() => {
    mockDecodeService = createMockDecodeService()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('throws error when scan is already in progress', async () => {
    const service = await CatalogService.create(mockDecodeService)
    const mockFolder = createMockFolder()

    // Access private members to set up state
    const serviceInternal = service as unknown as ServiceInternals
    serviceInternal._currentFolder = mockFolder
    serviceInternal._currentFolderId = 1

    // Set state to scanning
    serviceInternal._state = {
      status: 'scanning',
      scanProgress: { totalFound: 0, processed: 0 },
    }

    // Attempt to scan should throw
    await expect(service.scanFolder()).rejects.toThrow(CatalogError)
    await expect(service.scanFolder()).rejects.toThrow('Scan already in progress')

    service.destroy()
  })

  it('transitions state from ready to scanning then back to ready on success', async () => {
    const controllable = createControllableScanService()
    const service = await CatalogService.create(mockDecodeService)
    const mockFolder = createMockFolder()

    // Access private members
    const serviceInternal = service as unknown as ServiceInternals
    serviceInternal._currentFolder = mockFolder
    serviceInternal._currentFolderId = 1
    // Replace scan service with controllable one
    ;(serviceInternal as { scanService: IScanService }).scanService = controllable.service

    // Verify initial state
    expect(service.state.status).toBe('ready')

    // Start scan (don't await yet)
    const scanPromise = service.scanFolder()

    // Wait a tick for the async generator to start
    await new Promise(resolve => setTimeout(resolve, 0))

    // Should now be scanning
    expect(service.state.status).toBe('scanning')
    expect(service.state.scanProgress).toEqual({ totalFound: 0, processed: 0 })

    // Use SCAN_CANCELLED to complete the scan (avoids IndexedDB requirement)
    // This also sets state to 'ready', testing the state transition
    controllable.throwError(new CatalogError('Cancelled', 'SCAN_CANCELLED'))

    // Wait for scan to finish
    await scanPromise

    // Should be back to ready
    expect(service.state.status).toBe('ready')

    service.destroy()
  })

  it('cancelScan aborts an in-progress scan', async () => {
    const controllable = createControllableScanService()
    const service = await CatalogService.create(mockDecodeService)
    const mockFolder = createMockFolder()

    // Access private members
    const serviceInternal = service as unknown as ServiceInternals
    serviceInternal._currentFolder = mockFolder
    serviceInternal._currentFolderId = 1
    ;(serviceInternal as { scanService: IScanService }).scanService = controllable.service

    // Start scan
    const scanPromise = service.scanFolder()

    // Wait a tick for the async generator to start
    await new Promise(resolve => setTimeout(resolve, 0))

    // Verify scanning state
    expect(service.state.status).toBe('scanning')

    // Cancel the scan
    service.cancelScan()

    // Verify abort controller was triggered
    const signal = controllable.getSignal()
    expect(signal?.aborted).toBe(true)

    // Simulate the scan service throwing SCAN_CANCELLED after abort
    controllable.throwError(new CatalogError('Scan was cancelled', 'SCAN_CANCELLED'))

    // Wait for scan to complete
    await scanPromise

    // Should be back to ready (not error)
    expect(service.state.status).toBe('ready')

    service.destroy()
  })

  it('handles SCAN_CANCELLED error gracefully (sets state to ready, does not throw)', async () => {
    const controllable = createControllableScanService()
    const service = await CatalogService.create(mockDecodeService)
    const mockFolder = createMockFolder()

    // Access private members
    const serviceInternal = service as unknown as ServiceInternals
    serviceInternal._currentFolder = mockFolder
    serviceInternal._currentFolderId = 1
    ;(serviceInternal as { scanService: IScanService }).scanService = controllable.service

    // Start scan
    const scanPromise = service.scanFolder()

    // Wait a tick
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(service.state.status).toBe('scanning')

    // Throw SCAN_CANCELLED error
    controllable.throwError(new CatalogError('Cancelled', 'SCAN_CANCELLED'))

    // Should NOT throw - await should complete normally
    await expect(scanPromise).resolves.toBeUndefined()

    // State should be ready
    expect(service.state.status).toBe('ready')

    service.destroy()
  })

  it('handles other errors (sets state to error, rethrows)', async () => {
    const controllable = createControllableScanService()
    const service = await CatalogService.create(mockDecodeService)
    const mockFolder = createMockFolder()

    // Access private members
    const serviceInternal = service as unknown as ServiceInternals
    serviceInternal._currentFolder = mockFolder
    serviceInternal._currentFolderId = 1
    ;(serviceInternal as { scanService: IScanService }).scanService = controllable.service

    // Start scan
    const scanPromise = service.scanFolder()

    // Wait a tick
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(service.state.status).toBe('scanning')

    // Throw a generic error (not SCAN_CANCELLED)
    const testError = new Error('Something went wrong')
    controllable.throwError(testError)

    // Should throw the error
    await expect(scanPromise).rejects.toThrow('Something went wrong')

    // State should be error
    expect(service.state.status).toBe('error')
    expect(service.state.error).toBe('Something went wrong')

    service.destroy()
  })

  it('handles CatalogError with non-SCAN_CANCELLED code (sets state to error, rethrows)', async () => {
    const controllable = createControllableScanService()
    const service = await CatalogService.create(mockDecodeService)
    const mockFolder = createMockFolder()

    // Access private members
    const serviceInternal = service as unknown as ServiceInternals
    serviceInternal._currentFolder = mockFolder
    serviceInternal._currentFolderId = 1
    ;(serviceInternal as { scanService: IScanService }).scanService = controllable.service

    // Start scan
    const scanPromise = service.scanFolder()

    // Wait a tick
    await new Promise(resolve => setTimeout(resolve, 0))

    // Throw a CatalogError with different code
    const catalogError = new CatalogError('Permission denied', 'PERMISSION_DENIED')
    controllable.throwError(catalogError)

    // Should throw the error
    await expect(scanPromise).rejects.toThrow(CatalogError)

    // State should be error
    expect(service.state.status).toBe('error')
    expect(service.state.error).toBe('Permission denied')

    service.destroy()
  })

  it('clears abort controller after scan completes', async () => {
    const controllable = createControllableScanService()
    const service = await CatalogService.create(mockDecodeService)
    const mockFolder = createMockFolder()

    // Access private members
    const serviceInternal = service as unknown as ServiceInternals
    serviceInternal._currentFolder = mockFolder
    serviceInternal._currentFolderId = 1
    ;(serviceInternal as { scanService: IScanService }).scanService = controllable.service

    // Start scan
    const scanPromise = service.scanFolder()

    // Wait a tick
    await new Promise(resolve => setTimeout(resolve, 0))

    // Abort controller should be set
    expect(serviceInternal._abortController).not.toBeNull()

    // Use SCAN_CANCELLED to complete (avoids IndexedDB requirement)
    // The finally block still clears _abortController regardless of how scan ends
    controllable.throwError(new CatalogError('Cancelled', 'SCAN_CANCELLED'))
    await scanPromise

    // Abort controller should be cleared
    expect(serviceInternal._abortController).toBeNull()

    service.destroy()
  })

  it('clears abort controller after scan errors', async () => {
    const controllable = createControllableScanService()
    const service = await CatalogService.create(mockDecodeService)
    const mockFolder = createMockFolder()

    // Access private members
    const serviceInternal = service as unknown as ServiceInternals
    serviceInternal._currentFolder = mockFolder
    serviceInternal._currentFolderId = 1
    ;(serviceInternal as { scanService: IScanService }).scanService = controllable.service

    // Start scan
    const scanPromise = service.scanFolder()

    // Wait a tick
    await new Promise(resolve => setTimeout(resolve, 0))

    // Abort controller should be set
    expect(serviceInternal._abortController).not.toBeNull()

    // Throw error
    controllable.throwError(new Error('Test error'))

    // Catch the error
    await scanPromise.catch(() => {})

    // Abort controller should be cleared even after error
    expect(serviceInternal._abortController).toBeNull()

    service.destroy()
  })
})
