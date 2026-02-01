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

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { CatalogService, createCatalogService } from './catalog-service'
import { PhotoProcessor } from './photo-processor'
import { ThumbnailPriority, CatalogError } from './types'
import type { Asset, IScanService, IThumbnailService, ScannedFile, ScanOptions } from './types'
import type { IDecodeService } from '../decode/decode-service'
import type { EditedThumbnailEditState } from '../decode/worker-messages'
import type { AssetRecord, FolderRecord } from './db'
import type { AssetsAddedCallback } from './types'
import { db } from './db'

// ============================================================================
// Mock db module for loadFromDatabase tests
// ============================================================================

vi.mock('./db', async () => {
  const actual = await vi.importActual('./db')
  return {
    ...actual,
    db: {
      folders: {
        toArray: vi.fn(),
        get: vi.fn(),
        update: vi.fn(),
        where: vi.fn().mockReturnThis(),
        equals: vi.fn().mockReturnThis(),
        first: vi.fn(),
        add: vi.fn(),
        orderBy: vi.fn().mockReturnThis(),
        reverse: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
      },
      assets: {
        where: vi.fn().mockReturnThis(),
        equals: vi.fn().mockReturnThis(),
        toArray: vi.fn(),
        first: vi.fn(),
        add: vi.fn(),
        update: vi.fn(),
        anyOf: vi.fn().mockReturnThis(),
        modify: vi.fn(),
      },
    },
  }
})

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
    ): AsyncGenerator<ScannedFile, void, unknown> {
      // Yields nothing by default
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
    cancelBackgroundRequests: vi.fn().mockReturnValue(0),
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
      cancelBackgroundRequests: vi.fn().mockReturnValue(0),
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
   * Create a mock PhotoProcessor for tests.
   */
  function createMockPhotoProcessor(): PhotoProcessor {
    return {
      enqueue: vi.fn().mockReturnValue(true),
      cancelAll: vi.fn(),
      queueSize: 0,
      activeProcessing: 0,
      has: vi.fn().mockReturnValue(false),
      onPhotoProcessed: null as any,
      onPhotoError: null as any,
    } as unknown as PhotoProcessor
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
    const mockPhotoProcessor = createMockPhotoProcessor()

    // Set up internal state via type casting to access private fields
    const privateService = service as unknown as {
      scanService: IScanService
      thumbnailService: IThumbnailService
      photoProcessor: PhotoProcessor
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
    privateService.photoProcessor = mockPhotoProcessor
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
// persistHandle Tests (using fake-indexeddb)
// ============================================================================

import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'

describe('persistHandle', () => {
  let mockDecodeService: IDecodeService

  // Type for accessing private methods
  type PersistHandleInternals = {
    persistHandle: (key: string, handle: FileSystemDirectoryHandle) => Promise<void>
  }

  /**
   * Create a serializable mock folder handle for testing.
   * Note: IndexedDB uses structuredClone which cannot serialize functions,
   * so we use a plain object with only serializable properties.
   */
  function createSerializableHandle(name: string = 'test-folder'): FileSystemDirectoryHandle {
    // Create an object that can be serialized by structuredClone
    // In real usage, FileSystemDirectoryHandle is stored by the browser and
    // is serializable. For testing, we just need basic properties.
    return {
      name,
      kind: 'directory' as const,
    } as unknown as FileSystemDirectoryHandle
  }

  /**
   * Delete the literoom-fs database used by persistHandle.
   */
  async function deleteLiteroomFsDatabase(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase('literoom-fs')
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      request.onblocked = () => resolve()
    })
  }

  /**
   * Read a handle from the literoom-fs database.
   */
  async function readHandleFromDb(key: string): Promise<FileSystemDirectoryHandle | null> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('literoom-fs', 1)

      request.onerror = () => reject(request.error)

      request.onsuccess = () => {
        const database = request.result
        try {
          const tx = database.transaction('handles', 'readonly')
          const store = tx.objectStore('handles')
          const getRequest = store.get(key)

          getRequest.onsuccess = () => {
            database.close()
            resolve(getRequest.result ?? null)
          }
          getRequest.onerror = () => {
            database.close()
            reject(getRequest.error)
          }
        } catch {
          database.close()
          resolve(null)
        }
      }

      request.onupgradeneeded = (event) => {
        const database = (event.target as IDBOpenDBRequest).result
        if (!database.objectStoreNames.contains('handles')) {
          database.createObjectStore('handles')
        }
      }
    })
  }

  beforeEach(async () => {
    mockDecodeService = createMockDecodeService()
    // Reset IndexedDB to a clean state
    globalThis.indexedDB = new IDBFactory()
    await deleteLiteroomFsDatabase()
  })

  afterEach(async () => {
    await deleteLiteroomFsDatabase()
    vi.clearAllMocks()
  })

  describe('successful handle persistence', () => {
    it('persists a handle with the given key', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals
      const mockHandle = createSerializableHandle('my-folder')
      const key = 'literoom-folder-my-folder-12345'

      await serviceInternal.persistHandle(key, mockHandle)

      const storedHandle = await readHandleFromDb(key)
      expect(storedHandle).toBeDefined()
      expect(storedHandle?.name).toBe('my-folder')

      service.destroy()
    })

    it('persists multiple handles with different keys', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals

      const handle1 = createSerializableHandle('folder-1')
      const handle2 = createSerializableHandle('folder-2')
      const key1 = 'literoom-folder-folder-1-111'
      const key2 = 'literoom-folder-folder-2-222'

      await serviceInternal.persistHandle(key1, handle1)
      await serviceInternal.persistHandle(key2, handle2)

      const storedHandle1 = await readHandleFromDb(key1)
      const storedHandle2 = await readHandleFromDb(key2)

      expect(storedHandle1?.name).toBe('folder-1')
      expect(storedHandle2?.name).toBe('folder-2')

      service.destroy()
    })

    it('overwrites an existing handle with the same key', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals

      const originalHandle = createSerializableHandle('original')
      const updatedHandle = createSerializableHandle('updated')
      const key = 'literoom-folder-test-key'

      // Persist original
      await serviceInternal.persistHandle(key, originalHandle)
      const originalStored = await readHandleFromDb(key)
      expect(originalStored?.name).toBe('original')

      // Overwrite with updated
      await serviceInternal.persistHandle(key, updatedHandle)
      const updatedStored = await readHandleFromDb(key)
      expect(updatedStored?.name).toBe('updated')

      service.destroy()
    })

    it('resolves the promise on success', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals
      const mockHandle = createSerializableHandle('test')

      // Should resolve without throwing
      await expect(
        serviceInternal.persistHandle('test-key', mockHandle)
      ).resolves.toBeUndefined()

      service.destroy()
    })
  })

  describe('object store creation on upgrade', () => {
    it('creates handles object store on first database open', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals
      const mockHandle = createSerializableHandle('test')

      // First call - should trigger onupgradeneeded and create the store
      await serviceInternal.persistHandle('first-key', mockHandle)

      // Verify the store was created and we can read back
      const stored = await readHandleFromDb('first-key')
      expect(stored).toBeDefined()

      service.destroy()
    })

    it('does not recreate object store if it already exists', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals

      const handle1 = createSerializableHandle('first')
      const handle2 = createSerializableHandle('second')

      // First persist - creates the store
      await serviceInternal.persistHandle('key-1', handle1)

      // Second persist - store should already exist
      await serviceInternal.persistHandle('key-2', handle2)

      // Both should be retrievable
      const stored1 = await readHandleFromDb('key-1')
      const stored2 = await readHandleFromDb('key-2')

      expect(stored1?.name).toBe('first')
      expect(stored2?.name).toBe('second')

      service.destroy()
    })
  })

  describe('database open error handling', () => {
    it('rejects promise when database open fails', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals
      const mockHandle = createSerializableHandle('test')

      // Create a custom indexedDB mock that always fails on open
      const mockIndexedDB = {
        open: vi.fn().mockImplementation(() => {
          const request = {
            error: new DOMException('Database open failed', 'UnknownError'),
            onerror: null as ((event: Event) => void) | null,
            onsuccess: null as ((event: Event) => void) | null,
            onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
          }
          // Trigger error callback asynchronously
          setTimeout(() => {
            if (request.onerror) {
              request.onerror(new Event('error'))
            }
          }, 0)
          return request
        }),
        deleteDatabase: vi.fn(),
      }

      // Save original
      const originalIndexedDB = globalThis.indexedDB

      // Replace with mock
      globalThis.indexedDB = mockIndexedDB as unknown as IDBFactory

      try {
        // Should reject with the error
        await expect(
          serviceInternal.persistHandle('test-key', mockHandle)
        ).rejects.toBeDefined()
      } finally {
        // Restore original
        globalThis.indexedDB = originalIndexedDB
        service.destroy()
      }
    })
  })

  describe('put operation error handling', () => {
    it('rejects promise when put operation fails', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals
      const mockHandle = createSerializableHandle('test')

      // Create a mock that succeeds on open but fails on put
      const mockStore = {
        put: vi.fn().mockImplementation(() => {
          const putRequest = {
            error: new DOMException('Put operation failed', 'DataError'),
            onsuccess: null as ((event: Event) => void) | null,
            onerror: null as ((event: Event) => void) | null,
          }
          // Trigger error callback asynchronously
          setTimeout(() => {
            if (putRequest.onerror) {
              putRequest.onerror(new Event('error'))
            }
          }, 0)
          return putRequest
        }),
      }

      const mockTransaction = {
        objectStore: vi.fn().mockReturnValue(mockStore),
      }

      const mockDatabase = {
        transaction: vi.fn().mockReturnValue(mockTransaction),
        objectStoreNames: {
          contains: vi.fn().mockReturnValue(true),
        },
        createObjectStore: vi.fn(),
      }

      const mockIndexedDB = {
        open: vi.fn().mockImplementation(() => {
          const request = {
            result: mockDatabase,
            error: null as DOMException | null,
            onerror: null as ((event: Event) => void) | null,
            onsuccess: null as ((event: Event) => void) | null,
            onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
          }
          // Trigger success callback asynchronously
          setTimeout(() => {
            if (request.onsuccess) {
              request.onsuccess(new Event('success'))
            }
          }, 0)
          return request
        }),
        deleteDatabase: vi.fn(),
      }

      // Save original
      const originalIndexedDB = globalThis.indexedDB

      // Replace with mock
      globalThis.indexedDB = mockIndexedDB as unknown as IDBFactory

      try {
        // Should reject with the put error
        await expect(
          serviceInternal.persistHandle('failing-key', mockHandle)
        ).rejects.toBeDefined()
      } finally {
        // Restore original
        globalThis.indexedDB = originalIndexedDB
        service.destroy()
      }
    })
  })

  describe('handle keys', () => {
    it('handles keys with special characters', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals
      const mockHandle = createSerializableHandle('special folder')

      const specialKey = 'literoom-folder-My Folder (2024)!@#$-12345'

      await serviceInternal.persistHandle(specialKey, mockHandle)

      const stored = await readHandleFromDb(specialKey)
      expect(stored?.name).toBe('special folder')

      service.destroy()
    })

    it('handles empty string key', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals
      const mockHandle = createSerializableHandle('test')

      await serviceInternal.persistHandle('', mockHandle)

      const stored = await readHandleFromDb('')
      expect(stored?.name).toBe('test')

      service.destroy()
    })

    it('handles very long keys', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const serviceInternal = service as unknown as PersistHandleInternals
      const mockHandle = createSerializableHandle('test')

      const longKey = 'literoom-folder-' + 'a'.repeat(1000) + '-12345'

      await serviceInternal.persistHandle(longKey, mockHandle)

      const stored = await readHandleFromDb(longKey)
      expect(stored?.name).toBe('test')

      service.destroy()
    })
  })
})

// ============================================================================
// loadFromDatabase Tests
// ============================================================================

describe('loadFromDatabase', () => {
  let mockDecodeService: IDecodeService

  // Type for accessing private members
  type LoadFromDbInternals = {
    _currentFolder: FileSystemDirectoryHandle | null
    _currentFolderId: number | null
    _assets: Map<string, Asset>
    _onAssetsAdded: AssetsAddedCallback | null
    loadHandle: (key: string) => Promise<FileSystemDirectoryHandle | null>
  }

  /**
   * Create a mock folder handle for testing.
   */
  function createMockFolderHandle(
    permission: PermissionState = 'granted'
  ): FileSystemDirectoryHandle {
    return {
      name: 'test-folder',
      kind: 'directory',
      queryPermission: vi.fn().mockResolvedValue(permission),
      requestPermission: vi.fn().mockResolvedValue(permission),
      getFileHandle: vi.fn(),
      getDirectoryHandle: vi.fn(),
      isSameEntry: vi.fn(),
      resolve: vi.fn(),
      keys: vi.fn(),
      values: vi.fn(),
      entries: vi.fn(),
      [Symbol.asyncIterator]: vi.fn(),
    } as unknown as FileSystemDirectoryHandle
  }

  /**
   * Create a mock folder record for testing.
   */
  function createMockFolderRecord(overrides: Partial<FolderRecord> = {}): FolderRecord {
    return {
      id: 1,
      path: '/test/folder',
      name: 'test-folder',
      handleKey: 'literoom-folder-test',
      lastScanDate: new Date(),
      ...overrides,
    }
  }

  /**
   * Create a mock asset record for testing.
   */
  function createMockAssetRecordForDb(overrides: Partial<AssetRecord> = {}): AssetRecord {
    return {
      id: 1,
      uuid: 'test-asset-uuid-1',
      folderId: 1,
      path: 'photos/test.jpg',
      filename: 'test',
      extension: 'jpg',
      flag: 'none',
      captureDate: new Date('2024-01-15'),
      modifiedDate: new Date('2024-01-16'),
      fileSize: 1024000,
      width: 4000,
      height: 3000,
      ...overrides,
    }
  }

  beforeEach(() => {
    mockDecodeService = createMockDecodeService()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('returns false when no folders in database', async () => {
    // Mock db.folders.toArray to return empty array
    vi.mocked(db.folders.toArray).mockResolvedValue([])

    const service = await CatalogService.create(mockDecodeService)

    const result = await service.loadFromDatabase()

    expect(result).toBe(false)
    expect(db.folders.toArray).toHaveBeenCalledTimes(1)

    service.destroy()
  })

  it('returns false when handle not found', async () => {
    const mockFolder = createMockFolderRecord()
    vi.mocked(db.folders.toArray).mockResolvedValue([mockFolder])

    const service = await CatalogService.create(mockDecodeService)

    // Mock loadHandle to return null (handle not found)
    const serviceInternal = service as unknown as LoadFromDbInternals
    serviceInternal.loadHandle = vi.fn().mockResolvedValue(null)

    const result = await service.loadFromDatabase()

    expect(result).toBe(false)
    expect(serviceInternal.loadHandle).toHaveBeenCalledWith(mockFolder.handleKey)

    service.destroy()
  })

  it('returns false when permission not granted (prompt)', async () => {
    const mockFolder = createMockFolderRecord()
    const mockHandle = createMockFolderHandle('prompt') // Not 'granted'
    vi.mocked(db.folders.toArray).mockResolvedValue([mockFolder])

    const service = await CatalogService.create(mockDecodeService)

    // Mock loadHandle to return a handle
    const serviceInternal = service as unknown as LoadFromDbInternals
    serviceInternal.loadHandle = vi.fn().mockResolvedValue(mockHandle)

    const result = await service.loadFromDatabase()

    expect(result).toBe(false)
    expect(mockHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' })

    service.destroy()
  })

  it('returns false when permission is denied', async () => {
    const mockFolder = createMockFolderRecord()
    const mockHandle = createMockFolderHandle('denied')
    vi.mocked(db.folders.toArray).mockResolvedValue([mockFolder])

    const service = await CatalogService.create(mockDecodeService)

    // Mock loadHandle to return a handle
    const serviceInternal = service as unknown as LoadFromDbInternals
    serviceInternal.loadHandle = vi.fn().mockResolvedValue(mockHandle)

    const result = await service.loadFromDatabase()

    expect(result).toBe(false)
    expect(mockHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' })

    service.destroy()
  })

  it('succeeds with no assets (returns true, does not call onAssetsAdded)', async () => {
    const mockFolder = createMockFolderRecord({ id: 42 })
    const mockHandle = createMockFolderHandle('granted')
    vi.mocked(db.folders.toArray).mockResolvedValue([mockFolder])

    // Mock the chained query to return empty array
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })
    vi.mocked(db.assets.where).mockImplementation(mockWhere)

    const service = await CatalogService.create(mockDecodeService)

    // Mock loadHandle to return a handle
    const serviceInternal = service as unknown as LoadFromDbInternals
    serviceInternal.loadHandle = vi.fn().mockResolvedValue(mockHandle)

    // Set up callback to verify it's NOT called
    const onAssetsAdded = vi.fn()
    service.onAssetsAdded = onAssetsAdded

    const result = await service.loadFromDatabase()

    expect(result).toBe(true)
    expect(onAssetsAdded).not.toHaveBeenCalled()
    expect(service.getAssets()).toEqual([])

    service.destroy()
  })

  it('succeeds with assets (returns true, calls onAssetsAdded)', async () => {
    const mockFolder = createMockFolderRecord({ id: 42 })
    const mockHandle = createMockFolderHandle('granted')
    const mockAssetRecords = [
      createMockAssetRecordForDb({ uuid: 'asset-1', folderId: 42 }),
      createMockAssetRecordForDb({ uuid: 'asset-2', folderId: 42, filename: 'photo2' }),
    ]
    vi.mocked(db.folders.toArray).mockResolvedValue([mockFolder])

    // Mock the chained query to return assets
    const mockToArray = vi.fn().mockResolvedValue(mockAssetRecords)
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })
    vi.mocked(db.assets.where).mockImplementation(mockWhere)

    const service = await CatalogService.create(mockDecodeService)

    // Mock loadHandle to return a handle
    const serviceInternal = service as unknown as LoadFromDbInternals
    serviceInternal.loadHandle = vi.fn().mockResolvedValue(mockHandle)

    // Set up callback to verify it IS called
    const onAssetsAdded = vi.fn()
    service.onAssetsAdded = onAssetsAdded

    const result = await service.loadFromDatabase()

    expect(result).toBe(true)
    expect(onAssetsAdded).toHaveBeenCalledTimes(1)
    expect(onAssetsAdded).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'asset-1' }),
        expect.objectContaining({ id: 'asset-2' }),
      ])
    )

    // Verify assets are accessible
    const assets = service.getAssets()
    expect(assets).toHaveLength(2)

    service.destroy()
  })

  it('sets _currentFolder and _currentFolderId correctly', async () => {
    const mockFolder = createMockFolderRecord({ id: 99, name: 'my-photos' })
    const mockHandle = createMockFolderHandle('granted')
    vi.mocked(db.folders.toArray).mockResolvedValue([mockFolder])

    // Mock the chained query to return empty array
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })
    vi.mocked(db.assets.where).mockImplementation(mockWhere)

    const service = await CatalogService.create(mockDecodeService)

    // Mock loadHandle to return a handle
    const serviceInternal = service as unknown as LoadFromDbInternals
    serviceInternal.loadHandle = vi.fn().mockResolvedValue(mockHandle)

    const result = await service.loadFromDatabase()

    expect(result).toBe(true)

    // Verify internal state was set correctly
    expect(serviceInternal._currentFolder).toBe(mockHandle)
    expect(serviceInternal._currentFolderId).toBe(99)

    // Verify getCurrentFolder returns the handle
    expect(service.getCurrentFolder()).toBe(mockHandle)

    service.destroy()
  })

  it('loads assets from correct folder using folderId', async () => {
    const mockFolder = createMockFolderRecord({ id: 123 })
    const mockHandle = createMockFolderHandle('granted')
    vi.mocked(db.folders.toArray).mockResolvedValue([mockFolder])

    // Track the calls to verify correct folderId is used
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })
    vi.mocked(db.assets.where).mockImplementation(mockWhere)

    const service = await CatalogService.create(mockDecodeService)

    // Mock loadHandle to return a handle
    const serviceInternal = service as unknown as LoadFromDbInternals
    serviceInternal.loadHandle = vi.fn().mockResolvedValue(mockHandle)

    await service.loadFromDatabase()

    // Verify the query was made with the correct folderId
    expect(mockWhere).toHaveBeenCalledWith('folderId')
    expect(mockEquals).toHaveBeenCalledWith(123)

    service.destroy()
  })

  it('correctly converts asset records to assets', async () => {
    const mockFolder = createMockFolderRecord({ id: 1 })
    const mockHandle = createMockFolderHandle('granted')
    const captureDate = new Date('2024-03-15T10:30:00Z')
    const modifiedDate = new Date('2024-03-16T14:00:00Z')
    const mockAssetRecord = createMockAssetRecordForDb({
      uuid: 'converted-asset',
      folderId: 1,
      path: 'vacation/beach.arw',
      filename: 'beach',
      extension: 'arw',
      flag: 'pick',
      captureDate,
      modifiedDate,
      fileSize: 25000000,
      width: 6000,
      height: 4000,
    })
    vi.mocked(db.folders.toArray).mockResolvedValue([mockFolder])

    // Mock the chained query to return the asset
    const mockToArray = vi.fn().mockResolvedValue([mockAssetRecord])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })
    vi.mocked(db.assets.where).mockImplementation(mockWhere)

    const service = await CatalogService.create(mockDecodeService)

    // Mock loadHandle to return a handle
    const serviceInternal = service as unknown as LoadFromDbInternals
    serviceInternal.loadHandle = vi.fn().mockResolvedValue(mockHandle)

    await service.loadFromDatabase()

    // Verify the asset was converted correctly
    const asset = service.getAsset('converted-asset')
    expect(asset).toBeDefined()
    expect(asset!.id).toBe('converted-asset')
    expect(asset!.folderId).toBe('1')
    expect(asset!.path).toBe('vacation/beach.arw')
    expect(asset!.filename).toBe('beach')
    expect(asset!.extension).toBe('arw')
    expect(asset!.flag).toBe('pick')
    expect(asset!.captureDate).toEqual(captureDate)
    expect(asset!.modifiedDate).toEqual(modifiedDate)
    expect(asset!.fileSize).toBe(25000000)
    expect(asset!.width).toBe(6000)
    expect(asset!.height).toBe(4000)
    expect(asset!.thumbnailStatus).toBe('pending')
    expect(asset!.thumbnailUrl).toBeNull()

    service.destroy()
  })

  it('uses first folder when multiple folders exist', async () => {
    const firstFolder = createMockFolderRecord({ id: 1, name: 'first-folder', handleKey: 'key-1' })
    const secondFolder = createMockFolderRecord({ id: 2, name: 'second-folder', handleKey: 'key-2' })
    const mockHandle = createMockFolderHandle('granted')
    vi.mocked(db.folders.toArray).mockResolvedValue([firstFolder, secondFolder])

    // Mock the chained query to return empty array
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })
    vi.mocked(db.assets.where).mockImplementation(mockWhere)

    const service = await CatalogService.create(mockDecodeService)

    // Mock loadHandle to return a handle and track calls
    const loadHandleMock = vi.fn().mockResolvedValue(mockHandle)
    const serviceInternal = service as unknown as LoadFromDbInternals
    serviceInternal.loadHandle = loadHandleMock

    await service.loadFromDatabase()

    // Verify loadHandle was called with first folder's key
    expect(loadHandleMock).toHaveBeenCalledWith('key-1')
    expect(loadHandleMock).not.toHaveBeenCalledWith('key-2')

    // Verify currentFolderId is set to first folder
    expect(serviceInternal._currentFolderId).toBe(1)

    service.destroy()
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
   * Returns an object with the service and controls for yielding files or throwing errors.
   */
  function createControllableScanService(): {
    service: IScanService
    yieldFile: (file: ScannedFile) => void
    yieldFiles: (files: ScannedFile[]) => void
    complete: () => void
    throwError: (error: Error) => void
    getSignal: () => AbortSignal | undefined
  } {
    let resolveNext: ((value: IteratorResult<ScannedFile, void>) => void) | null = null
    let rejectNext: ((error: Error) => void) | null = null
    let capturedSignal: AbortSignal | undefined
    const pendingFiles: ScannedFile[] = []
    let isComplete = false

    const service: IScanService = {
      scan: vi.fn(async function* (
        _directory: FileSystemDirectoryHandle,
        options?: ScanOptions
      ): AsyncGenerator<ScannedFile, void, unknown> {
        capturedSignal = options?.signal

        // Yield files as they are provided via yieldFile()
        while (true) {
          // First check for any pending files
          if (pendingFiles.length > 0) {
            yield pendingFiles.shift()!
            continue
          }

          if (isComplete) {
            return
          }

          const result = await new Promise<IteratorResult<ScannedFile, void>>(
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
      yieldFile: (file: ScannedFile) => {
        if (resolveNext) {
          const resolve = resolveNext
          resolveNext = null
          rejectNext = null
          resolve({ value: file, done: false })
        } else {
          pendingFiles.push(file)
        }
      },
      yieldFiles: (files: ScannedFile[]) => {
        for (const file of files) {
          if (resolveNext) {
            const resolve = resolveNext
            resolveNext = null
            rejectNext = null
            resolve({ value: file, done: false })
          } else {
            pendingFiles.push(file)
          }
        }
      },
      complete: () => {
        isComplete = true
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

// ============================================================================
// createGetBytesFunction Tests
// ============================================================================

describe('createGetBytesFunction', () => {
  let mockDecodeService: IDecodeService
  let service: CatalogService

  // Type for accessing private members
  type ServiceInternals = {
    _currentFolder: FileSystemDirectoryHandle | null
    createGetBytesFunction: (asset: Asset) => () => Promise<Uint8Array>
  }

  /**
   * Create a test asset with the given properties.
   */
  function createTestAsset(overrides: Partial<Asset> = {}): Asset {
    return {
      id: 'test-asset-1',
      folderId: '1',
      path: 'test.jpg',
      filename: 'test',
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
   * Create a mock File object.
   */
  function createMockFile(content: Uint8Array): File {
    return {
      arrayBuffer: vi.fn().mockResolvedValue(content.buffer),
    } as unknown as File
  }

  /**
   * Create a mock FileSystemFileHandle.
   */
  function createMockFileHandle(file: File): FileSystemFileHandle {
    return {
      kind: 'file',
      name: 'test.jpg',
      getFile: vi.fn().mockResolvedValue(file),
    } as unknown as FileSystemFileHandle
  }

  /**
   * Create a mock FileSystemDirectoryHandle with configurable subdirectories and files.
   */
  function createMockDirectoryHandle(
    name: string,
    children: {
      directories?: Record<string, FileSystemDirectoryHandle>
      files?: Record<string, FileSystemFileHandle>
    } = {}
  ): FileSystemDirectoryHandle {
    const { directories = {}, files = {} } = children

    return {
      kind: 'directory',
      name,
      getDirectoryHandle: vi.fn((childName: string) => {
        if (directories[childName]) {
          return Promise.resolve(directories[childName])
        }
        return Promise.reject(new DOMException('Directory not found', 'NotFoundError'))
      }),
      getFileHandle: vi.fn((childName: string) => {
        if (files[childName]) {
          return Promise.resolve(files[childName])
        }
        return Promise.reject(new DOMException('File not found', 'NotFoundError'))
      }),
    } as unknown as FileSystemDirectoryHandle
  }

  beforeEach(async () => {
    mockDecodeService = createMockDecodeService()
    service = await CatalogService.create(mockDecodeService)
  })

  afterEach(() => {
    service.destroy()
    vi.clearAllMocks()
  })

  it('throws CatalogError when no folder is selected', async () => {
    const serviceInternal = service as unknown as ServiceInternals

    // Ensure no folder is selected
    serviceInternal._currentFolder = null

    const asset = createTestAsset({ path: 'test.jpg' })
    const getBytes = serviceInternal.createGetBytesFunction(asset)

    // Call the returned function - should throw
    await expect(getBytes()).rejects.toThrow(CatalogError)
    await expect(getBytes()).rejects.toThrow('No folder selected')

    try {
      await getBytes()
    } catch (error) {
      expect(error).toBeInstanceOf(CatalogError)
      expect((error as CatalogError).code).toBe('FOLDER_NOT_FOUND')
    }
  })

  it('successfully reads file at root level', async () => {
    const serviceInternal = service as unknown as ServiceInternals

    // Set up file content
    const fileContent = new Uint8Array([0x89, 0x50, 0x4e, 0x47]) // PNG magic bytes
    const mockFile = createMockFile(fileContent)
    const mockFileHandle = createMockFileHandle(mockFile)

    // Create root folder with file directly in it
    const mockFolder = createMockDirectoryHandle('root', {
      files: { 'photo.jpg': mockFileHandle },
    })

    serviceInternal._currentFolder = mockFolder

    // Asset at root level (path is just the filename)
    const asset = createTestAsset({
      path: 'photo.jpg',
      filename: 'photo',
      extension: 'jpg',
    })

    const getBytes = serviceInternal.createGetBytesFunction(asset)
    const result = await getBytes()

    // Verify the correct file was accessed
    expect(mockFolder.getFileHandle).toHaveBeenCalledWith('photo.jpg')
    expect(mockFileHandle.getFile).toHaveBeenCalled()
    expect(mockFile.arrayBuffer).toHaveBeenCalled()

    // Verify result
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result).toEqual(fileContent)
  })

  it('successfully reads file in nested subdirectory', async () => {
    const serviceInternal = service as unknown as ServiceInternals

    // Set up file content
    const fileContent = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) // JPEG magic bytes
    const mockFile = createMockFile(fileContent)
    const mockFileHandle = createMockFileHandle(mockFile)

    // Create nested folder structure: root/photos/image.arw
    const photosFolder = createMockDirectoryHandle('photos', {
      files: { 'image.arw': mockFileHandle },
    })

    const rootFolder = createMockDirectoryHandle('root', {
      directories: { photos: photosFolder },
    })

    serviceInternal._currentFolder = rootFolder

    // Asset in nested subdirectory
    const asset = createTestAsset({
      path: 'photos/image.arw',
      filename: 'image',
      extension: 'arw',
    })

    const getBytes = serviceInternal.createGetBytesFunction(asset)
    const result = await getBytes()

    // Verify navigation
    expect(rootFolder.getDirectoryHandle).toHaveBeenCalledWith('photos')
    expect(photosFolder.getFileHandle).toHaveBeenCalledWith('image.arw')
    expect(mockFileHandle.getFile).toHaveBeenCalled()

    // Verify result
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result).toEqual(fileContent)
  })

  it('handles path with multiple levels of nesting', async () => {
    const serviceInternal = service as unknown as ServiceInternals

    // Set up file content
    const fileContent = new Uint8Array([0x49, 0x49, 0x2a, 0x00]) // TIFF magic bytes (little-endian)
    const mockFile = createMockFile(fileContent)
    const mockFileHandle = createMockFileHandle(mockFile)

    // Create deeply nested folder structure: root/2024/vacation/hawaii/sunset.cr2
    const hawaiiFolder = createMockDirectoryHandle('hawaii', {
      files: { 'sunset.cr2': mockFileHandle },
    })

    const vacationFolder = createMockDirectoryHandle('vacation', {
      directories: { hawaii: hawaiiFolder },
    })

    const yearFolder = createMockDirectoryHandle('2024', {
      directories: { vacation: vacationFolder },
    })

    const rootFolder = createMockDirectoryHandle('root', {
      directories: { '2024': yearFolder },
    })

    serviceInternal._currentFolder = rootFolder

    // Asset in deeply nested subdirectory
    const asset = createTestAsset({
      path: '2024/vacation/hawaii/sunset.cr2',
      filename: 'sunset',
      extension: 'cr2',
    })

    const getBytes = serviceInternal.createGetBytesFunction(asset)
    const result = await getBytes()

    // Verify navigation through all directories
    expect(rootFolder.getDirectoryHandle).toHaveBeenCalledWith('2024')
    expect(yearFolder.getDirectoryHandle).toHaveBeenCalledWith('vacation')
    expect(vacationFolder.getDirectoryHandle).toHaveBeenCalledWith('hawaii')
    expect(hawaiiFolder.getFileHandle).toHaveBeenCalledWith('sunset.cr2')
    expect(mockFileHandle.getFile).toHaveBeenCalled()

    // Verify result
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result).toEqual(fileContent)
  })

  it('returns correct Uint8Array from file', async () => {
    const serviceInternal = service as unknown as ServiceInternals

    // Create larger file content with various byte values
    const fileContent = new Uint8Array(256)
    for (let i = 0; i < 256; i++) {
      fileContent[i] = i
    }

    const mockFile = createMockFile(fileContent)
    const mockFileHandle = createMockFileHandle(mockFile)

    const mockFolder = createMockDirectoryHandle('root', {
      files: { 'data.bin': mockFileHandle },
    })

    serviceInternal._currentFolder = mockFolder

    const asset = createTestAsset({
      path: 'data.bin',
      filename: 'data',
      extension: 'bin',
    })

    const getBytes = serviceInternal.createGetBytesFunction(asset)
    const result = await getBytes()

    // Verify result is correct type and content
    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBe(256)
    expect(result[0]).toBe(0)
    expect(result[127]).toBe(127)
    expect(result[255]).toBe(255)
    expect(Array.from(result)).toEqual(Array.from(fileContent))
  })

  it('captures folder handle at creation time', async () => {
    const serviceInternal = service as unknown as ServiceInternals

    // Set up first folder with its file
    const fileContent1 = new Uint8Array([1, 2, 3])
    const mockFile1 = createMockFile(fileContent1)
    const mockFileHandle1 = createMockFileHandle(mockFile1)

    const folder1 = createMockDirectoryHandle('folder1', {
      files: { 'test.jpg': mockFileHandle1 },
    })

    serviceInternal._currentFolder = folder1

    const asset = createTestAsset({
      path: 'test.jpg',
      filename: 'test',
      extension: 'jpg',
    })

    // Create the function while folder1 is set
    const getBytes = serviceInternal.createGetBytesFunction(asset)

    // Now change the folder
    const fileContent2 = new Uint8Array([4, 5, 6])
    const mockFile2 = createMockFile(fileContent2)
    const mockFileHandle2 = createMockFileHandle(mockFile2)

    const folder2 = createMockDirectoryHandle('folder2', {
      files: { 'test.jpg': mockFileHandle2 },
    })

    serviceInternal._currentFolder = folder2

    // Call getBytes - it should use the captured folder1, not current folder2
    const result = await getBytes()

    // Verify it used folder1 (the captured one)
    expect(folder1.getFileHandle).toHaveBeenCalledWith('test.jpg')
    expect(folder2.getFileHandle).not.toHaveBeenCalled()
    expect(result).toEqual(fileContent1)
  })

  it('throws error when captured folder becomes null', async () => {
    const serviceInternal = service as unknown as ServiceInternals

    // Set folder to null initially
    serviceInternal._currentFolder = null

    const asset = createTestAsset({ path: 'test.jpg' })

    // Create getBytes while folder is null
    const getBytes = serviceInternal.createGetBytesFunction(asset)

    // Set a folder after creation
    const fileContent = new Uint8Array([1, 2, 3])
    const mockFile = createMockFile(fileContent)
    const mockFileHandle = createMockFileHandle(mockFile)

    const newFolder = createMockDirectoryHandle('newFolder', {
      files: { 'test.jpg': mockFileHandle },
    })

    serviceInternal._currentFolder = newFolder

    // The getBytes function captured null, so it should still throw
    await expect(getBytes()).rejects.toThrow(CatalogError)
    await expect(getBytes()).rejects.toThrow('No folder selected')
  })
})

// ============================================================================
// listFolders Tests
// ============================================================================

describe('listFolders', () => {
  let mockDecodeService: IDecodeService

  // Type for accessing private members
  type ServiceInternals = {
    loadHandle: (key: string) => Promise<FileSystemDirectoryHandle | null>
  }

  // Mock folder record factory
  function createMockFolderRecord(
    overrides: Partial<{
      id: number
      name: string
      path: string
      handleKey: string
      lastScanDate: Date
    }> = {}
  ): { id: number; name: string; path: string; handleKey: string; lastScanDate: Date } {
    return {
      id: 1,
      name: 'Test Folder',
      path: '/Users/test/photos',
      handleKey: 'literoom-folder-test',
      lastScanDate: new Date('2024-06-15T10:00:00Z'),
      ...overrides,
    }
  }

  // Mock handle factory
  function createMockHandle(
    permissionState: 'granted' | 'denied' | 'prompt' = 'granted'
  ): FileSystemDirectoryHandle {
    return {
      name: 'test-folder',
      kind: 'directory',
      queryPermission: vi.fn().mockResolvedValue(permissionState),
      requestPermission: vi.fn().mockResolvedValue(permissionState),
    } as unknown as FileSystemDirectoryHandle
  }

  beforeEach(() => {
    mockDecodeService = createMockDecodeService()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('returns empty array when no folders in database', async () => {
    const service = await CatalogService.create(mockDecodeService)

    // Mock the db.folders query chain
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    const folders = await service.listFolders()

    expect(folders).toEqual([])
    expect(mockOrderBy).toHaveBeenCalledWith('lastScanDate')
    expect(mockReverse).toHaveBeenCalled()
    expect(mockLimit).toHaveBeenCalledWith(5)

    service.destroy()
  })

  it('uses default limit of 5', async () => {
    const service = await CatalogService.create(mockDecodeService)

    const mockToArray = vi.fn().mockResolvedValue([])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    await service.listFolders()

    expect(mockLimit).toHaveBeenCalledWith(5)

    service.destroy()
  })

  it('respects custom limit parameter', async () => {
    const service = await CatalogService.create(mockDecodeService)

    const mockToArray = vi.fn().mockResolvedValue([])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    await service.listFolders(10)

    expect(mockLimit).toHaveBeenCalledWith(10)

    service.destroy()
  })

  it('returns folders with isAccessible true when permission is granted', async () => {
    const service = await CatalogService.create(mockDecodeService)

    const folder1 = createMockFolderRecord({
      id: 1,
      name: 'Photos 2024',
      path: '/Users/test/photos2024',
      handleKey: 'literoom-folder-1',
    })
    const folder2 = createMockFolderRecord({
      id: 2,
      name: 'Photos 2023',
      path: '/Users/test/photos2023',
      handleKey: 'literoom-folder-2',
    })

    const mockToArray = vi.fn().mockResolvedValue([folder1, folder2])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    // Mock loadHandle to return a handle with granted permission
    const mockHandle = createMockHandle('granted')
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    const folders = await service.listFolders()

    expect(folders).toHaveLength(2)
    expect(folders[0]).toEqual({
      id: 1,
      name: 'Photos 2024',
      path: '/Users/test/photos2024',
      lastScanDate: folder1.lastScanDate,
      isAccessible: true,
    })
    expect(folders[1]).toEqual({
      id: 2,
      name: 'Photos 2023',
      path: '/Users/test/photos2023',
      lastScanDate: folder2.lastScanDate,
      isAccessible: true,
    })

    service.destroy()
  })

  it('returns folders with mixed accessibility', async () => {
    const service = await CatalogService.create(mockDecodeService)

    const folder1 = createMockFolderRecord({
      id: 1,
      name: 'Accessible Folder',
      path: '/Users/test/accessible',
      handleKey: 'literoom-folder-1',
    })
    const folder2 = createMockFolderRecord({
      id: 2,
      name: 'Inaccessible Folder',
      path: '/Users/test/inaccessible',
      handleKey: 'literoom-folder-2',
    })
    const folder3 = createMockFolderRecord({
      id: 3,
      name: 'Prompt Folder',
      path: '/Users/test/prompt',
      handleKey: 'literoom-folder-3',
    })

    const mockToArray = vi.fn().mockResolvedValue([folder1, folder2, folder3])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    // Mock loadHandle to return different handles with different permissions
    const serviceInternal = service as unknown as ServiceInternals
    const loadHandleSpy = vi.spyOn(
      serviceInternal,
      'loadHandle'
    ) as ReturnType<typeof vi.spyOn>

    ;(loadHandleSpy as ReturnType<typeof vi.fn>).mockImplementation(async (key: string) => {
      if (key === 'literoom-folder-1') {
        return createMockHandle('granted')
      } else if (key === 'literoom-folder-2') {
        return createMockHandle('denied')
      } else {
        return createMockHandle('prompt')
      }
    })

    const folders = await service.listFolders()

    expect(folders).toHaveLength(3)
    expect(folders[0].isAccessible).toBe(true)
    expect(folders[1].isAccessible).toBe(false)
    expect(folders[2].isAccessible).toBe(false)

    service.destroy()
  })

  it('marks folder as inaccessible when loadHandle returns null', async () => {
    const service = await CatalogService.create(mockDecodeService)

    const folder1 = createMockFolderRecord({
      id: 1,
      name: 'Folder with missing handle',
      path: '/Users/test/missing',
      handleKey: 'literoom-folder-missing',
    })

    const mockToArray = vi.fn().mockResolvedValue([folder1])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    // Mock loadHandle to return null
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(null)

    const folders = await service.listFolders()

    expect(folders).toHaveLength(1)
    expect(folders[0].isAccessible).toBe(false)

    service.destroy()
  })

  it('marks folder as inaccessible when loadHandle throws error', async () => {
    const service = await CatalogService.create(mockDecodeService)

    const folder1 = createMockFolderRecord({
      id: 1,
      name: 'Folder with error',
      path: '/Users/test/error',
      handleKey: 'literoom-folder-error',
    })

    const mockToArray = vi.fn().mockResolvedValue([folder1])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    // Mock loadHandle to throw an error
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockRejectedValue(
      new Error('IndexedDB error')
    )

    const folders = await service.listFolders()

    expect(folders).toHaveLength(1)
    expect(folders[0].isAccessible).toBe(false)

    service.destroy()
  })

  it('marks folder as inaccessible when queryPermission throws error', async () => {
    const service = await CatalogService.create(mockDecodeService)

    const folder1 = createMockFolderRecord({
      id: 1,
      name: 'Folder with permission error',
      path: '/Users/test/permission-error',
      handleKey: 'literoom-folder-perm',
    })

    const mockToArray = vi.fn().mockResolvedValue([folder1])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    // Mock loadHandle to return a handle where queryPermission throws
    const mockHandle = {
      name: 'test-folder',
      kind: 'directory',
      queryPermission: vi.fn().mockRejectedValue(new DOMException('Permission check failed')),
    } as unknown as FileSystemDirectoryHandle

    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    const folders = await service.listFolders()

    expect(folders).toHaveLength(1)
    expect(folders[0].isAccessible).toBe(false)

    service.destroy()
  })

  it('correctly maps all folder properties to FolderInfo', async () => {
    const service = await CatalogService.create(mockDecodeService)

    const scanDate = new Date('2024-06-20T15:30:00Z')
    const folder = createMockFolderRecord({
      id: 42,
      name: 'Vacation Photos',
      path: '/Volumes/External/vacation',
      handleKey: 'literoom-folder-vacation',
      lastScanDate: scanDate,
    })

    const mockToArray = vi.fn().mockResolvedValue([folder])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    const mockHandle = createMockHandle('granted')
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    const folders = await service.listFolders()

    expect(folders).toHaveLength(1)
    const folderInfo = folders[0]
    expect(folderInfo.id).toBe(42)
    expect(folderInfo.name).toBe('Vacation Photos')
    expect(folderInfo.path).toBe('/Volumes/External/vacation')
    expect(folderInfo.lastScanDate).toBe(scanDate)
    expect(folderInfo.isAccessible).toBe(true)

    service.destroy()
  })

  it('handles limit of 1 correctly', async () => {
    const service = await CatalogService.create(mockDecodeService)

    const folder = createMockFolderRecord({ id: 1, name: 'Single Folder' })

    const mockToArray = vi.fn().mockResolvedValue([folder])
    const mockLimit = vi.fn().mockReturnValue({ toArray: mockToArray })
    const mockReverse = vi.fn().mockReturnValue({ limit: mockLimit })
    const mockOrderBy = vi.fn().mockReturnValue({ reverse: mockReverse })

    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'orderBy').mockImplementation(mockOrderBy)

    const mockHandle = createMockHandle('granted')
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    const folders = await service.listFolders(1)

    expect(mockLimit).toHaveBeenCalledWith(1)
    expect(folders).toHaveLength(1)

    service.destroy()
  })
})

// ============================================================================
// setCurrentFolder Tests
// ============================================================================

describe('setCurrentFolder', () => {
  let mockDecodeService: IDecodeService

  // Type for accessing private members
  type SetCurrentFolderInternals = {
    _currentFolder: FileSystemDirectoryHandle | null
    _currentFolderId: number | null
    setCurrentFolder: (handle: FileSystemDirectoryHandle) => Promise<void>
    persistHandle: (key: string, handle: FileSystemDirectoryHandle) => Promise<void>
  }

  /**
   * Create a mock folder handle for testing.
   */
  function createMockFolderHandle(name = 'test-folder'): FileSystemDirectoryHandle {
    return {
      name,
      kind: 'directory',
      getFileHandle: vi.fn(),
      getDirectoryHandle: vi.fn(),
      isSameEntry: vi.fn(),
      queryPermission: vi.fn().mockResolvedValue('granted'),
      requestPermission: vi.fn().mockResolvedValue('granted'),
      resolve: vi.fn(),
      keys: vi.fn(),
      values: vi.fn(),
      entries: vi.fn(),
      [Symbol.asyncIterator]: vi.fn(),
    } as unknown as FileSystemDirectoryHandle
  }

  beforeEach(() => {
    mockDecodeService = createMockDecodeService()
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('creates new folder record when folder does not exist in database', async () => {
    const service = await CatalogService.create(mockDecodeService)
    const serviceInternal = service as unknown as SetCurrentFolderInternals
    const mockHandle = createMockFolderHandle('new-folder')

    // Mock db.folders.where().equals().first() to return undefined (no existing folder)
    const mockFirst = vi.fn().mockResolvedValue(undefined)
    const mockEquals = vi.fn().mockReturnValue({ first: mockFirst })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })

    // Mock db.folders.add() to return a new folder ID
    const mockAdd = vi.fn().mockResolvedValue(42)

    // Mock db.folders.get() to return the newly created folder
    const mockGet = vi.fn().mockResolvedValue({
      id: 42,
      path: 'new-folder',
      name: 'new-folder',
      handleKey: 'literoom-folder-new-folder-12345',
      lastScanDate: new Date(),
    })

    // Mock persistHandle to track calls
    const mockPersistHandle = vi.fn().mockResolvedValue(undefined)
    serviceInternal.persistHandle = mockPersistHandle

    // Apply mocks to db.folders
    const { db: actualDb } = await import('./db')
    const originalWhere = actualDb.folders.where
    const originalAdd = actualDb.folders.add
    const originalGet = actualDb.folders.get
    actualDb.folders.where = mockWhere as typeof actualDb.folders.where
    actualDb.folders.add = mockAdd as typeof actualDb.folders.add
    actualDb.folders.get = mockGet as typeof actualDb.folders.get

    try {
      await serviceInternal.setCurrentFolder(mockHandle)

      // Verify db.folders.where was called with 'path'
      expect(mockWhere).toHaveBeenCalledWith('path')
      expect(mockEquals).toHaveBeenCalledWith('new-folder')
      expect(mockFirst).toHaveBeenCalled()

      // Verify db.folders.add was called to create new folder record
      expect(mockAdd).toHaveBeenCalledWith({
        path: 'new-folder',
        name: 'new-folder',
        handleKey: expect.stringMatching(/^literoom-folder-new-folder-\d+$/),
        lastScanDate: expect.any(Date),
      })

      // Verify persistHandle was called for the new folder
      expect(mockPersistHandle).toHaveBeenCalledWith(
        expect.stringMatching(/^literoom-folder-new-folder-\d+$/),
        mockHandle
      )

      // Verify internal state was updated
      expect(serviceInternal._currentFolder).toBe(mockHandle)
      expect(serviceInternal._currentFolderId).toBe(42)
    } finally {
      // Restore original methods
      actualDb.folders.where = originalWhere
      actualDb.folders.add = originalAdd
      actualDb.folders.get = originalGet
      service.destroy()
    }
  })

  it('uses existing folder record when folder already exists in database', async () => {
    const service = await CatalogService.create(mockDecodeService)
    const serviceInternal = service as unknown as SetCurrentFolderInternals
    const mockHandle = createMockFolderHandle('existing-folder')

    // Mock db.folders.where().equals().first() to return existing folder
    const existingFolder = {
      id: 99,
      path: 'existing-folder',
      name: 'existing-folder',
      handleKey: 'literoom-folder-existing-folder-old',
      lastScanDate: new Date('2024-01-01'),
    }
    const mockFirst = vi.fn().mockResolvedValue(existingFolder)
    const mockEquals = vi.fn().mockReturnValue({ first: mockFirst })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })

    // Mock persistHandle - should NOT be called for existing folders
    const mockPersistHandle = vi.fn().mockResolvedValue(undefined)
    serviceInternal.persistHandle = mockPersistHandle

    // Apply mocks
    const { db: actualDb } = await import('./db')
    const originalWhere = actualDb.folders.where
    actualDb.folders.where = mockWhere as typeof actualDb.folders.where

    try {
      await serviceInternal.setCurrentFolder(mockHandle)

      // Verify db.folders.where was called
      expect(mockWhere).toHaveBeenCalledWith('path')
      expect(mockEquals).toHaveBeenCalledWith('existing-folder')
      expect(mockFirst).toHaveBeenCalled()

      // Verify persistHandle was NOT called (folder already exists)
      expect(mockPersistHandle).not.toHaveBeenCalled()

      // Verify internal state was updated with existing folder ID
      expect(serviceInternal._currentFolder).toBe(mockHandle)
      expect(serviceInternal._currentFolderId).toBe(99)
    } finally {
      actualDb.folders.where = originalWhere
      service.destroy()
    }
  })

  it('sets _currentFolder to the provided handle', async () => {
    const service = await CatalogService.create(mockDecodeService)
    const serviceInternal = service as unknown as SetCurrentFolderInternals
    const mockHandle = createMockFolderHandle('my-photos')

    // Verify initial state
    expect(serviceInternal._currentFolder).toBeNull()

    // Mock existing folder to simplify test
    const mockFirst = vi.fn().mockResolvedValue({ id: 1, path: 'my-photos' })
    const mockEquals = vi.fn().mockReturnValue({ first: mockFirst })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })

    const { db: actualDb } = await import('./db')
    const originalWhere = actualDb.folders.where
    actualDb.folders.where = mockWhere as typeof actualDb.folders.where

    try {
      await serviceInternal.setCurrentFolder(mockHandle)

      // Verify _currentFolder is set to the handle
      expect(serviceInternal._currentFolder).toBe(mockHandle)
      expect(serviceInternal._currentFolder?.name).toBe('my-photos')
    } finally {
      actualDb.folders.where = originalWhere
      service.destroy()
    }
  })

  it('sets _currentFolderId correctly for new folders', async () => {
    const service = await CatalogService.create(mockDecodeService)
    const serviceInternal = service as unknown as SetCurrentFolderInternals
    const mockHandle = createMockFolderHandle('brand-new-folder')

    // Verify initial state
    expect(serviceInternal._currentFolderId).toBeNull()

    // Mock no existing folder
    const mockFirst = vi.fn().mockResolvedValue(undefined)
    const mockEquals = vi.fn().mockReturnValue({ first: mockFirst })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })

    // Mock add returning new ID
    const newFolderId = 123
    const mockAdd = vi.fn().mockResolvedValue(newFolderId)
    const mockGet = vi.fn().mockResolvedValue({ id: newFolderId, path: 'brand-new-folder' })

    // Mock persistHandle
    serviceInternal.persistHandle = vi.fn().mockResolvedValue(undefined)

    const { db: actualDb } = await import('./db')
    const originalWhere = actualDb.folders.where
    const originalAdd = actualDb.folders.add
    const originalGet = actualDb.folders.get
    actualDb.folders.where = mockWhere as typeof actualDb.folders.where
    actualDb.folders.add = mockAdd as typeof actualDb.folders.add
    actualDb.folders.get = mockGet as typeof actualDb.folders.get

    try {
      await serviceInternal.setCurrentFolder(mockHandle)

      // Verify _currentFolderId is set to the new folder ID
      expect(serviceInternal._currentFolderId).toBe(123)
    } finally {
      actualDb.folders.where = originalWhere
      actualDb.folders.add = originalAdd
      actualDb.folders.get = originalGet
      service.destroy()
    }
  })

  it('sets _currentFolderId correctly for existing folders', async () => {
    const service = await CatalogService.create(mockDecodeService)
    const serviceInternal = service as unknown as SetCurrentFolderInternals
    const mockHandle = createMockFolderHandle('old-folder')

    // Mock existing folder with specific ID
    const existingFolderId = 456
    const mockFirst = vi.fn().mockResolvedValue({
      id: existingFolderId,
      path: 'old-folder',
      name: 'old-folder',
      handleKey: 'literoom-folder-old-folder-xxx',
      lastScanDate: new Date(),
    })
    const mockEquals = vi.fn().mockReturnValue({ first: mockFirst })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })

    const { db: actualDb } = await import('./db')
    const originalWhere = actualDb.folders.where
    actualDb.folders.where = mockWhere as typeof actualDb.folders.where

    try {
      await serviceInternal.setCurrentFolder(mockHandle)

      // Verify _currentFolderId is set to the existing folder ID
      expect(serviceInternal._currentFolderId).toBe(456)
    } finally {
      actualDb.folders.where = originalWhere
      service.destroy()
    }
  })

  it('calls persistHandle only for new folders', async () => {
    const service = await CatalogService.create(mockDecodeService)
    const serviceInternal = service as unknown as SetCurrentFolderInternals

    // Track persistHandle calls
    const persistHandleCalls: Array<{ key: string; handle: FileSystemDirectoryHandle }> = []
    serviceInternal.persistHandle = vi.fn(async (key, handle) => {
      persistHandleCalls.push({ key, handle })
    })

    const { db: actualDb } = await import('./db')
    const originalWhere = actualDb.folders.where
    const originalAdd = actualDb.folders.add
    const originalGet = actualDb.folders.get

    try {
      // Test 1: New folder - should call persistHandle
      const newFolderHandle = createMockFolderHandle('new-photos')
      const mockFirstNew = vi.fn().mockResolvedValue(undefined)
      const mockEqualsNew = vi.fn().mockReturnValue({ first: mockFirstNew })
      const mockWhereNew = vi.fn().mockReturnValue({ equals: mockEqualsNew })
      actualDb.folders.where = mockWhereNew as typeof actualDb.folders.where
      actualDb.folders.add = vi.fn().mockResolvedValue(1) as typeof actualDb.folders.add
      actualDb.folders.get = vi.fn().mockResolvedValue({ id: 1 }) as typeof actualDb.folders.get

      await serviceInternal.setCurrentFolder(newFolderHandle)

      expect(persistHandleCalls.length).toBe(1)
      expect(persistHandleCalls[0].handle).toBe(newFolderHandle)
      expect(persistHandleCalls[0].key).toMatch(/^literoom-folder-new-photos-\d+$/)

      // Reset for next test
      persistHandleCalls.length = 0

      // Test 2: Existing folder - should NOT call persistHandle
      const existingFolderHandle = createMockFolderHandle('existing-photos')
      const mockFirstExisting = vi.fn().mockResolvedValue({ id: 2, path: 'existing-photos' })
      const mockEqualsExisting = vi.fn().mockReturnValue({ first: mockFirstExisting })
      const mockWhereExisting = vi.fn().mockReturnValue({ equals: mockEqualsExisting })
      actualDb.folders.where = mockWhereExisting as typeof actualDb.folders.where

      await serviceInternal.setCurrentFolder(existingFolderHandle)

      expect(persistHandleCalls.length).toBe(0)
    } finally {
      actualDb.folders.where = originalWhere
      actualDb.folders.add = originalAdd
      actualDb.folders.get = originalGet
      service.destroy()
    }
  })

  it('generates unique handleKey with timestamp for new folders', async () => {
    const service = await CatalogService.create(mockDecodeService)
    const serviceInternal = service as unknown as SetCurrentFolderInternals
    const mockHandle = createMockFolderHandle('timestamped-folder')

    // Capture the handleKey passed to add()
    let capturedHandleKey: string | undefined
    const mockAdd = vi.fn(async (record: { handleKey: string }) => {
      capturedHandleKey = record.handleKey
      return 1
    })

    const mockFirst = vi.fn().mockResolvedValue(undefined)
    const mockEquals = vi.fn().mockReturnValue({ first: mockFirst })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })
    const mockGet = vi.fn().mockResolvedValue({ id: 1 })

    serviceInternal.persistHandle = vi.fn().mockResolvedValue(undefined)

    const { db: actualDb } = await import('./db')
    const originalWhere = actualDb.folders.where
    const originalAdd = actualDb.folders.add
    const originalGet = actualDb.folders.get
    actualDb.folders.where = mockWhere as typeof actualDb.folders.where
    actualDb.folders.add = mockAdd as unknown as typeof actualDb.folders.add
    actualDb.folders.get = mockGet as typeof actualDb.folders.get

    try {
      const beforeTime = Date.now()
      await serviceInternal.setCurrentFolder(mockHandle)
      const afterTime = Date.now()

      // Verify handleKey format: literoom-folder-{name}-{timestamp}
      expect(capturedHandleKey).toBeDefined()
      expect(capturedHandleKey).toMatch(/^literoom-folder-timestamped-folder-\d+$/)

      // Extract and verify timestamp is reasonable
      const timestamp = parseInt(capturedHandleKey!.split('-').pop()!)
      expect(timestamp).toBeGreaterThanOrEqual(beforeTime)
      expect(timestamp).toBeLessThanOrEqual(afterTime)
    } finally {
      actualDb.folders.where = originalWhere
      actualDb.folders.add = originalAdd
      actualDb.folders.get = originalGet
      service.destroy()
    }
  })

  it('uses handle.name as both path and name in folder record', async () => {
    const service = await CatalogService.create(mockDecodeService)
    const serviceInternal = service as unknown as SetCurrentFolderInternals
    const folderName = 'My Photos 2024'
    const mockHandle = createMockFolderHandle(folderName)

    // Capture the folder record passed to add()
    let capturedRecord: { path: string; name: string } | undefined
    const mockAdd = vi.fn(async (record: { path: string; name: string }) => {
      capturedRecord = record
      return 1
    })

    const mockFirst = vi.fn().mockResolvedValue(undefined)
    const mockEquals = vi.fn().mockReturnValue({ first: mockFirst })
    const mockWhere = vi.fn().mockReturnValue({ equals: mockEquals })
    const mockGet = vi.fn().mockResolvedValue({ id: 1 })

    serviceInternal.persistHandle = vi.fn().mockResolvedValue(undefined)

    const { db: actualDb } = await import('./db')
    const originalWhere = actualDb.folders.where
    const originalAdd = actualDb.folders.add
    const originalGet = actualDb.folders.get
    actualDb.folders.where = mockWhere as typeof actualDb.folders.where
    actualDb.folders.add = mockAdd as unknown as typeof actualDb.folders.add
    actualDb.folders.get = mockGet as typeof actualDb.folders.get

    try {
      await serviceInternal.setCurrentFolder(mockHandle)

      // Verify both path and name use handle.name
      expect(capturedRecord).toBeDefined()
      expect(capturedRecord!.path).toBe(folderName)
      expect(capturedRecord!.name).toBe(folderName)
    } finally {
      actualDb.folders.where = originalWhere
      actualDb.folders.add = originalAdd
      actualDb.folders.get = originalGet
      service.destroy()
    }
  })
})

// ============================================================================
// loadHandle Private Method Tests
// ============================================================================

describe('loadHandle', () => {
  let mockDecodeService: IDecodeService

  /**
   * Type for accessing the private loadHandle method.
   */
  type ServiceWithLoadHandle = {
    loadHandle: (key: string) => Promise<FileSystemDirectoryHandle | null>
  }

  /**
   * Create a mock FileSystemDirectoryHandle for testing.
   */
  function createMockHandleForLoadHandle(
    name: string = 'test-folder'
  ): FileSystemDirectoryHandle {
    return {
      kind: 'directory',
      name,
      isSameEntry: vi.fn(),
      queryPermission: vi.fn(),
      requestPermission: vi.fn(),
      resolve: vi.fn(),
      getDirectoryHandle: vi.fn(),
      getFileHandle: vi.fn(),
      removeEntry: vi.fn(),
      keys: vi.fn(),
      values: vi.fn(),
      entries: vi.fn(),
      [Symbol.asyncIterator]: vi.fn(),
    } as unknown as FileSystemDirectoryHandle
  }

  /**
   * Create a mock IDBRequest that resolves successfully.
   */
  function createMockIDBRequest<T>(result: T): IDBRequest<T> {
    const request = {
      result,
      error: null,
      source: null,
      transaction: null,
      readyState: 'done' as IDBRequestReadyState,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as IDBRequest<T>

    // Trigger onsuccess in next microtask
    setTimeout(() => {
      if (request.onsuccess) {
        request.onsuccess(new Event('success'))
      }
    }, 0)

    return request
  }

  /**
   * Create a mock IDBRequest that fails with an error.
   */
  function createMockIDBRequestError<T>(error: DOMException): IDBRequest<T> {
    const request = {
      result: undefined,
      error,
      source: null,
      transaction: null,
      readyState: 'done' as IDBRequestReadyState,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as IDBRequest<T>

    // Trigger onerror in next microtask
    setTimeout(() => {
      if (request.onerror) {
        request.onerror(new Event('error'))
      }
    }, 0)

    return request
  }

  /**
   * Create a mock IDBObjectStore.
   */
  function createMockObjectStore(data: Map<string, unknown>): IDBObjectStore {
    return {
      name: 'handles',
      keyPath: null,
      indexNames: { length: 0 } as DOMStringList,
      transaction: null as unknown as IDBTransaction,
      autoIncrement: false,
      get: vi.fn((key: string) => createMockIDBRequest(data.get(key))),
      put: vi.fn(),
      add: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      count: vi.fn(),
      getKey: vi.fn(),
      getAll: vi.fn(),
      getAllKeys: vi.fn(),
      index: vi.fn(),
      createIndex: vi.fn(),
      deleteIndex: vi.fn(),
      openCursor: vi.fn(),
      openKeyCursor: vi.fn(),
    } as unknown as IDBObjectStore
  }

  /**
   * Create a mock IDBTransaction.
   */
  function createMockTransaction(store: IDBObjectStore): IDBTransaction {
    return {
      db: null as unknown as IDBDatabase,
      durability: 'default',
      error: null,
      mode: 'readonly',
      objectStoreNames: { length: 1, item: () => 'handles', contains: () => true } as DOMStringList,
      objectStore: vi.fn(() => store),
      abort: vi.fn(),
      commit: vi.fn(),
      oncomplete: null,
      onerror: null,
      onabort: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as IDBTransaction
  }

  /**
   * Create a mock IDBDatabase.
   */
  function createMockDatabase(store: IDBObjectStore): IDBDatabase {
    const tx = createMockTransaction(store)
    return {
      name: 'literoom-fs',
      version: 1,
      objectStoreNames: {
        length: 1,
        item: () => 'handles',
        contains: (name: string) => name === 'handles',
      } as DOMStringList,
      transaction: vi.fn(() => tx),
      createObjectStore: vi.fn(() => store),
      deleteObjectStore: vi.fn(),
      close: vi.fn(),
      onabort: null,
      onclose: null,
      onerror: null,
      onversionchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as IDBDatabase
  }

  /**
   * Create a mock IDBOpenDBRequest.
   */
  function createMockOpenDBRequest(
    database: IDBDatabase,
    options: { triggerUpgrade?: boolean; error?: DOMException } = {}
  ): IDBOpenDBRequest {
    const request = {
      result: database,
      error: options.error ?? null,
      source: null,
      transaction: null,
      readyState: 'done' as IDBRequestReadyState,
      onsuccess: null as ((event: Event) => void) | null,
      onerror: null as ((event: Event) => void) | null,
      onupgradeneeded: null as ((event: IDBVersionChangeEvent) => void) | null,
      onblocked: null as ((event: Event) => void) | null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    } as unknown as IDBOpenDBRequest

    // Trigger callbacks in next microtask
    setTimeout(() => {
      if (options.error && request.onerror) {
        request.onerror(new Event('error'))
      } else {
        if (options.triggerUpgrade && request.onupgradeneeded) {
          const upgradeEvent = {
            target: request,
            oldVersion: 0,
            newVersion: 1,
          } as unknown as IDBVersionChangeEvent
          request.onupgradeneeded(upgradeEvent)
        }
        if (request.onsuccess) {
          request.onsuccess(new Event('success'))
        }
      }
    }, 0)

    return request
  }

  beforeEach(() => {
    mockDecodeService = createMockDecodeService()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  describe('handle found and returned successfully', () => {
    it('returns the stored handle when key exists', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      // Create mock data
      const mockHandle = createMockHandleForLoadHandle('my-folder')
      const data = new Map<string, unknown>([['test-key', mockHandle]])

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle('test-key')

      expect(result).toBeDefined()
      expect(result).not.toBeNull()
      expect((result as FileSystemDirectoryHandle).name).toBe('my-folder')
      expect(store.get).toHaveBeenCalledWith('test-key')

      service.destroy()
    })

    it('returns the correct handle when multiple handles are stored', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const handle1 = createMockHandleForLoadHandle('folder-1')
      const handle2 = createMockHandleForLoadHandle('folder-2')
      const handle3 = createMockHandleForLoadHandle('folder-3')

      const data = new Map<string, unknown>([
        ['key-1', handle1],
        ['key-2', handle2],
        ['key-3', handle3],
      ])

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle('key-2')

      expect(result).toBeDefined()
      expect((result as FileSystemDirectoryHandle).name).toBe('folder-2')
      expect(store.get).toHaveBeenCalledWith('key-2')

      service.destroy()
    })

    it('returns handle with all properties intact', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const mockHandle = createMockHandleForLoadHandle('preserved-folder')
      const data = new Map<string, unknown>([['preserve-key', mockHandle]])

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle('preserve-key')

      expect(result).toBeDefined()
      expect((result as FileSystemDirectoryHandle).kind).toBe('directory')
      expect((result as FileSystemDirectoryHandle).name).toBe('preserved-folder')

      service.destroy()
    })
  })

  describe('handle not found returns null', () => {
    it('returns null when key does not exist', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const data = new Map<string, unknown>()

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle('non-existent-key')

      expect(result).toBeNull()

      service.destroy()
    })

    it('returns null when database is empty', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const data = new Map<string, unknown>()

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle('any-key')

      expect(result).toBeNull()

      service.destroy()
    })

    it('returns null for empty string key', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const mockHandle = createMockHandleForLoadHandle('some-folder')
      const data = new Map<string, unknown>([['real-key', mockHandle]])

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle('')

      expect(result).toBeNull()
      expect(store.get).toHaveBeenCalledWith('')

      service.destroy()
    })

    it('treats undefined value in store as null', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const data = new Map<string, unknown>([['undefined-key', undefined]])

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle('undefined-key')

      expect(result).toBeNull()

      service.destroy()
    })
  })

  describe('database error handling', () => {
    it('rejects when indexedDB.open fails', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const mockError = new DOMException('Database open failed', 'AbortError')

      const data = new Map<string, unknown>()
      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(
        () => createMockOpenDBRequest(database, { error: mockError })
      )

      await expect(loadHandle('any-key')).rejects.toEqual(mockError)

      service.destroy()
    })

    it('rejects when store.get fails', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const mockError = new DOMException('Get operation failed', 'DataError')

      // Create a store that returns an error for get operations
      const store = {
        name: 'handles',
        keyPath: null,
        indexNames: { length: 0 } as DOMStringList,
        transaction: null as unknown as IDBTransaction,
        autoIncrement: false,
        get: vi.fn(() => createMockIDBRequestError(mockError)),
        put: vi.fn(),
        add: vi.fn(),
        delete: vi.fn(),
        clear: vi.fn(),
        count: vi.fn(),
        getKey: vi.fn(),
        getAll: vi.fn(),
        getAllKeys: vi.fn(),
        index: vi.fn(),
        createIndex: vi.fn(),
        deleteIndex: vi.fn(),
        openCursor: vi.fn(),
        openKeyCursor: vi.fn(),
      } as unknown as IDBObjectStore

      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      await expect(loadHandle('failing-key')).rejects.toEqual(mockError)

      service.destroy()
    })
  })

  describe('object store creation on upgrade', () => {
    it('creates object store when database does not exist', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const data = new Map<string, unknown>()
      const store = createMockObjectStore(data)

      // Create database that doesn't have the store initially
      const database = {
        name: 'literoom-fs',
        version: 1,
        objectStoreNames: {
          length: 0,
          item: () => null,
          contains: () => false,
        } as DOMStringList,
        transaction: vi.fn(() => createMockTransaction(store)),
        createObjectStore: vi.fn(() => store),
        deleteObjectStore: vi.fn(),
        close: vi.fn(),
        onabort: null,
        onclose: null,
        onerror: null,
        onversionchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as IDBDatabase

      vi.spyOn(indexedDB, 'open').mockImplementation(
        () => createMockOpenDBRequest(database, { triggerUpgrade: true })
      )

      const result = await loadHandle('new-key')

      expect(result).toBeNull()
      expect(database.createObjectStore).toHaveBeenCalledWith('handles')

      service.destroy()
    })

    it('does not recreate object store if it already exists', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const mockHandle = createMockHandleForLoadHandle('existing-folder')
      const data = new Map<string, unknown>([['existing-key', mockHandle]])

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(
        () => createMockOpenDBRequest(database, { triggerUpgrade: true })
      )

      const result = await loadHandle('existing-key')

      expect(result).toBeDefined()
      expect((result as FileSystemDirectoryHandle).name).toBe('existing-folder')
      // createObjectStore should not be called since store already exists
      expect(database.createObjectStore).not.toHaveBeenCalled()

      service.destroy()
    })

    it('handles onupgradeneeded when objectStoreNames is initially empty', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const data = new Map<string, unknown>()
      const store = createMockObjectStore(data)

      const database = {
        name: 'literoom-fs',
        version: 1,
        objectStoreNames: {
          length: 0,
          item: () => null,
          contains: () => false,
        } as DOMStringList,
        transaction: vi.fn(() => createMockTransaction(store)),
        createObjectStore: vi.fn(() => store),
        deleteObjectStore: vi.fn(),
        close: vi.fn(),
        onabort: null,
        onclose: null,
        onerror: null,
        onversionchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      } as unknown as IDBDatabase

      vi.spyOn(indexedDB, 'open').mockImplementation(
        () => createMockOpenDBRequest(database, { triggerUpgrade: true })
      )

      const result = await loadHandle('upgrade-test-key')

      expect(result).toBeNull()
      expect(database.createObjectStore).toHaveBeenCalledWith('handles')

      service.destroy()
    })
  })

  describe('edge cases', () => {
    it('handles special characters in key', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const specialKey = 'path/with/slashes and spaces (and) [brackets]'
      const mockHandle = createMockHandleForLoadHandle('special-folder')
      const data = new Map<string, unknown>([[specialKey, mockHandle]])

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle(specialKey)

      expect(result).toBeDefined()
      expect((result as FileSystemDirectoryHandle).name).toBe('special-folder')
      expect(store.get).toHaveBeenCalledWith(specialKey)

      service.destroy()
    })

    it('handles very long key', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const longKey = 'a'.repeat(1000)
      const mockHandle = createMockHandleForLoadHandle('long-key-folder')
      const data = new Map<string, unknown>([[longKey, mockHandle]])

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle(longKey)

      expect(result).toBeDefined()
      expect((result as FileSystemDirectoryHandle).name).toBe('long-key-folder')

      service.destroy()
    })

    it('handles unicode key', async () => {
      const service = await CatalogService.create(mockDecodeService)
      const loadHandle = (service as unknown as ServiceWithLoadHandle).loadHandle.bind(service)

      const unicodeKey = '/photos/vacation/2024'
      const mockHandle = createMockHandleForLoadHandle('unicode-folder')
      const data = new Map<string, unknown>([[unicodeKey, mockHandle]])

      const store = createMockObjectStore(data)
      const database = createMockDatabase(store)

      vi.spyOn(indexedDB, 'open').mockImplementation(() => createMockOpenDBRequest(database))

      const result = await loadHandle(unicodeKey)

      expect(result).toBeDefined()
      expect((result as FileSystemDirectoryHandle).name).toBe('unicode-folder')

      service.destroy()
    })
  })
})


// ============================================================================
// loadFolderById Comprehensive Tests
// ============================================================================

describe('loadFolderById comprehensive tests', () => {
  let mockDecodeService: IDecodeService
  let service: CatalogService

  // Type for accessing private members
  type ServiceInternals = {
    _currentFolder: FileSystemDirectoryHandle | null
    _currentFolderId: number | null
    _assets: Map<string, Asset>
    _onAssetsAdded: ((assets: Asset[]) => void) | null
    loadHandle: (key: string) => Promise<FileSystemDirectoryHandle | null>
    assetRecordToAsset: (record: AssetRecord, getFile?: () => Promise<File>) => Asset
  }

  /**
   * Create a mock folder handle for testing.
   */
  function createMockFolderHandle(
    options: {
      queryPermission?: 'granted' | 'denied' | 'prompt'
      requestPermission?: 'granted' | 'denied'
    } = {}
  ): FileSystemDirectoryHandle {
    const { queryPermission = 'granted', requestPermission = 'granted' } = options
    return {
      name: 'test-folder',
      kind: 'directory',
      queryPermission: vi.fn().mockResolvedValue(queryPermission),
      requestPermission: vi.fn().mockResolvedValue(requestPermission),
      getFileHandle: vi.fn(),
      getDirectoryHandle: vi.fn(),
      isSameEntry: vi.fn(),
      resolve: vi.fn(),
      keys: vi.fn(),
      values: vi.fn(),
      entries: vi.fn(),
      [Symbol.asyncIterator]: vi.fn(),
    } as unknown as FileSystemDirectoryHandle
  }

  /**
   * Create a mock folder record.
   */
  function createMockFolderRecord(
    overrides: Partial<{
      id: number
      path: string
      name: string
      handleKey: string
      lastScanDate: Date
    }> = {}
  ): { id: number; path: string; name: string; handleKey: string; lastScanDate: Date } {
    return {
      id: 1,
      path: '/test/folder',
      name: 'test-folder',
      handleKey: 'test-handle-key',
      lastScanDate: new Date('2024-01-01'),
      ...overrides,
    }
  }

  /**
   * Create a mock asset record.
   */
  function createMockAssetRecord(overrides: Partial<AssetRecord> = {}): AssetRecord {
    return {
      id: 1,
      uuid: 'test-uuid-1',
      folderId: 1,
      path: 'test/path',
      filename: 'test-image',
      extension: 'jpg',
      flag: 'none',
      captureDate: new Date('2024-01-15'),
      modifiedDate: new Date('2024-01-20'),
      fileSize: 1024,
      width: 1920,
      height: 1080,
      ...overrides,
    }
  }

  beforeEach(async () => {
    mockDecodeService = createMockDecodeService()
    service = await CatalogService.create(mockDecodeService)
  })

  afterEach(() => {
    service.destroy()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  it('returns false when folder is not found in database', async () => {
    // Mock db.folders.get to return undefined
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(undefined)

    const result = await service.loadFolderById(999)

    expect(result).toBe(false)
    expect(dbModule.db.folders.get).toHaveBeenCalledWith(999)
  })

  it('returns false when handle cannot be loaded from IndexedDB', async () => {
    // Mock folder found in db
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock loadHandle to return null
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(null)

    const result = await service.loadFolderById(1)

    expect(result).toBe(false)
    expect(dbModule.db.folders.get).toHaveBeenCalledWith(1)
  })

  it('returns false when permission is not granted and request is denied', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle with denied permission
    const mockHandle = createMockFolderHandle({
      queryPermission: 'denied',
      requestPermission: 'denied',
    })

    // Mock loadHandle to return the mock handle
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    const result = await service.loadFolderById(1)

    expect(result).toBe(false)
    expect(mockHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    expect(mockHandle.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
  })

  it('returns false when permission is prompt and request is denied', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle with prompt permission that gets denied
    const mockHandle = createMockFolderHandle({
      queryPermission: 'prompt',
      requestPermission: 'denied',
    })

    // Mock loadHandle to return the mock handle
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    const result = await service.loadFolderById(1)

    expect(result).toBe(false)
    expect(mockHandle.queryPermission).toHaveBeenCalledWith({ mode: 'read' })
    expect(mockHandle.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
  })

  it('succeeds when permission is already granted (does not request permission)', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle with granted permission
    const mockHandle = createMockFolderHandle({
      queryPermission: 'granted',
    })

    // Mock loadHandle
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return empty
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    const result = await service.loadFolderById(1)

    expect(result).toBe(true)
    // Should not request permission if already granted
    expect(mockHandle.requestPermission).not.toHaveBeenCalled()
  })

  it('succeeds when permission request is granted after prompt', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle with prompt permission that gets granted
    const mockHandle = createMockFolderHandle({
      queryPermission: 'prompt',
      requestPermission: 'granted',
    })

    // Mock loadHandle
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return empty
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    const result = await service.loadFolderById(1)

    expect(result).toBe(true)
    expect(mockHandle.requestPermission).toHaveBeenCalledWith({ mode: 'read' })
  })

  it('sets current folder and folder ID on successful load', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 42 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle
    const mockHandle = createMockFolderHandle({ queryPermission: 'granted' })

    // Mock loadHandle
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return empty
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    await service.loadFolderById(42)

    expect(serviceInternal._currentFolder).toBe(mockHandle)
    expect(serviceInternal._currentFolderId).toBe(42)
  })

  it('clears existing assets before loading new ones', async () => {
    // Pre-populate assets in the service
    const serviceInternal = service as unknown as ServiceInternals
    serviceInternal._assets.set('existing-asset-1', {
      id: 'existing-asset-1',
      folderId: '99',
      path: 'old/path',
      filename: 'old',
      extension: 'jpg',
      flag: 'none',
      captureDate: null,
      modifiedDate: new Date(),
      fileSize: 100,
      thumbnailStatus: 'ready',
      thumbnailUrl: 'blob:old-url',
    })

    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle
    const mockHandle = createMockFolderHandle({ queryPermission: 'granted' })
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return empty array (new folder has no assets)
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    await service.loadFolderById(1)

    // Existing assets should be cleared
    expect(serviceInternal._assets.size).toBe(0)
    expect(service.getAsset('existing-asset-1')).toBeUndefined()
  })

  it('loads assets from database and converts them', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle
    const mockHandle = createMockFolderHandle({ queryPermission: 'granted' })
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return some assets
    const assetRecords = [
      createMockAssetRecord({ id: 1, uuid: 'uuid-1', filename: 'photo1' }),
      createMockAssetRecord({ id: 2, uuid: 'uuid-2', filename: 'photo2' }),
      createMockAssetRecord({ id: 3, uuid: 'uuid-3', filename: 'photo3' }),
    ]
    const mockToArray = vi.fn().mockResolvedValue(assetRecords)
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    await service.loadFolderById(1)

    // Verify assets were loaded
    const loadedAssets = service.getAssets()
    expect(loadedAssets).toHaveLength(3)
    expect(service.getAsset('uuid-1')).toBeDefined()
    expect(service.getAsset('uuid-2')).toBeDefined()
    expect(service.getAsset('uuid-3')).toBeDefined()
    expect(service.getAsset('uuid-1')?.filename).toBe('photo1')
  })

  it('updates lastScanDate in database on successful load', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle
    const mockHandle = createMockFolderHandle({ queryPermission: 'granted' })
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return empty
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    const updateSpy = vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    await service.loadFolderById(1)

    // Verify lastScanDate was updated
    expect(updateSpy).toHaveBeenCalledWith(1, {
      lastScanDate: expect.any(Date),
    })
  })

  it('calls onAssetsAdded callback when assets are loaded', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle
    const mockHandle = createMockFolderHandle({ queryPermission: 'granted' })
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return some assets
    const assetRecords = [
      createMockAssetRecord({ uuid: 'uuid-1' }),
      createMockAssetRecord({ uuid: 'uuid-2' }),
    ]
    const mockToArray = vi.fn().mockResolvedValue(assetRecords)
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    // Set up callback
    const onAssetsAdded = vi.fn()
    service.onAssetsAdded = onAssetsAdded

    await service.loadFolderById(1)

    // Verify callback was called with loaded assets
    expect(onAssetsAdded).toHaveBeenCalledTimes(1)
    expect(onAssetsAdded).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'uuid-1' }),
        expect.objectContaining({ id: 'uuid-2' }),
      ])
    )
  })

  it('does not call onAssetsAdded callback when no assets are loaded', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle
    const mockHandle = createMockFolderHandle({ queryPermission: 'granted' })
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return empty array
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    // Set up callback
    const onAssetsAdded = vi.fn()
    service.onAssetsAdded = onAssetsAdded

    await service.loadFolderById(1)

    // Verify callback was NOT called (no assets)
    expect(onAssetsAdded).not.toHaveBeenCalled()
  })

  it('queries assets by folder ID correctly', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 123 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle
    const mockHandle = createMockFolderHandle({ queryPermission: 'granted' })
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    const whereSpy = vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({
      equals: mockEquals,
    } as unknown as ReturnType<typeof dbModule.db.assets.where>)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    await service.loadFolderById(123)

    // Verify the query chain was correct
    expect(whereSpy).toHaveBeenCalledWith('folderId')
    expect(mockEquals).toHaveBeenCalledWith(123)
  })

  it('returns true on successful load with assets', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle
    const mockHandle = createMockFolderHandle({ queryPermission: 'granted' })
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return assets
    const assetRecords = [createMockAssetRecord({ uuid: 'uuid-1' })]
    const mockToArray = vi.fn().mockResolvedValue(assetRecords)
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    const result = await service.loadFolderById(1)

    expect(result).toBe(true)
  })

  it('returns true on successful load with no assets', async () => {
    // Mock folder found
    const folderRecord = createMockFolderRecord({ id: 1 })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock handle
    const mockHandle = createMockFolderHandle({ queryPermission: 'granted' })
    const serviceInternal = service as unknown as ServiceInternals
    vi.spyOn(serviceInternal, 'loadHandle').mockResolvedValue(
      mockHandle
    )

    // Mock assets query to return empty array
    const mockToArray = vi.fn().mockResolvedValue([])
    const mockEquals = vi.fn().mockReturnValue({ toArray: mockToArray })
    vi.spyOn(dbModule.db.assets, 'where').mockReturnValue({ equals: mockEquals } as unknown as ReturnType<
      typeof dbModule.db.assets.where
    >)
    vi.spyOn(dbModule.db.folders, 'update').mockResolvedValue(1)

    const result = await service.loadFolderById(1)

    expect(result).toBe(true)
  })

  it('uses the correct handle key from folder record when loading handle', async () => {
    // Mock folder found with specific handleKey
    const folderRecord = createMockFolderRecord({
      id: 1,
      handleKey: 'my-specific-handle-key',
    })
    const dbModule = await import('./db')
    vi.spyOn(dbModule.db.folders, 'get').mockResolvedValue(folderRecord)

    // Mock loadHandle to capture the key it receives
    const serviceInternal = service as unknown as ServiceInternals
    const loadHandleSpy = vi
      .spyOn(serviceInternal, 'loadHandle')
      .mockResolvedValue(null)

    await service.loadFolderById(1)

    // Verify loadHandle was called with the correct key
    expect(loadHandleSpy).toHaveBeenCalledWith('my-specific-handle-key')
  })
})
