import { describe, expect, it } from 'vitest'
import {
  createDemoAsset,
  createDemoAssets,
  getDemoFlagCounts,
  filterDemoAssetsByFlag,
  type DemoAssetOptions,
} from './demo-assets'

describe('createDemoAsset', () => {
  it('creates an asset with all required fields', () => {
    const asset = createDemoAsset(0)

    expect(asset.id).toBe('demo-asset-0')
    expect(asset.folderId).toBe('demo-folder')
    expect(asset.filename).toBe('IMG_0001')
    expect(asset.thumbnailStatus).toBe('pending')
    expect(asset.thumbnailUrl).toBeNull()
  })

  it('generates deterministic assets based on index', () => {
    const asset1 = createDemoAsset(5)
    const asset2 = createDemoAsset(5)

    expect(asset1.id).toBe(asset2.id)
    expect(asset1.filename).toBe(asset2.filename)
    expect(asset1.extension).toBe(asset2.extension)
    expect(asset1.flag).toBe(asset2.flag)
    expect(asset1.fileSize).toBe(asset2.fileSize)
  })

  it('creates different assets for different indices', () => {
    const asset1 = createDemoAsset(0)
    const asset2 = createDemoAsset(10)

    expect(asset1.id).not.toBe(asset2.id)
    expect(asset1.filename).not.toBe(asset2.filename)
  })

  it('generates mix of jpg and arw extensions based on rawRate', () => {
    // With default rawRate of 0.25, we should get roughly 25% RAW files
    const assets = Array.from({ length: 100 }, (_, i) => createDemoAsset(i))
    const rawCount = assets.filter(a => a.extension === 'arw').length
    const jpgCount = assets.filter(a => a.extension === 'jpg').length

    // Allow some variance in the deterministic distribution
    expect(rawCount).toBeGreaterThan(10)
    expect(rawCount).toBeLessThan(40)
    expect(jpgCount).toBeGreaterThan(60)
  })

  it('sets larger file sizes for RAW files', () => {
    // Find an ARW asset
    const assets = Array.from({ length: 100 }, (_, i) => createDemoAsset(i))
    const rawAsset = assets.find(a => a.extension === 'arw')
    const jpgAsset = assets.find(a => a.extension === 'jpg')

    expect(rawAsset).toBeDefined()
    expect(jpgAsset).toBeDefined()
    expect(rawAsset!.fileSize).toBeGreaterThan(jpgAsset!.fileSize)
  })

  it('respects custom folderId option', () => {
    const asset = createDemoAsset(0, { folderId: 'custom-folder' })

    expect(asset.folderId).toBe('custom-folder')
  })

  it('respects custom thumbnailStatus option', () => {
    const asset = createDemoAsset(0, { thumbnailStatus: 'ready' })

    expect(asset.thumbnailStatus).toBe('ready')
  })

  it('generates captureDate within expected range', () => {
    const startDate = new Date(2026, 0, 1)
    const asset = createDemoAsset(15, { startDate })

    expect(asset.captureDate).toBeDefined()
    expect(asset.captureDate!.getTime()).toBeGreaterThanOrEqual(startDate.getTime())
    // Within ~30 days
    const maxDate = new Date(startDate)
    maxDate.setDate(maxDate.getDate() + 30)
    expect(asset.captureDate!.getTime()).toBeLessThan(maxDate.getTime())
  })

  it('sets dimensions based on file type', () => {
    const assets = Array.from({ length: 100 }, (_, i) => createDemoAsset(i))
    const rawAsset = assets.find(a => a.extension === 'arw')
    const jpgAsset = assets.find(a => a.extension === 'jpg')

    // RAW files have larger dimensions
    expect(rawAsset!.width).toBe(6000)
    expect(rawAsset!.height).toBe(4000)

    // JPEG files have smaller dimensions
    expect(jpgAsset!.width).toBe(4000)
    expect(jpgAsset!.height).toBe(3000)
  })
})

describe('createDemoAssets', () => {
  it('creates default of 50 assets', () => {
    const assets = createDemoAssets()

    expect(assets.length).toBe(50)
  })

  it('respects custom count option', () => {
    const assets = createDemoAssets({ count: 25 })

    expect(assets.length).toBe(25)
  })

  it('generates unique IDs for all assets', () => {
    const assets = createDemoAssets({ count: 100 })
    const ids = new Set(assets.map(a => a.id))

    expect(ids.size).toBe(100)
  })

  it('generates deterministic assets', () => {
    const assets1 = createDemoAssets({ count: 10 })
    const assets2 = createDemoAssets({ count: 10 })

    for (let i = 0; i < 10; i++) {
      expect(assets1[i].id).toBe(assets2[i].id)
      expect(assets1[i].flag).toBe(assets2[i].flag)
    }
  })

  it('creates assets with mixed flags', () => {
    const assets = createDemoAssets({ count: 100 })
    const picks = assets.filter(a => a.flag === 'pick')
    const rejects = assets.filter(a => a.flag === 'reject')
    const unflagged = assets.filter(a => a.flag === 'none')

    // Should have a mix of all flag types
    expect(picks.length).toBeGreaterThan(0)
    expect(rejects.length).toBeGreaterThan(0)
    expect(unflagged.length).toBeGreaterThan(0)
  })

  it('respects custom pickRate', () => {
    const assets = createDemoAssets({ count: 100, pickRate: 0.8, rejectRate: 0.1 })
    const picks = assets.filter(a => a.flag === 'pick')

    // With 80% pick rate, should have many picks
    expect(picks.length).toBeGreaterThan(50)
  })

  it('respects custom rejectRate', () => {
    const assets = createDemoAssets({ count: 100, pickRate: 0.1, rejectRate: 0.7 })
    const rejects = assets.filter(a => a.flag === 'reject')

    // With 70% reject rate, should have many rejects
    expect(rejects.length).toBeGreaterThan(40)
  })

  it('respects custom rawRate', () => {
    const assets = createDemoAssets({ count: 100, rawRate: 0.75 })
    const rawAssets = assets.filter(a => a.extension === 'arw')

    // With 75% raw rate, should have many RAW files
    expect(rawAssets.length).toBeGreaterThan(50)
  })
})

describe('getDemoFlagCounts', () => {
  it('returns correct counts for empty array', () => {
    const counts = getDemoFlagCounts([])

    expect(counts.picks).toBe(0)
    expect(counts.rejects).toBe(0)
    expect(counts.unflagged).toBe(0)
    expect(counts.total).toBe(0)
  })

  it('counts all flag types correctly', () => {
    const assets = createDemoAssets({ count: 100 })
    const counts = getDemoFlagCounts(assets)

    expect(counts.total).toBe(100)
    expect(counts.picks + counts.rejects + counts.unflagged).toBe(100)
  })

  it('returns correct counts for known distribution', () => {
    const assets = [
      createDemoAsset(0, { pickRate: 1, rejectRate: 0 }), // pick
      createDemoAsset(1, { pickRate: 1, rejectRate: 0 }), // pick
      createDemoAsset(2, { pickRate: 0, rejectRate: 1 }), // reject
    ]
    // Force set flags for deterministic test
    assets[0].flag = 'pick'
    assets[1].flag = 'pick'
    assets[2].flag = 'reject'

    const counts = getDemoFlagCounts(assets)

    expect(counts.picks).toBe(2)
    expect(counts.rejects).toBe(1)
    expect(counts.unflagged).toBe(0)
    expect(counts.total).toBe(3)
  })
})

describe('filterDemoAssetsByFlag', () => {
  it('filters picks correctly', () => {
    const assets = createDemoAssets({ count: 50 })
    const picks = filterDemoAssetsByFlag(assets, 'pick')

    expect(picks.every(a => a.flag === 'pick')).toBe(true)
  })

  it('filters rejects correctly', () => {
    const assets = createDemoAssets({ count: 50 })
    const rejects = filterDemoAssetsByFlag(assets, 'reject')

    expect(rejects.every(a => a.flag === 'reject')).toBe(true)
  })

  it('filters unflagged correctly', () => {
    const assets = createDemoAssets({ count: 50 })
    const unflagged = filterDemoAssetsByFlag(assets, 'none')

    expect(unflagged.every(a => a.flag === 'none')).toBe(true)
  })

  it('returns empty array for no matches', () => {
    // Create assets with only picks
    const assets = [
      { ...createDemoAsset(0), flag: 'pick' as const },
      { ...createDemoAsset(1), flag: 'pick' as const },
    ]
    const rejects = filterDemoAssetsByFlag(assets, 'reject')

    expect(rejects.length).toBe(0)
  })
})
