/**
 * Demo Assets Factory
 *
 * Creates deterministic demo assets for testing and demo mode.
 * Used by MockCatalogService and E2E tests to provide consistent test data.
 */

import type { Asset, FlagStatus, ThumbnailStatus } from './types'

/**
 * Options for generating demo assets.
 */
export interface DemoAssetOptions {
  /** Number of assets to generate (default: 50) */
  count?: number
  /** Proportion of assets flagged as picks (0-1, default: 0.4) */
  pickRate?: number
  /** Proportion of assets flagged as rejects (0-1, default: 0.2) */
  rejectRate?: number
  /** Proportion of RAW (ARW) files vs JPEG (0-1, default: 0.25) */
  rawRate?: number
  /** Starting date for capture dates (default: 2026-01-01) */
  startDate?: Date
  /** Folder ID for all assets (default: 'demo-folder') */
  folderId?: string
  /** Initial thumbnail status (default: 'pending') */
  thumbnailStatus?: ThumbnailStatus
}

/**
 * Default options for demo asset generation.
 */
const DEFAULT_OPTIONS: Required<DemoAssetOptions> = {
  count: 50,
  pickRate: 0.4,
  rejectRate: 0.2,
  rawRate: 0.25,
  startDate: new Date(2026, 0, 1),
  folderId: 'demo-folder',
  thumbnailStatus: 'pending',
}

/**
 * Generate a deterministic flag status based on index.
 */
function generateFlag(
  index: number,
  pickRate: number,
  rejectRate: number
): FlagStatus {
  // Use a simple deterministic distribution based on index
  const normalized = (index * 7) % 100 / 100 // Spread distribution across indices

  if (normalized < pickRate) {
    return 'pick'
  } else if (normalized < pickRate + rejectRate) {
    return 'reject'
  }
  return 'none'
}

/**
 * Generate a deterministic file extension based on index.
 */
function generateExtension(index: number, rawRate: number): string {
  // Use a simple deterministic pattern
  const normalized = (index * 3) % 100 / 100
  return normalized < rawRate ? 'arw' : 'jpg'
}

/**
 * Generate a deterministic file size in bytes.
 * RAW files are larger (15-30MB), JPEGs are smaller (2-8MB).
 */
function generateFileSize(index: number, isRaw: boolean): number {
  const baseSeed = (index * 13) % 100
  if (isRaw) {
    // RAW: 15MB - 30MB
    return 15_000_000 + baseSeed * 150_000
  }
  // JPEG: 2MB - 8MB
  return 2_000_000 + baseSeed * 60_000
}

/**
 * Generate a capture date offset in days from the start date.
 */
function generateCaptureDateOffset(index: number): number {
  // Spread captures across ~30 days
  return (index * 17) % 30
}

/**
 * Create a single demo asset.
 *
 * @param index - Zero-based index for deterministic generation
 * @param options - Generation options
 * @returns A demo Asset
 */
export function createDemoAsset(
  index: number,
  options: DemoAssetOptions = {}
): Asset {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  const extension = generateExtension(index, opts.rawRate)
  const isRaw = extension === 'arw'
  const flag = generateFlag(index, opts.pickRate, opts.rejectRate)
  const fileSize = generateFileSize(index, isRaw)

  const captureDate = new Date(opts.startDate)
  captureDate.setDate(captureDate.getDate() + generateCaptureDateOffset(index))
  captureDate.setHours((index * 3) % 24, (index * 7) % 60, 0, 0)

  const filename = `IMG_${String(index + 1).padStart(4, '0')}`

  return {
    id: `demo-asset-${index}`,
    folderId: opts.folderId,
    path: `${filename}.${extension}`,
    filename,
    extension,
    flag,
    captureDate,
    modifiedDate: new Date(),
    fileSize,
    width: isRaw ? 6000 : 4000,
    height: isRaw ? 4000 : 3000,
    thumbnailStatus: opts.thumbnailStatus,
    thumbnailUrl: null,
  }
}

/**
 * Create an array of demo assets.
 *
 * @param options - Generation options
 * @returns Array of demo Assets
 */
export function createDemoAssets(options: DemoAssetOptions = {}): Asset[] {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  return Array.from({ length: opts.count }, (_, i) => createDemoAsset(i, opts))
}

/**
 * Get flag distribution from demo assets.
 * Useful for verifying expected counts in tests.
 */
export function getDemoFlagCounts(assets: Asset[]): {
  picks: number
  rejects: number
  unflagged: number
  total: number
} {
  const counts = {
    picks: 0,
    rejects: 0,
    unflagged: 0,
    total: assets.length,
  }

  for (const asset of assets) {
    switch (asset.flag) {
      case 'pick':
        counts.picks++
        break
      case 'reject':
        counts.rejects++
        break
      default:
        counts.unflagged++
    }
  }

  return counts
}

/**
 * Find assets by flag status.
 */
export function filterDemoAssetsByFlag(
  assets: Asset[],
  flag: FlagStatus
): Asset[] {
  return assets.filter((a) => a.flag === flag)
}
