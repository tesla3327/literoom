/**
 * Catalog Service Plugin - client-side only.
 *
 * Creates the CatalogService instance (real or mock based on demo mode)
 * and wires callbacks to Pinia stores for reactive updates.
 *
 * IMPORTANT: This plugin is async and provides a `$catalogReady` promise
 * that components/middleware can await to ensure services are initialized.
 *
 * It also provides `$initializeCatalog()` which middleware can call to
 * ensure catalog data is loaded before allowing navigation to edit pages.
 *
 * GPU Acceleration:
 * The plugin also initializes the GPU capability service for optional
 * WebGPU-based image processing acceleration.
 */
import type { ICatalogService } from '@literoom/core/catalog'
import type { IDecodeService } from '@literoom/core/decode'
import type { AdaptiveProcessor, GPUCapabilities } from '@literoom/core'
import { useGpuStatusStore } from '~/stores/gpuStatus'

// Type augmentation for the provided functions
declare module '#app' {
  interface NuxtApp {
    $catalogReady: Promise<void>
    $catalogService: ICatalogService
    $decodeService: IDecodeService
    $isDemoMode: boolean
    $initializeCatalog: () => Promise<boolean>
    $gpuProcessor: AdaptiveProcessor
    $gpuCapabilities: GPUCapabilities
  }
}

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

  // Initialize GPU acceleration (non-blocking)
  const { getAdaptiveProcessor, DEFAULT_GPU_CAPABILITIES } = await import('@literoom/core')
  const gpuProcessor = getAdaptiveProcessor()
  let gpuCapabilities = DEFAULT_GPU_CAPABILITIES

  // Initialize GPU in background - don't block plugin initialization
  gpuProcessor.initialize().then(() => {
    gpuCapabilities = gpuProcessor.state.capabilities
    const backend = gpuProcessor.state.activeBackend
    console.log(`[catalog.client] GPU initialized: backend=${backend}, available=${gpuCapabilities.available}`)
    if (gpuCapabilities.available && gpuCapabilities.adapterInfo) {
      console.log(`[catalog.client] GPU: ${gpuCapabilities.adapterInfo.vendor} ${gpuCapabilities.adapterInfo.device}`)
    }

    // Update GPU status store
    const gpuStatus = useGpuStatusStore()
    if (gpuCapabilities.available) {
      const deviceName = gpuCapabilities.adapterInfo?.device || 'WebGPU'
      gpuStatus.setAvailable(true, deviceName)
    }
    else {
      gpuStatus.setAvailable(false)
    }
  }).catch((err: unknown) => {
    console.warn('[catalog.client] GPU initialization failed (using WASM):', err)

    // Update GPU status store with error
    const gpuStatus = useGpuStatusStore()
    const errorMessage = err instanceof Error ? err.message : String(err)
    gpuStatus.setError(errorMessage)
  })

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
    // Real mode: use actual services with pooled workers for parallel processing
    const { CatalogService } = await import('@literoom/core/catalog')
    const { DecodeService } = await import('@literoom/core/decode')

    // Use pooled decode service for parallel thumbnail generation
    decodeService = await DecodeService.createPooled()
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

  catalogService.onPreviewReady = (assetId, url) => {
    catalogStore.updatePreview(assetId, 'ready', url)
  }

  // Photo ready callback - when both thumbnail and preview are done
  catalogService.onPhotoReady = (photo) => {
    catalogStore.markPhotoReady(photo.asset.id, photo.thumbnailUrl, photo.previewUrl)
  }

  // Cleanup on page unload
  if (import.meta.client) {
    window.addEventListener('beforeunload', () => {
      catalogService.destroy()
      decodeService.destroy()
      gpuProcessor.destroy()
    })
  }

  // Get edit store for restoring persisted edits
  const editStore = useEditStore()

  // Track initialization to prevent duplicate calls
  let initializationPromise: Promise<boolean> | null = null

  /**
   * Initialize catalog with data if not already populated.
   * Called by ensure-catalog middleware before allowing navigation to edit pages.
   *
   * In demo mode: auto-loads demo catalog
   * In real mode: restores from database or returns false
   *
   * Also initializes the edit store from IndexedDB to restore any persisted edits.
   *
   * @returns true if catalog is populated, false if initialization failed
   */
  async function initializeCatalog(): Promise<boolean> {
    // Already populated
    if (catalogStore.assetIds.length > 0) {
      // Still need to initialize edit store if not already done
      await editStore.initializeFromDb()
      return true
    }

    // Prevent concurrent initialization
    if (initializationPromise) {
      return initializationPromise
    }

    initializationPromise = (async () => {
      try {
        if (isDemoMode) {
          // Demo mode: auto-load demo catalog
          catalogStore.setFolderPath('Demo Photos')
          catalogStore.setScanning(true)
          try {
            await catalogService.selectFolder()
            await catalogService.scanFolder()
            // Initialize edit store (no persisted edits in demo, but consistent)
            await editStore.initializeFromDb()
            return catalogStore.assetIds.length > 0
          }
          finally {
            catalogStore.setScanning(false)
          }
        }
        else {
          // Real mode: try to restore from database
          const restored = await catalogService.loadFromDatabase()
          if (restored) {
            const folder = catalogService.getCurrentFolder()
            if (folder) {
              catalogStore.setFolderPath(folder.name)
            }
            // Initialize edit store to restore any persisted edits
            const editCount = await editStore.initializeFromDb()
            if (editCount > 0) {
              console.log(`[catalog.client] Restored ${editCount} edit state(s) from database`)
            }
            return catalogStore.assetIds.length > 0
          }
          return false
        }
      }
      catch (e) {
        console.warn('Failed to initialize catalog:', e)
        return false
      }
      finally {
        initializationPromise = null
      }
    })()

    return initializationPromise
  }

  // Mark services as ready
  resolveReady!()

  return {
    provide: {
      catalogService,
      decodeService,
      isDemoMode,
      initializeCatalog,
      gpuProcessor,
      gpuCapabilities,
    },
  }
})
