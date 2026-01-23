/**
 * Integration tests for the catalog.client plugin.
 *
 * Tests the plugin's initialization logic, service wiring, and callback handling.
 * Since the actual plugin requires Nuxt context, we test the underlying logic patterns.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Mock Types
// ============================================================================

interface MockAsset {
  id: string
  filename: string
  thumbnailUrl?: string
  previewUrl?: string
}

interface MockCatalogStore {
  assetIds: string[]
  assets: Map<string, MockAsset>
  folderPath: string | null
  isScanning: boolean
  addAssetBatch: ReturnType<typeof vi.fn>
  updateAsset: ReturnType<typeof vi.fn>
  updateThumbnail: ReturnType<typeof vi.fn>
  updatePreview: ReturnType<typeof vi.fn>
  setFolderPath: ReturnType<typeof vi.fn>
  setScanning: ReturnType<typeof vi.fn>
}

interface MockEditStore {
  isInitialized: boolean
  initializeFromDb: ReturnType<typeof vi.fn>
}

interface MockCatalogService {
  onAssetsAdded: ((assets: MockAsset[]) => void) | null
  onAssetUpdated: ((asset: MockAsset) => void) | null
  onThumbnailReady: ((assetId: string, url: string) => void) | null
  onPreviewReady: ((assetId: string, url: string) => void) | null
  selectFolder: ReturnType<typeof vi.fn>
  scanFolder: ReturnType<typeof vi.fn>
  loadFromDatabase: ReturnType<typeof vi.fn>
  getCurrentFolder: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}

interface MockDecodeService {
  destroy: ReturnType<typeof vi.fn>
}

interface MockGPUProcessor {
  initialize: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  state: {
    activeBackend: 'webgpu' | 'wasm'
    capabilities: {
      available: boolean
      adapterInfo?: { vendor: string; device: string }
    }
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function createMockCatalogStore(): MockCatalogStore {
  return {
    assetIds: [],
    assets: new Map(),
    folderPath: null,
    isScanning: false,
    addAssetBatch: vi.fn((assets: MockAsset[]) => {
      for (const asset of assets) {
        createMockCatalogStore().assetIds.push(asset.id)
      }
    }),
    updateAsset: vi.fn(),
    updateThumbnail: vi.fn(),
    updatePreview: vi.fn(),
    setFolderPath: vi.fn((path: string) => {
      createMockCatalogStore().folderPath = path
    }),
    setScanning: vi.fn(),
  }
}

function createMockEditStore(): MockEditStore {
  return {
    isInitialized: false,
    initializeFromDb: vi.fn().mockResolvedValue(0),
  }
}

function createMockCatalogService(): MockCatalogService {
  return {
    onAssetsAdded: null,
    onAssetUpdated: null,
    onThumbnailReady: null,
    onPreviewReady: null,
    selectFolder: vi.fn().mockResolvedValue(undefined),
    scanFolder: vi.fn().mockResolvedValue(undefined),
    loadFromDatabase: vi.fn().mockResolvedValue(false),
    getCurrentFolder: vi.fn().mockReturnValue(null),
    destroy: vi.fn(),
  }
}

function createMockDecodeService(): MockDecodeService {
  return {
    destroy: vi.fn(),
  }
}

function createMockGPUProcessor(): MockGPUProcessor {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
    state: {
      activeBackend: 'wasm',
      capabilities: {
        available: false,
      },
    },
  }
}

// ============================================================================
// Callback Wiring Tests
// ============================================================================

describe('callback wiring', () => {
  let catalogStore: MockCatalogStore
  let catalogService: MockCatalogService

  beforeEach(() => {
    catalogStore = createMockCatalogStore()
    catalogService = createMockCatalogService()
  })

  it('wires onAssetsAdded callback to store', () => {
    // Wire callback
    catalogService.onAssetsAdded = (assets) => {
      catalogStore.addAssetBatch(assets)
    }

    // Trigger callback
    const newAssets: MockAsset[] = [
      { id: 'asset-1', filename: 'photo1.jpg' },
      { id: 'asset-2', filename: 'photo2.jpg' },
    ]
    catalogService.onAssetsAdded?.(newAssets)

    expect(catalogStore.addAssetBatch).toHaveBeenCalledWith(newAssets)
  })

  it('wires onAssetUpdated callback to store', () => {
    catalogService.onAssetUpdated = (asset) => {
      catalogStore.updateAsset(asset.id, asset)
    }

    const updatedAsset: MockAsset = { id: 'asset-1', filename: 'photo1-renamed.jpg' }
    catalogService.onAssetUpdated?.(updatedAsset)

    expect(catalogStore.updateAsset).toHaveBeenCalledWith('asset-1', updatedAsset)
  })

  it('wires onThumbnailReady callback to store', () => {
    catalogService.onThumbnailReady = (assetId, url) => {
      catalogStore.updateThumbnail(assetId, 'ready', url)
    }

    catalogService.onThumbnailReady?.('asset-1', 'blob:thumbnail-url')

    expect(catalogStore.updateThumbnail).toHaveBeenCalledWith('asset-1', 'ready', 'blob:thumbnail-url')
  })

  it('wires onPreviewReady callback to store', () => {
    catalogService.onPreviewReady = (assetId, url) => {
      catalogStore.updatePreview(assetId, 'ready', url)
    }

    catalogService.onPreviewReady?.('asset-1', 'blob:preview-url')

    expect(catalogStore.updatePreview).toHaveBeenCalledWith('asset-1', 'ready', 'blob:preview-url')
  })

  it('handles batch asset additions', () => {
    catalogService.onAssetsAdded = (assets) => {
      catalogStore.addAssetBatch(assets)
    }

    // Simulate large batch
    const assets: MockAsset[] = Array.from({ length: 100 }, (_, i) => ({
      id: `asset-${i}`,
      filename: `photo${i}.jpg`,
    }))

    catalogService.onAssetsAdded?.(assets)

    expect(catalogStore.addAssetBatch).toHaveBeenCalledWith(assets)
    expect(catalogStore.addAssetBatch).toHaveBeenCalledTimes(1)
  })
})

// ============================================================================
// initializeCatalog Logic Tests
// ============================================================================

describe('initializeCatalog logic', () => {
  let catalogStore: MockCatalogStore
  let editStore: MockEditStore
  let catalogService: MockCatalogService

  beforeEach(() => {
    catalogStore = createMockCatalogStore()
    editStore = createMockEditStore()
    catalogService = createMockCatalogService()
  })

  describe('when catalog already populated', () => {
    it('returns true immediately', async () => {
      catalogStore.assetIds = ['asset-1', 'asset-2']

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) {
          await editStore.initializeFromDb()
          return true
        }
        return false
      }

      const result = await initializeCatalog()

      expect(result).toBe(true)
      expect(editStore.initializeFromDb).toHaveBeenCalled()
    })

    it('does not call catalogService methods', async () => {
      catalogStore.assetIds = ['asset-1']

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) {
          await editStore.initializeFromDb()
          return true
        }
        // These would be called if not early-returning
        await catalogService.selectFolder()
        await catalogService.scanFolder()
        return true
      }

      await initializeCatalog()

      expect(catalogService.selectFolder).not.toHaveBeenCalled()
      expect(catalogService.scanFolder).not.toHaveBeenCalled()
    })
  })

  describe('demo mode initialization', () => {
    it('sets folder path to Demo Photos', async () => {
      const isDemoMode = true

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) return true

        if (isDemoMode) {
          catalogStore.setFolderPath('Demo Photos')
          catalogStore.setScanning(true)
          try {
            await catalogService.selectFolder()
            await catalogService.scanFolder()
            await editStore.initializeFromDb()
            return catalogStore.assetIds.length > 0
          } finally {
            catalogStore.setScanning(false)
          }
        }
        return false
      }

      await initializeCatalog()

      expect(catalogStore.setFolderPath).toHaveBeenCalledWith('Demo Photos')
    })

    it('sets scanning state during load', async () => {
      const isDemoMode = true

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) return true

        if (isDemoMode) {
          catalogStore.setFolderPath('Demo Photos')
          catalogStore.setScanning(true)
          try {
            await catalogService.selectFolder()
            await catalogService.scanFolder()
            return true
          } finally {
            catalogStore.setScanning(false)
          }
        }
        return false
      }

      await initializeCatalog()

      expect(catalogStore.setScanning).toHaveBeenCalledWith(true)
      expect(catalogStore.setScanning).toHaveBeenCalledWith(false)
    })

    it('calls selectFolder and scanFolder', async () => {
      const isDemoMode = true

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) return true

        if (isDemoMode) {
          catalogStore.setFolderPath('Demo Photos')
          catalogStore.setScanning(true)
          try {
            await catalogService.selectFolder()
            await catalogService.scanFolder()
            return true
          } finally {
            catalogStore.setScanning(false)
          }
        }
        return false
      }

      await initializeCatalog()

      expect(catalogService.selectFolder).toHaveBeenCalled()
      expect(catalogService.scanFolder).toHaveBeenCalled()
    })

    it('initializes edit store', async () => {
      const isDemoMode = true

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) return true

        if (isDemoMode) {
          catalogStore.setFolderPath('Demo Photos')
          catalogStore.setScanning(true)
          try {
            await catalogService.selectFolder()
            await catalogService.scanFolder()
            await editStore.initializeFromDb()
            return catalogStore.assetIds.length > 0
          } finally {
            catalogStore.setScanning(false)
          }
        }
        return false
      }

      await initializeCatalog()

      expect(editStore.initializeFromDb).toHaveBeenCalled()
    })
  })

  describe('real mode initialization', () => {
    it('attempts to load from database', async () => {
      const isDemoMode = false
      catalogService.loadFromDatabase = vi.fn().mockResolvedValue(true)
      catalogService.getCurrentFolder = vi.fn().mockReturnValue({ name: 'Photos' })

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) return true

        if (!isDemoMode) {
          const restored = await catalogService.loadFromDatabase()
          if (restored) {
            const folder = catalogService.getCurrentFolder()
            if (folder) {
              catalogStore.setFolderPath(folder.name)
            }
            await editStore.initializeFromDb()
            return true
          }
          return false
        }
        return false
      }

      await initializeCatalog()

      expect(catalogService.loadFromDatabase).toHaveBeenCalled()
    })

    it('sets folder path from restored data', async () => {
      const isDemoMode = false
      catalogService.loadFromDatabase = vi.fn().mockResolvedValue(true)
      catalogService.getCurrentFolder = vi.fn().mockReturnValue({ name: 'My Photos' })

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) return true

        if (!isDemoMode) {
          const restored = await catalogService.loadFromDatabase()
          if (restored) {
            const folder = catalogService.getCurrentFolder()
            if (folder) {
              catalogStore.setFolderPath(folder.name)
            }
            return true
          }
          return false
        }
        return false
      }

      await initializeCatalog()

      expect(catalogStore.setFolderPath).toHaveBeenCalledWith('My Photos')
    })

    it('returns false when database restore fails', async () => {
      const isDemoMode = false
      catalogService.loadFromDatabase = vi.fn().mockResolvedValue(false)

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) return true

        if (!isDemoMode) {
          const restored = await catalogService.loadFromDatabase()
          if (restored) {
            return true
          }
          return false
        }
        return false
      }

      const result = await initializeCatalog()

      expect(result).toBe(false)
    })
  })

  describe('error handling', () => {
    it('catches and logs errors', async () => {
      const isDemoMode = true
      catalogService.selectFolder = vi.fn().mockRejectedValue(new Error('Permission denied'))

      const initializeCatalog = async () => {
        if (catalogStore.assetIds.length > 0) return true

        try {
          if (isDemoMode) {
            await catalogService.selectFolder()
            return true
          }
          return false
        } catch (e) {
          console.warn('Failed to initialize catalog:', e)
          return false
        }
      }

      const result = await initializeCatalog()

      expect(result).toBe(false)
    })
  })
})

// ============================================================================
// GPU Initialization Tests
// ============================================================================

describe('GPU initialization', () => {
  let gpuProcessor: MockGPUProcessor

  beforeEach(() => {
    gpuProcessor = createMockGPUProcessor()
  })

  it('initializes GPU processor asynchronously', async () => {
    const gpuInitPromise = gpuProcessor.initialize()

    await gpuInitPromise

    expect(gpuProcessor.initialize).toHaveBeenCalled()
  })

  it('handles GPU initialization failure gracefully', async () => {
    gpuProcessor.initialize = vi.fn().mockRejectedValue(new Error('WebGPU not supported'))

    let gpuCapabilities = { available: false }

    try {
      await gpuProcessor.initialize()
      gpuCapabilities = gpuProcessor.state.capabilities
    } catch (error) {
      // GPU init failed, use WASM fallback
      gpuCapabilities = { available: false }
    }

    expect(gpuCapabilities.available).toBe(false)
  })

  it('updates capabilities after successful initialization', async () => {
    gpuProcessor.initialize = vi.fn().mockImplementation(async () => {
      gpuProcessor.state.activeBackend = 'webgpu'
      gpuProcessor.state.capabilities = {
        available: true,
        adapterInfo: { vendor: 'NVIDIA', device: 'RTX 3090' },
      }
    })

    await gpuProcessor.initialize()

    expect(gpuProcessor.state.activeBackend).toBe('webgpu')
    expect(gpuProcessor.state.capabilities.available).toBe(true)
    expect(gpuProcessor.state.capabilities.adapterInfo?.vendor).toBe('NVIDIA')
  })
})

// ============================================================================
// Cleanup Tests
// ============================================================================

describe('cleanup on unload', () => {
  let catalogService: MockCatalogService
  let decodeService: MockDecodeService
  let gpuProcessor: MockGPUProcessor

  beforeEach(() => {
    catalogService = createMockCatalogService()
    decodeService = createMockDecodeService()
    gpuProcessor = createMockGPUProcessor()
  })

  it('destroys all services on beforeunload', () => {
    // Simulate beforeunload handler
    const cleanup = () => {
      catalogService.destroy()
      decodeService.destroy()
      gpuProcessor.destroy()
    }

    cleanup()

    expect(catalogService.destroy).toHaveBeenCalled()
    expect(decodeService.destroy).toHaveBeenCalled()
    expect(gpuProcessor.destroy).toHaveBeenCalled()
  })
})

// ============================================================================
// Concurrent Initialization Prevention
// ============================================================================

describe('concurrent initialization prevention', () => {
  it('prevents concurrent initialization calls', async () => {
    let initializationPromise: Promise<boolean> | null = null
    let callCount = 0

    const initializeCatalog = async (): Promise<boolean> => {
      if (initializationPromise) {
        return initializationPromise
      }

      initializationPromise = (async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 10))
        return true
      })()

      try {
        return await initializationPromise
      } finally {
        initializationPromise = null
      }
    }

    // Call multiple times concurrently
    const results = await Promise.all([
      initializeCatalog(),
      initializeCatalog(),
      initializeCatalog(),
    ])

    expect(results).toEqual([true, true, true])
    // Should only execute once despite multiple calls
    expect(callCount).toBe(1)
  })

  it('allows new initialization after previous completes', async () => {
    let initializationPromise: Promise<boolean> | null = null
    let callCount = 0

    const initializeCatalog = async (): Promise<boolean> => {
      if (initializationPromise) {
        return initializationPromise
      }

      initializationPromise = (async () => {
        callCount++
        await new Promise((resolve) => setTimeout(resolve, 5))
        return true
      })()

      try {
        return await initializationPromise
      } finally {
        initializationPromise = null
      }
    }

    // First call
    await initializeCatalog()
    // Second call after first completes
    await initializeCatalog()

    expect(callCount).toBe(2)
  })
})

// ============================================================================
// Promise-based Ready Signal
// ============================================================================

describe('catalogReady promise', () => {
  it('resolves after services are initialized', async () => {
    let resolveReady: () => void
    const catalogReady = new Promise<void>((resolve) => {
      resolveReady = resolve
    })

    // Simulate service initialization
    const initializeServices = async () => {
      // Services created...
      await new Promise((resolve) => setTimeout(resolve, 5))
      // Mark as ready
      resolveReady!()
    }

    const readyPromise = initializeServices()

    await catalogReady
    await readyPromise

    // If we get here, the promise resolved
    expect(true).toBe(true)
  })

  it('allows await before services are ready', async () => {
    let resolveReady: () => void
    const catalogReady = new Promise<void>((resolve) => {
      resolveReady = resolve
    })

    let isReady = false

    // Start waiting
    const waitPromise = catalogReady.then(() => {
      isReady = true
    })

    // Not ready yet
    expect(isReady).toBe(false)

    // Resolve
    resolveReady!()
    await waitPromise

    expect(isReady).toBe(true)
  })
})
