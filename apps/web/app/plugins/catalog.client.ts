/**
 * Catalog Service Plugin - client-side only.
 *
 * Creates the CatalogService instance (real or mock based on demo mode)
 * and wires callbacks to Pinia stores for reactive updates.
 *
 * IMPORTANT: This plugin is async and provides a `$catalogReady` promise
 * that components/middleware can await to ensure services are initialized.
 */
import type { ICatalogService } from '@literoom/core/catalog'
import type { IDecodeService } from '@literoom/core/decode'

export default defineNuxtPlugin(async (nuxtApp) => {
  const config = useRuntimeConfig()
  const isDemoMode = config.public.demoMode

  // Create a promise that resolves when services are ready
  // This is exposed as $catalogReady for middleware/components to await
  let resolveReady: () => void
  const catalogReady = new Promise<void>((resolve) => {
    resolveReady = resolve
  })

  // Immediately provide the ready promise so it's available during SSR/early hydration
  nuxtApp.provide('catalogReady', catalogReady)

  // Get stores for callback wiring
  const catalogStore = useCatalogStore()

  let catalogService: ICatalogService
  let decodeService: IDecodeService

  if (isDemoMode) {
    // Demo mode: use mock services
    const { MockCatalogService } = await import('@literoom/core/catalog')
    const { MockDecodeService } = await import('@literoom/core/decode')

    decodeService = await MockDecodeService.create()
    catalogService = await MockCatalogService.create({
      thumbnailDelayMs: 50, // Small delay for visual feedback
    })
  }
  else {
    // Real mode: use actual services
    const { CatalogService } = await import('@literoom/core/catalog')
    const { DecodeService } = await import('@literoom/core/decode')

    decodeService = await DecodeService.create()
    catalogService = await CatalogService.create(decodeService)
  }

  // Wire callbacks to update stores
  catalogService.onAssetsAdded = (assets) => {
    catalogStore.addAssetBatch(assets)
  }

  catalogService.onAssetUpdated = (asset) => {
    catalogStore.updateAsset(asset.id, asset)
  }

  catalogService.onThumbnailReady = (assetId, url) => {
    catalogStore.updateThumbnail(assetId, 'ready', url)
  }

  // Cleanup on page unload
  if (import.meta.client) {
    window.addEventListener('beforeunload', () => {
      catalogService.destroy()
      decodeService.destroy()
    })
  }

  // Mark services as ready
  resolveReady!()

  return {
    provide: {
      catalogService,
      decodeService,
      isDemoMode,
    },
  }
})
