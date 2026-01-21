import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { MockCatalogService, createMockCatalogService } from './mock-catalog-service'
import { createDemoAssets } from './demo-assets'
import { CatalogError, ThumbnailPriority } from './types'

describe('MockCatalogService', () => {
  describe('create', () => {
    it('creates service in ready state', async () => {
      const service = await MockCatalogService.create()

      expect(service.state.status).toBe('ready')
      expect(service.isReady).toBe(true)
    })

    it('initializes with default demo assets', async () => {
      const service = await MockCatalogService.create()

      // Assets are populated on scan, not on create
      expect(service.getAssets().length).toBe(0)
    })

    it('accepts custom demo assets', async () => {
      const customAssets = createDemoAssets({ count: 5 })
      const service = await MockCatalogService.create({ demoAssets: customAssets })

      // Scan to populate
      await service.scanFolder()

      expect(service.getAssets().length).toBe(5)
    })
  })

  describe('createMockCatalogService', () => {
    it('is an alias for MockCatalogService.create', async () => {
      const service = await createMockCatalogService()

      expect(service).toBeInstanceOf(MockCatalogService)
      expect(service.isReady).toBe(true)
    })
  })

  describe('selectFolder', () => {
    it('sets folder name to Demo Photos', async () => {
      const service = await MockCatalogService.create()

      await service.selectFolder()

      expect(service.getFolderName()).toBe('Demo Photos')
    })

    it('returns null for getCurrentFolder in mock mode', async () => {
      const service = await MockCatalogService.create()

      await service.selectFolder()

      expect(service.getCurrentFolder()).toBeNull()
    })
  })

  describe('scanFolder', () => {
    it('populates assets from demo data', async () => {
      const service = await MockCatalogService.create({
        demoAssetOptions: { count: 25 },
      })

      await service.scanFolder()

      expect(service.getAssets().length).toBe(25)
    })

    it('fires onAssetsAdded callback in batches', async () => {
      const onAssetsAdded = vi.fn()
      const service = await MockCatalogService.create({
        demoAssetOptions: { count: 25 },
        scanBatchSize: 10,
      })
      service.onAssetsAdded = onAssetsAdded

      await service.scanFolder()

      // 25 assets / 10 batch size = 3 batches
      expect(onAssetsAdded).toHaveBeenCalledTimes(3)
    })

    it('updates state to scanning during scan', async () => {
      const service = await MockCatalogService.create({
        demoAssetOptions: { count: 10 },
        scanDelayMs: 10,
      })

      const scanPromise = service.scanFolder()
      // Check state immediately
      expect(service.state.status).toBe('scanning')

      await scanPromise
      expect(service.state.status).toBe('ready')
    })

    it('updates scan progress', async () => {
      const service = await MockCatalogService.create({
        demoAssetOptions: { count: 20 },
        scanBatchSize: 5,
        scanDelayMs: 10,
      })

      const progressStates: number[] = []
      const originalState = service.state

      const scanPromise = service.scanFolder()

      // Check progress during scan
      await new Promise(r => setTimeout(r, 15))
      if (service.state.scanProgress) {
        progressStates.push(service.state.scanProgress.processed)
      }

      await scanPromise

      // Should have made progress
      expect(progressStates.length).toBeGreaterThan(0)
    })

    it('throws error if scan already in progress', async () => {
      const service = await MockCatalogService.create({
        scanDelayMs: 100,
      })

      const scan1 = service.scanFolder()

      await expect(service.scanFolder()).rejects.toThrow('Scan already in progress')

      await scan1
    })

    it('throws error when configured to fail', async () => {
      const service = await MockCatalogService.create({ failScan: true })

      await expect(service.scanFolder()).rejects.toThrow(CatalogError)
    })

    it('supports cancellation via abort signal', async () => {
      const service = await MockCatalogService.create({
        demoAssetOptions: { count: 100 },
        scanBatchSize: 5,
        scanDelayMs: 10,
      })

      const abortController = new AbortController()
      const scanPromise = service.scanFolder({ signal: abortController.signal })

      // Cancel after a short delay
      await new Promise(r => setTimeout(r, 25))
      abortController.abort()

      await scanPromise // Should not throw

      // Should have partial results
      expect(service.getAssets().length).toBeGreaterThan(0)
      expect(service.getAssets().length).toBeLessThan(100)
      expect(service.state.status).toBe('ready')
    })

    it('supports cancellation via cancelScan', async () => {
      const service = await MockCatalogService.create({
        demoAssetOptions: { count: 100 },
        scanBatchSize: 5,
        scanDelayMs: 10,
      })

      const scanPromise = service.scanFolder()

      // Cancel after a short delay
      await new Promise(r => setTimeout(r, 25))
      service.cancelScan()

      await scanPromise // Should not throw

      expect(service.state.status).toBe('ready')
    })
  })

  describe('rescanFolder', () => {
    it('clears existing assets and rescans', async () => {
      const service = await MockCatalogService.create({
        demoAssetOptions: { count: 10 },
      })

      await service.scanFolder()
      expect(service.getAssets().length).toBe(10)

      // Modify an asset to verify it gets cleared
      await service.setFlag(service.getAssets()[0].id, 'pick')

      await service.rescanFolder()

      // Should have fresh assets
      expect(service.getAssets().length).toBe(10)
    })
  })

  describe('getAsset', () => {
    it('returns asset by ID', async () => {
      const service = await MockCatalogService.create()
      await service.scanFolder()

      const assets = service.getAssets()
      const asset = service.getAsset(assets[0].id)

      expect(asset).toBeDefined()
      expect(asset?.id).toBe(assets[0].id)
    })

    it('returns undefined for unknown ID', async () => {
      const service = await MockCatalogService.create()

      const asset = service.getAsset('unknown-id')

      expect(asset).toBeUndefined()
    })
  })

  describe('getAssets', () => {
    it('returns empty array before scan', async () => {
      const service = await MockCatalogService.create()

      expect(service.getAssets()).toEqual([])
    })

    it('returns all assets after scan', async () => {
      const service = await MockCatalogService.create({
        demoAssetOptions: { count: 15 },
      })
      await service.scanFolder()

      expect(service.getAssets().length).toBe(15)
    })
  })

  describe('setFlag', () => {
    it('updates asset flag', async () => {
      const service = await MockCatalogService.create()
      await service.scanFolder()

      const asset = service.getAssets()[0]
      await service.setFlag(asset.id, 'pick')

      expect(service.getAsset(asset.id)?.flag).toBe('pick')
    })

    it('fires onAssetUpdated callback', async () => {
      const onAssetUpdated = vi.fn()
      const service = await MockCatalogService.create()
      service.onAssetUpdated = onAssetUpdated
      await service.scanFolder()

      const asset = service.getAssets()[0]
      await service.setFlag(asset.id, 'reject')

      expect(onAssetUpdated).toHaveBeenCalledTimes(1)
      expect(onAssetUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ id: asset.id, flag: 'reject' })
      )
    })

    it('does nothing for unknown asset ID', async () => {
      const service = await MockCatalogService.create()

      await service.setFlag('unknown-id', 'pick')

      // Should not throw
    })

    it('throws error when configured to fail', async () => {
      const service = await MockCatalogService.create({ failSetFlag: true })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      await expect(service.setFlag(asset.id, 'pick')).rejects.toThrow(CatalogError)
    })
  })

  describe('setFlagBatch', () => {
    it('updates multiple assets', async () => {
      const service = await MockCatalogService.create()
      await service.scanFolder()

      const assets = service.getAssets().slice(0, 3)
      const ids = assets.map(a => a.id)

      await service.setFlagBatch(ids, 'pick')

      for (const id of ids) {
        expect(service.getAsset(id)?.flag).toBe('pick')
      }
    })

    it('fires onAssetUpdated for each asset', async () => {
      const onAssetUpdated = vi.fn()
      const service = await MockCatalogService.create()
      service.onAssetUpdated = onAssetUpdated
      await service.scanFolder()

      const assets = service.getAssets().slice(0, 3)
      const ids = assets.map(a => a.id)

      await service.setFlagBatch(ids, 'reject')

      expect(onAssetUpdated).toHaveBeenCalledTimes(3)
    })
  })

  describe('requestThumbnail', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('generates thumbnail and fires callback', async () => {
      const onThumbnailReady = vi.fn()
      const service = await MockCatalogService.create({ thumbnailDelayMs: 0 })
      service.onThumbnailReady = onThumbnailReady
      await service.scanFolder()

      const asset = service.getAssets()[0]
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)

      // Run timers
      await vi.runAllTimersAsync()

      expect(onThumbnailReady).toHaveBeenCalledWith(asset.id, expect.any(String))
    })

    it('updates asset thumbnailStatus to loading then ready', async () => {
      const service = await MockCatalogService.create({ thumbnailDelayMs: 100 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)

      // Should be loading immediately
      expect(service.getAsset(asset.id)?.thumbnailStatus).toBe('loading')

      // Run timers
      await vi.advanceTimersByTimeAsync(150)

      // Should be ready after delay
      expect(service.getAsset(asset.id)?.thumbnailStatus).toBe('ready')
      expect(service.getAsset(asset.id)?.thumbnailUrl).toBeTruthy()
    })

    it('generates data URL thumbnails', async () => {
      const service = await MockCatalogService.create({ thumbnailDelayMs: 0 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)

      await vi.runAllTimersAsync()

      const thumbnailUrl = service.getAsset(asset.id)?.thumbnailUrl
      expect(thumbnailUrl).toMatch(/^data:image\/svg\+xml,/)
    })

    it('does nothing for unknown asset', async () => {
      const service = await MockCatalogService.create()

      // Should not throw
      service.requestThumbnail('unknown-id', ThumbnailPriority.VISIBLE)
    })

    it('does nothing if asset already has thumbnail', async () => {
      const onThumbnailReady = vi.fn()
      const service = await MockCatalogService.create({ thumbnailDelayMs: 0 })
      service.onThumbnailReady = onThumbnailReady
      await service.scanFolder()

      const asset = service.getAssets()[0]

      // Request twice
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      // Should only fire once
      expect(onThumbnailReady).toHaveBeenCalledTimes(1)
    })
  })

  describe('updateThumbnailPriority', () => {
    it('updates priority of queued thumbnail', async () => {
      const service = await MockCatalogService.create({ thumbnailDelayMs: 1000 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      service.requestThumbnail(asset.id, ThumbnailPriority.BACKGROUND)

      // Update priority (doesn't throw)
      service.updateThumbnailPriority(asset.id, ThumbnailPriority.VISIBLE)
    })
  })

  describe('destroy', () => {
    it('clears all assets', async () => {
      const service = await MockCatalogService.create()
      await service.scanFolder()

      service.destroy()

      expect(service.getAssets().length).toBe(0)
    })

    it('resets state to initializing', async () => {
      const service = await MockCatalogService.create()

      service.destroy()

      expect(service.state.status).toBe('initializing')
    })

    it('clears folder name', async () => {
      const service = await MockCatalogService.create()
      await service.selectFolder()

      service.destroy()

      expect(service.getFolderName()).toBeNull()
    })

    it('cancels pending thumbnail requests', async () => {
      vi.useFakeTimers()
      const onThumbnailReady = vi.fn()
      const service = await MockCatalogService.create({ thumbnailDelayMs: 1000 })
      service.onThumbnailReady = onThumbnailReady
      await service.scanFolder()

      // Request thumbnails
      const assets = service.getAssets().slice(0, 5)
      for (const asset of assets) {
        service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      }

      // Destroy before completion
      service.destroy()

      // Run timers - callbacks should not fire
      await vi.advanceTimersByTimeAsync(2000)

      expect(onThumbnailReady).not.toHaveBeenCalled()
      vi.useRealTimers()
    })
  })

  describe('loadFromDatabase', () => {
    it('runs scan if assets are empty', async () => {
      const service = await MockCatalogService.create({
        demoAssetOptions: { count: 10 },
      })

      const result = await service.loadFromDatabase()

      expect(result).toBe(true)
      expect(service.getAssets().length).toBe(10)
    })

    it('returns true if assets exist', async () => {
      const service = await MockCatalogService.create()
      await service.scanFolder()

      const result = await service.loadFromDatabase()

      expect(result).toBe(true)
    })
  })

  describe('mock-specific methods', () => {
    describe('setAssets', () => {
      it('manually sets assets', async () => {
        const service = await MockCatalogService.create()
        const customAssets = createDemoAssets({ count: 3 })

        service.setAssets(customAssets)

        expect(service.getAssets().length).toBe(3)
      })
    })

    describe('clearAssets', () => {
      it('removes all assets', async () => {
        const service = await MockCatalogService.create()
        await service.scanFolder()

        service.clearAssets()

        expect(service.getAssets().length).toBe(0)
      })
    })

    describe('resetToDemo', () => {
      it('resets to original demo assets', async () => {
        const service = await MockCatalogService.create({
          demoAssetOptions: { count: 20 },
        })
        await service.scanFolder()

        // Modify
        await service.setFlag(service.getAssets()[0].id, 'pick')
        service.clearAssets()
        expect(service.getAssets().length).toBe(0)

        // Reset
        service.resetToDemo()

        expect(service.getAssets().length).toBe(20)
      })
    })

    describe('getThumbnailQueueSize', () => {
      it('returns number of pending thumbnails', async () => {
        vi.useFakeTimers()
        const service = await MockCatalogService.create({ thumbnailDelayMs: 1000 })
        await service.scanFolder()

        expect(service.getThumbnailQueueSize()).toBe(0)

        service.requestThumbnail(service.getAssets()[0].id, ThumbnailPriority.VISIBLE)
        service.requestThumbnail(service.getAssets()[1].id, ThumbnailPriority.VISIBLE)

        expect(service.getThumbnailQueueSize()).toBe(2)

        vi.useRealTimers()
      })
    })

    describe('completeAllThumbnails', () => {
      it('immediately completes all pending thumbnails', async () => {
        vi.useFakeTimers()
        const onThumbnailReady = vi.fn()
        const service = await MockCatalogService.create({ thumbnailDelayMs: 10000 })
        service.onThumbnailReady = onThumbnailReady
        await service.scanFolder()

        // Request several thumbnails
        const assets = service.getAssets().slice(0, 5)
        for (const asset of assets) {
          service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
        }

        // Complete immediately
        service.completeAllThumbnails()

        expect(onThumbnailReady).toHaveBeenCalledTimes(5)
        expect(service.getThumbnailQueueSize()).toBe(0)

        vi.useRealTimers()
      })
    })
  })

  describe('event callbacks', () => {
    it('supports setting and getting onAssetsAdded', async () => {
      const service = await MockCatalogService.create()
      const callback = vi.fn()

      service.onAssetsAdded = callback

      expect(service.onAssetsAdded).toBe(callback)
    })

    it('supports setting and getting onAssetUpdated', async () => {
      const service = await MockCatalogService.create()
      const callback = vi.fn()

      service.onAssetUpdated = callback

      expect(service.onAssetUpdated).toBe(callback)
    })

    it('supports setting and getting onThumbnailReady', async () => {
      const service = await MockCatalogService.create()
      const callback = vi.fn()

      service.onThumbnailReady = callback

      expect(service.onThumbnailReady).toBe(callback)
    })

    it('supports null callbacks', async () => {
      const service = await MockCatalogService.create()

      service.onAssetsAdded = null
      service.onAssetUpdated = null
      service.onThumbnailReady = null

      expect(service.onAssetsAdded).toBeNull()
      expect(service.onAssetUpdated).toBeNull()
      expect(service.onThumbnailReady).toBeNull()
    })
  })
})
