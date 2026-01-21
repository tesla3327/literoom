/**
 * Test fixtures for the demo catalog.
 *
 * Provides utilities for creating test data in E2E and unit tests.
 */

import {
  createDemoAssets,
  createDemoAsset,
  getDemoFlagCounts,
  filterDemoAssetsByFlag,
  type DemoAssetOptions,
} from '@literoom/core/catalog'
import type { Asset, FlagStatus } from '@literoom/core/catalog'

/**
 * Default number of assets in the demo catalog.
 * Matches MockCatalogService default.
 */
export const DEMO_CATALOG_SIZE = 50

/**
 * Create a test catalog with optional overrides.
 *
 * @param overrides - Partial asset data to merge into generated assets
 * @returns Array of demo assets
 */
export function createTestCatalog(overrides?: Partial<Asset>[]): Asset[] {
  const assets = createDemoAssets({ count: DEMO_CATALOG_SIZE })
  if (overrides) {
    overrides.forEach((override, i) => {
      if (assets[i]) {
        Object.assign(assets[i], override)
      }
    })
  }
  return assets
}

/**
 * Create a small test catalog for quick tests.
 *
 * @param count - Number of assets (default: 10)
 * @param options - Additional demo asset options
 */
export function createSmallTestCatalog(
  count: number = 10,
  options?: Omit<DemoAssetOptions, 'count'>
): Asset[] {
  return createDemoAssets({ count, ...options })
}

/**
 * Find assets by flag status.
 *
 * @param assets - Array of assets to filter
 * @param flag - Flag status to filter by
 */
export function findAssetsByFlag(assets: Asset[], flag: FlagStatus): Asset[] {
  return filterDemoAssetsByFlag(assets, flag)
}

/**
 * Get expected flag counts for the default demo catalog.
 * Useful for assertions in tests.
 */
export function getExpectedFlagCounts(): {
  picks: number
  rejects: number
  unflagged: number
  total: number
} {
  const assets = createDemoAssets({ count: DEMO_CATALOG_SIZE })
  return getDemoFlagCounts(assets)
}

/**
 * Create a single asset with specific properties.
 * Useful for targeted test cases.
 */
export function createTestAsset(
  index: number = 0,
  overrides?: Partial<Asset>
): Asset {
  const asset = createDemoAsset(index)
  if (overrides) {
    Object.assign(asset, overrides)
  }
  return asset
}

/**
 * Demo image URLs for placeholder images.
 * These match the files in public/demo-images/
 */
export const DEMO_IMAGE_URLS = [
  '/demo-images/demo-0.jpg', // Blue
  '/demo-images/demo-1.jpg', // Green
  '/demo-images/demo-2.jpg', // Red
  '/demo-images/demo-3.jpg', // Gray
  '/demo-images/demo-4.jpg', // Purple
] as const

/**
 * Get a demo image URL based on index.
 * Cycles through available demo images.
 */
export function getDemoImageUrl(index: number): string {
  const idx = index % DEMO_IMAGE_URLS.length
  // idx is always valid since DEMO_IMAGE_URLS has 5 items and idx is 0-4
  return DEMO_IMAGE_URLS[idx] as string
}

// Re-export utilities from core for convenience
export {
  createDemoAssets,
  createDemoAsset,
  getDemoFlagCounts,
  filterDemoAssetsByFlag,
}
export type { DemoAssetOptions }
export type { Asset, FlagStatus }
