import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { MockCatalogService, createMockCatalogService } from './mock-catalog-service'
import { createDemoAssets } from './demo-assets'
import { CatalogError, ThumbnailPriority } from './types'
import type { EditedThumbnailEditState } from '../decode/worker-messages'

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

    it('throws error when configured to fail', async () => {
      const service = await MockCatalogService.create({ failSetFlag: true })
      await service.scanFolder()

      const assets = service.getAssets().slice(0, 3)
      const ids = assets.map(a => a.id)

      await expect(service.setFlagBatch(ids, 'pick')).rejects.toThrow(CatalogError)
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

    it('generates different thumbnails for different asset indices', async () => {
      const service = await MockCatalogService.create({
        thumbnailDelayMs: 0,
        demoAssetOptions: { count: 10 },
      })
      await service.scanFolder()

      const assets = service.getAssets()

      // Request thumbnails for first few assets
      service.requestThumbnail(assets[0].id, ThumbnailPriority.VISIBLE)
      service.requestThumbnail(assets[1].id, ThumbnailPriority.VISIBLE)
      service.requestThumbnail(assets[2].id, ThumbnailPriority.VISIBLE)

      await vi.runAllTimersAsync()

      const thumbnail0 = service.getAsset(assets[0].id)?.thumbnailUrl
      const thumbnail1 = service.getAsset(assets[1].id)?.thumbnailUrl
      const thumbnail2 = service.getAsset(assets[2].id)?.thumbnailUrl

      // All should be data URLs
      expect(thumbnail0).toMatch(/^data:image\/svg\+xml,/)
      expect(thumbnail1).toMatch(/^data:image\/svg\+xml,/)
      expect(thumbnail2).toMatch(/^data:image\/svg\+xml,/)

      // Each should be unique (different patterns based on index)
      expect(thumbnail0).not.toBe(thumbnail1)
      expect(thumbnail1).not.toBe(thumbnail2)
      expect(thumbnail0).not.toBe(thumbnail2)
    })

    it('uses green color for pick flag in thumbnails', async () => {
      const service = await MockCatalogService.create({ thumbnailDelayMs: 0 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      await service.setFlag(asset.id, 'pick')

      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      const thumbnailUrl = service.getAsset(asset.id)?.thumbnailUrl
      expect(thumbnailUrl).toBeDefined()
      // Decode the URL-encoded SVG and check for green color
      const decodedSvg = decodeURIComponent(thumbnailUrl!.replace('data:image/svg+xml,', ''))
      expect(decodedSvg).toContain('#22c55e') // Green for pick
    })

    it('uses red color for reject flag in thumbnails', async () => {
      const service = await MockCatalogService.create({ thumbnailDelayMs: 0 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      await service.setFlag(asset.id, 'reject')

      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      const thumbnailUrl = service.getAsset(asset.id)?.thumbnailUrl
      expect(thumbnailUrl).toBeDefined()
      // Decode the URL-encoded SVG and check for red color
      const decodedSvg = decodeURIComponent(thumbnailUrl!.replace('data:image/svg+xml,', ''))
      expect(decodedSvg).toContain('#ef4444') // Red for reject
    })

    it('uses blue color for unflagged assets in thumbnails', async () => {
      const service = await MockCatalogService.create({ thumbnailDelayMs: 0 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      // Explicitly set flag to 'none' (demo assets may have varied flags based on index)
      await service.setFlag(asset.id, 'none')

      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      const thumbnailUrl = service.getAsset(asset.id)?.thumbnailUrl
      expect(thumbnailUrl).toBeDefined()
      // Decode the URL-encoded SVG and check for blue color
      const decodedSvg = decodeURIComponent(thumbnailUrl!.replace('data:image/svg+xml,', ''))
      expect(decodedSvg).toContain('#3b82f6') // Blue for unflagged
    })

    it('generates thumbnails with different colors based on flag status', async () => {
      const service = await MockCatalogService.create({
        thumbnailDelayMs: 0,
        demoAssetOptions: { count: 3 },
      })
      await service.scanFolder()

      const assets = service.getAssets()
      // Explicitly set different flags on assets
      await service.setFlag(assets[0].id, 'pick')
      await service.setFlag(assets[1].id, 'reject')
      await service.setFlag(assets[2].id, 'none') // Explicitly set to unflagged

      // Request all thumbnails
      service.requestThumbnail(assets[0].id, ThumbnailPriority.VISIBLE)
      service.requestThumbnail(assets[1].id, ThumbnailPriority.VISIBLE)
      service.requestThumbnail(assets[2].id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      const pickThumbnail = service.getAsset(assets[0].id)?.thumbnailUrl
      const rejectThumbnail = service.getAsset(assets[1].id)?.thumbnailUrl
      const unflaggedThumbnail = service.getAsset(assets[2].id)?.thumbnailUrl

      // Decode SVGs
      const pickSvg = decodeURIComponent(pickThumbnail!.replace('data:image/svg+xml,', ''))
      const rejectSvg = decodeURIComponent(rejectThumbnail!.replace('data:image/svg+xml,', ''))
      const unflaggedSvg = decodeURIComponent(unflaggedThumbnail!.replace('data:image/svg+xml,', ''))

      // Verify each contains the correct color
      expect(pickSvg).toContain('#22c55e')
      expect(rejectSvg).toContain('#ef4444')
      expect(unflaggedSvg).toContain('#3b82f6')

      // Verify colors are exclusive (pick doesn't have reject color, etc.)
      expect(pickSvg).not.toContain('#ef4444')
      expect(rejectSvg).not.toContain('#22c55e')
    })

    it('does nothing if request already in queue', async () => {
      const onThumbnailReady = vi.fn()
      const service = await MockCatalogService.create({ thumbnailDelayMs: 1000 })
      service.onThumbnailReady = onThumbnailReady
      await service.scanFolder()

      const asset = service.getAssets()[0]

      // Request twice before completion
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)

      // Queue should only have one entry
      expect(service.getThumbnailQueueSize()).toBe(1)

      // Run timers
      await vi.runAllTimersAsync()

      // Should only fire once
      expect(onThumbnailReady).toHaveBeenCalledTimes(1)
    })
  })

  describe('requestPreview', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('generates preview and fires onPreviewReady callback', async () => {
      const onPreviewReady = vi.fn()
      const service = await MockCatalogService.create({ previewDelayMs: 0 })
      service.onPreviewReady = onPreviewReady
      await service.scanFolder()

      const asset = service.getAssets()[0]
      service.requestPreview(asset.id, ThumbnailPriority.VISIBLE)

      // Run timers
      await vi.runAllTimersAsync()

      expect(onPreviewReady).toHaveBeenCalledWith(asset.id, expect.any(String))
    })

    it('updates asset preview1xStatus to loading then ready', async () => {
      const service = await MockCatalogService.create({ previewDelayMs: 100 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      service.requestPreview(asset.id, ThumbnailPriority.VISIBLE)

      // Should be loading immediately
      expect(service.getAsset(asset.id)?.preview1xStatus).toBe('loading')

      // Run timers
      await vi.advanceTimersByTimeAsync(150)

      // Should be ready after delay
      expect(service.getAsset(asset.id)?.preview1xStatus).toBe('ready')
      expect(service.getAsset(asset.id)?.preview1xUrl).toBeTruthy()
    })

    it('generates data URL previews (larger size than thumbnails)', async () => {
      const service = await MockCatalogService.create({ previewDelayMs: 0, thumbnailDelayMs: 0 })
      await service.scanFolder()

      const asset = service.getAssets()[0]

      // Request both thumbnail and preview
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      service.requestPreview(asset.id, ThumbnailPriority.VISIBLE)

      await vi.runAllTimersAsync()

      const thumbnailUrl = service.getAsset(asset.id)?.thumbnailUrl
      const previewUrl = service.getAsset(asset.id)?.preview1xUrl

      // Both should be data URLs
      expect(thumbnailUrl).toMatch(/^data:image\/svg\+xml,/)
      expect(previewUrl).toMatch(/^data:image\/svg\+xml,/)

      // Preview should have larger dimensions (512 vs 256)
      expect(previewUrl).toContain('width%3D%22512%22')
      expect(thumbnailUrl).toContain('width%3D%22256%22')
    })

    it('does nothing for unknown asset', async () => {
      const onPreviewReady = vi.fn()
      const service = await MockCatalogService.create()
      service.onPreviewReady = onPreviewReady

      // Should not throw
      service.requestPreview('unknown-id', ThumbnailPriority.VISIBLE)

      await vi.runAllTimersAsync()

      expect(onPreviewReady).not.toHaveBeenCalled()
    })

    it('does nothing if asset already has preview (no duplicate requests)', async () => {
      const onPreviewReady = vi.fn()
      const service = await MockCatalogService.create({ previewDelayMs: 0 })
      service.onPreviewReady = onPreviewReady
      await service.scanFolder()

      const asset = service.getAssets()[0]

      // Request twice
      service.requestPreview(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()
      service.requestPreview(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      // Should only fire once
      expect(onPreviewReady).toHaveBeenCalledTimes(1)
    })

    it('does nothing if request already in queue', async () => {
      const onPreviewReady = vi.fn()
      const service = await MockCatalogService.create({ previewDelayMs: 1000 })
      service.onPreviewReady = onPreviewReady
      await service.scanFolder()

      const asset = service.getAssets()[0]

      // Request twice before completion
      service.requestPreview(asset.id, ThumbnailPriority.VISIBLE)
      service.requestPreview(asset.id, ThumbnailPriority.VISIBLE)

      // Run timers
      await vi.runAllTimersAsync()

      // Should only fire once
      expect(onPreviewReady).toHaveBeenCalledTimes(1)
    })
  })

  describe('updatePreviewPriority', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('updates priority of queued preview request', async () => {
      const service = await MockCatalogService.create({ previewDelayMs: 1000 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      service.requestPreview(asset.id, ThumbnailPriority.BACKGROUND)

      // Update priority (doesn't throw)
      service.updatePreviewPriority(asset.id, ThumbnailPriority.VISIBLE)

      // Should complete successfully
      await vi.runAllTimersAsync()

      expect(service.getAsset(asset.id)?.preview1xStatus).toBe('ready')
    })

    it('does nothing for non-queued asset (does not throw)', async () => {
      const service = await MockCatalogService.create({ previewDelayMs: 1000 })
      await service.scanFolder()

      const asset = service.getAssets()[0]

      // Update priority without requesting preview first - should not throw
      service.updatePreviewPriority(asset.id, ThumbnailPriority.VISIBLE)

      // Also try with unknown asset
      service.updatePreviewPriority('unknown-id', ThumbnailPriority.VISIBLE)
    })
  })

  describe('onPreviewReady callback', () => {
    it('supports setting and getting onPreviewReady', async () => {
      const service = await MockCatalogService.create()
      const callback = vi.fn()

      service.onPreviewReady = callback

      expect(service.onPreviewReady).toBe(callback)
    })

    it('supports null callback', async () => {
      const service = await MockCatalogService.create()

      service.onPreviewReady = null

      expect(service.onPreviewReady).toBeNull()
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

  describe('regenerateThumbnail', () => {
    const mockEditState: EditedThumbnailEditState = {}

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('sets thumbnail status to loading and clears old URL', async () => {
      const service = await MockCatalogService.create({ thumbnailDelayMs: 100 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      // First generate a thumbnail
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      // Verify thumbnail is ready
      expect(service.getAsset(asset.id)?.thumbnailStatus).toBe('ready')
      expect(service.getAsset(asset.id)?.thumbnailUrl).toBeTruthy()

      // Start regeneration (don't await yet)
      const regeneratePromise = service.regenerateThumbnail(asset.id, mockEditState)

      // Status should be loading and URL should be cleared
      expect(service.getAsset(asset.id)?.thumbnailStatus).toBe('loading')
      expect(service.getAsset(asset.id)?.thumbnailUrl).toBeNull()

      await vi.runAllTimersAsync()
      await regeneratePromise
    })

    it('fires onAssetUpdated callback when status changes to loading', async () => {
      const onAssetUpdated = vi.fn()
      const service = await MockCatalogService.create({ thumbnailDelayMs: 100 })
      service.onAssetUpdated = onAssetUpdated
      await service.scanFolder()

      const asset = service.getAssets()[0]
      // First generate a thumbnail
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      // Clear mock to only track regenerate calls
      onAssetUpdated.mockClear()

      // Start regeneration
      const regeneratePromise = service.regenerateThumbnail(asset.id, mockEditState)

      // Should have fired callback with loading status
      expect(onAssetUpdated).toHaveBeenCalledTimes(1)
      expect(onAssetUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ id: asset.id, thumbnailStatus: 'loading', thumbnailUrl: null })
      )

      await vi.runAllTimersAsync()
      await regeneratePromise
    })

    it('schedules new thumbnail generation', async () => {
      const service = await MockCatalogService.create({ thumbnailDelayMs: 100 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      // First generate a thumbnail
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      // Regenerate
      const regeneratePromise = service.regenerateThumbnail(asset.id, mockEditState)

      // Should be in the thumbnail queue
      expect(service.getThumbnailQueueSize()).toBe(1)

      await vi.runAllTimersAsync()
      await regeneratePromise
    })

    it('completes and generates new thumbnail', async () => {
      const service = await MockCatalogService.create({ thumbnailDelayMs: 100 })
      await service.scanFolder()

      const asset = service.getAssets()[0]
      // First generate a thumbnail
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      // Regenerate
      const regeneratePromise = service.regenerateThumbnail(asset.id, mockEditState)

      // Run timers to complete
      await vi.advanceTimersByTimeAsync(150)
      await regeneratePromise

      // Should be ready with new thumbnail
      expect(service.getAsset(asset.id)?.thumbnailStatus).toBe('ready')
      expect(service.getAsset(asset.id)?.thumbnailUrl).toBeTruthy()
      expect(service.getThumbnailQueueSize()).toBe(0)
    })

    it('fires onThumbnailReady callback when complete', async () => {
      const onThumbnailReady = vi.fn()
      const service = await MockCatalogService.create({ thumbnailDelayMs: 100 })
      service.onThumbnailReady = onThumbnailReady
      await service.scanFolder()

      const asset = service.getAssets()[0]
      // First generate a thumbnail
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)
      await vi.runAllTimersAsync()

      // Clear mock to only track regenerate calls
      onThumbnailReady.mockClear()

      // Regenerate
      const regeneratePromise = service.regenerateThumbnail(asset.id, mockEditState)

      // Run timers to complete
      await vi.advanceTimersByTimeAsync(150)
      await regeneratePromise

      expect(onThumbnailReady).toHaveBeenCalledTimes(1)
      expect(onThumbnailReady).toHaveBeenCalledWith(asset.id, expect.any(String))
    })

    it('does nothing for unknown asset', async () => {
      const onAssetUpdated = vi.fn()
      const service = await MockCatalogService.create({ thumbnailDelayMs: 100 })
      service.onAssetUpdated = onAssetUpdated

      // Regenerate for unknown asset
      await service.regenerateThumbnail('unknown-id', mockEditState)

      // Should not have called any callbacks
      expect(onAssetUpdated).not.toHaveBeenCalled()
      expect(service.getThumbnailQueueSize()).toBe(0)
    })

    it('cancels existing thumbnail request if one is pending', async () => {
      const onThumbnailReady = vi.fn()
      const service = await MockCatalogService.create({ thumbnailDelayMs: 200 })
      service.onThumbnailReady = onThumbnailReady
      await service.scanFolder()

      const asset = service.getAssets()[0]
      // Start initial thumbnail request
      service.requestThumbnail(asset.id, ThumbnailPriority.VISIBLE)

      // Advance partially
      await vi.advanceTimersByTimeAsync(50)
      expect(service.getThumbnailQueueSize()).toBe(1)

      // Regenerate before first completes (this should cancel the pending request)
      const regeneratePromise = service.regenerateThumbnail(asset.id, mockEditState)

      // Still one item in queue (the new regeneration request)
      expect(service.getThumbnailQueueSize()).toBe(1)

      // Advance to when the original would have completed (but should be cancelled)
      await vi.advanceTimersByTimeAsync(200)
      await regeneratePromise

      // Should only fire once (from regenerate, not from original request)
      expect(onThumbnailReady).toHaveBeenCalledTimes(1)
      expect(service.getAsset(asset.id)?.thumbnailStatus).toBe('ready')
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

    it('cancels pending preview requests', async () => {
      vi.useFakeTimers()
      const onPreviewReady = vi.fn()
      const service = await MockCatalogService.create({ previewDelayMs: 1000 })
      service.onPreviewReady = onPreviewReady
      await service.scanFolder()

      // Request previews
      const assets = service.getAssets().slice(0, 5)
      for (const asset of assets) {
        service.requestPreview(asset.id, ThumbnailPriority.VISIBLE)
      }

      // Destroy before completion
      service.destroy()

      // Run timers - callbacks should not fire
      await vi.advanceTimersByTimeAsync(2000)

      expect(onPreviewReady).not.toHaveBeenCalled()
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

  describe('listFolders', () => {
    it('returns empty array (mock mode has no persisted folders)', async () => {
      const service = await MockCatalogService.create()

      const folders = await service.listFolders()

      expect(folders).toEqual([])
    })

    it('accepts limit parameter without error', async () => {
      const service = await MockCatalogService.create()

      const folders = await service.listFolders(10)

      expect(folders).toEqual([])
    })

    it('uses default limit when not specified', async () => {
      const service = await MockCatalogService.create()

      // Call without limit parameter - should use default of 5
      const folders = await service.listFolders()

      expect(folders).toEqual([])
    })
  })

  describe('loadFolderById', () => {
    it('returns false (mock mode does not support loading specific folders)', async () => {
      const service = await MockCatalogService.create()

      const result = await service.loadFolderById(1)

      expect(result).toBe(false)
    })

    it('accepts folderId parameter without error', async () => {
      const service = await MockCatalogService.create()

      const result = await service.loadFolderById(999)

      expect(result).toBe(false)
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
