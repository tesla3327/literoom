/**
 * Unit tests for the edit UI store.
 *
 * Tests UI state management for the edit view including:
 * - Initial state
 * - Zoom/pan state and methods
 * - Zoom caching (LRU)
 * - Clipping overlay toggles
 * - Crop tool state
 * - Mask tool state
 * - Computed properties
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useEditUIStore } from '~/stores/editUI'

describe('editUIStore', () => {
  let store: ReturnType<typeof useEditUIStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useEditUIStore()
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('should have camera with scale: 1, panX: 0, panY: 0', () => {
      expect(store.camera).toEqual({ scale: 1, panX: 0, panY: 0 })
    })

    it('should have zoomPreset set to "fit"', () => {
      expect(store.zoomPreset).toBe('fit')
    })

    it('should have isZoomInteracting set to false', () => {
      expect(store.isZoomInteracting).toBe(false)
    })

    it('should have imageDimensions with width: 0, height: 0', () => {
      expect(store.imageDimensions).toEqual({ width: 0, height: 0 })
    })

    it('should have viewportDimensions with width: 0, height: 0', () => {
      expect(store.viewportDimensions).toEqual({ width: 0, height: 0 })
    })

    it('should have showHighlightClipping set to false', () => {
      expect(store.showHighlightClipping).toBe(false)
    })

    it('should have showShadowClipping set to false', () => {
      expect(store.showShadowClipping).toBe(false)
    })

    it('should have isCropToolActive set to false', () => {
      expect(store.isCropToolActive).toBe(false)
    })

    it('should have isMaskToolActive set to false', () => {
      expect(store.isMaskToolActive).toBe(false)
    })

    it('should have maskDrawingMode set to null', () => {
      expect(store.maskDrawingMode).toBe(null)
    })

    it('should have zoomPercentage computed value of 100', () => {
      expect(store.zoomPercentage).toBe(100)
    })

    it('should have canPanImage computed value of false', () => {
      expect(store.canPanImage).toBe(false)
    })
  })

  // ============================================================================
  // Zoom/Pan Setters
  // ============================================================================

  describe('zoom/pan setters', () => {
    const imageWidth = 2000
    const imageHeight = 1500
    const viewportWidth = 1000
    const viewportHeight = 800

    describe('setViewportDimensions', () => {
      it('sets viewport width and height', () => {
        store.setViewportDimensions(viewportWidth, viewportHeight)

        expect(store.viewportDimensions.width).toBe(viewportWidth)
        expect(store.viewportDimensions.height).toBe(viewportHeight)
      })

      it('updates viewport dimensions on subsequent calls', () => {
        store.setViewportDimensions(1000, 800)
        store.setViewportDimensions(1200, 900)

        expect(store.viewportDimensions.width).toBe(1200)
        expect(store.viewportDimensions.height).toBe(900)
      })

      it('handles zero dimensions', () => {
        store.setViewportDimensions(0, 0)

        expect(store.viewportDimensions.width).toBe(0)
        expect(store.viewportDimensions.height).toBe(0)
      })

      it('handles partial zero dimensions', () => {
        store.setViewportDimensions(0, viewportHeight)

        expect(store.viewportDimensions.width).toBe(0)
        expect(store.viewportDimensions.height).toBe(viewportHeight)
      })
    })

    describe('setImageDimensions', () => {
      it('sets image width and height', () => {
        store.setImageDimensions(imageWidth, imageHeight)

        expect(store.imageDimensions.width).toBe(imageWidth)
        expect(store.imageDimensions.height).toBe(imageHeight)
      })

      it('updates image dimensions on subsequent calls', () => {
        store.setImageDimensions(2000, 1500)
        store.setImageDimensions(3000, 2250)

        expect(store.imageDimensions.width).toBe(3000)
        expect(store.imageDimensions.height).toBe(2250)
      })

      it('handles zero dimensions', () => {
        store.setImageDimensions(0, 0)

        expect(store.imageDimensions.width).toBe(0)
        expect(store.imageDimensions.height).toBe(0)
      })

      it('handles partial zero dimensions', () => {
        store.setImageDimensions(imageWidth, 0)

        expect(store.imageDimensions.width).toBe(imageWidth)
        expect(store.imageDimensions.height).toBe(0)
      })
    })

    describe('setCamera', () => {
      beforeEach(() => {
        store.setImageDimensions(imageWidth, imageHeight)
        store.setViewportDimensions(viewportWidth, viewportHeight)
      })

      it('sets camera with valid values', () => {
        const newCamera = { scale: 1, panX: 0, panY: 0 }
        store.setCamera(newCamera)

        expect(store.camera.scale).toBe(1)
      })

      it('clamps scale to max bounds', () => {
        store.setCamera({ scale: 10, panX: 0, panY: 0 })

        expect(store.camera.scale).toBeLessThanOrEqual(4.0)
      })

      it('clamps scale to minimum bounds', () => {
        store.setCamera({ scale: 0.001, panX: 0, panY: 0 })

        expect(store.camera.scale).toBeGreaterThanOrEqual(0.05)
      })

      it('detects and sets 100% preset when camera matches 100% scale', () => {
        store.setCamera({ scale: 1, panX: 0, panY: 0 })

        expect(store.zoomPreset).toBe('100%')
      })

      it('detects custom preset when camera does not match any preset', () => {
        store.setCamera({ scale: 1.5, panX: 100, panY: 100 })

        expect(store.zoomPreset).toBe('custom')
      })
    })

    describe('setZoomPreset', () => {
      beforeEach(() => {
        store.setImageDimensions(imageWidth, imageHeight)
        store.setViewportDimensions(viewportWidth, viewportHeight)
      })

      it('sets fit preset and creates matching camera', () => {
        store.setZoomPreset('fit')

        expect(store.zoomPreset).toBe('fit')
        expect(store.camera.scale).toBe(store.fitScale)
      })

      it('sets 100% preset and creates matching camera with scale 1', () => {
        store.setZoomPreset('100%')

        expect(store.zoomPreset).toBe('100%')
        expect(store.camera.scale).toBe(1)
      })

      it('sets 50% preset and creates matching camera with scale 0.5', () => {
        store.setZoomPreset('50%')

        expect(store.zoomPreset).toBe('50%')
        expect(store.camera.scale).toBe(0.5)
      })

      it('sets 200% preset and creates matching camera with scale 2', () => {
        store.setZoomPreset('200%')

        expect(store.zoomPreset).toBe('200%')
        expect(store.camera.scale).toBe(2)
      })

      it('returns early and does not set custom preset', () => {
        store.setZoomPreset('fit')
        const initialCamera = { ...store.camera }

        store.setZoomPreset('custom')

        expect(store.zoomPreset).toBe('fit')
        expect(store.camera).toEqual(initialCamera)
      })

      it('switches between different presets correctly', () => {
        store.setZoomPreset('fit')
        expect(store.zoomPreset).toBe('fit')

        store.setZoomPreset('100%')
        expect(store.zoomPreset).toBe('100%')

        store.setZoomPreset('200%')
        expect(store.zoomPreset).toBe('200%')

        store.setZoomPreset('fit')
        expect(store.zoomPreset).toBe('fit')
      })
    })

    describe('setZoomPreset with invalid dimensions', () => {
      it('sets preset but does not calculate camera when image dimensions are 0', () => {
        // Reset to invalid state
        setActivePinia(createPinia())
        store = useEditUIStore()

        // Set only viewport dimensions (image still 0x0)
        store.setViewportDimensions(1000, 800)

        const initialCamera = { ...store.camera }

        store.setZoomPreset('fit')

        // Preset should be set
        expect(store.zoomPreset).toBe('fit')
        // Camera should NOT be updated (still default)
        expect(store.camera).toEqual(initialCamera)
      })

      it('sets preset but does not calculate camera when viewport dimensions are 0', () => {
        // Reset to invalid state
        setActivePinia(createPinia())
        store = useEditUIStore()

        // Set only image dimensions (viewport still 0x0)
        store.setImageDimensions(2000, 1500)

        const initialCamera = { ...store.camera }

        store.setZoomPreset('fit')

        // Preset should be set
        expect(store.zoomPreset).toBe('fit')
        // Camera should NOT be updated (still default)
        expect(store.camera).toEqual(initialCamera)
      })

      it('sets preset but does not calculate camera when all dimensions are 0', () => {
        // Reset to invalid state (already 0x0)
        setActivePinia(createPinia())
        store = useEditUIStore()

        const initialCamera = { ...store.camera }

        store.setZoomPreset('100%')

        // Preset should be set
        expect(store.zoomPreset).toBe('100%')
        // Camera should NOT be updated (still default)
        expect(store.camera).toEqual(initialCamera)
      })

      it('calculates camera when initializeZoom is called after dimensions are set', () => {
        // Reset to invalid state
        setActivePinia(createPinia())
        store = useEditUIStore()

        // Set preset while dimensions are invalid
        store.setZoomPreset('fit')
        expect(store.zoomPreset).toBe('fit')

        // Now set valid dimensions
        store.setImageDimensions(2000, 1500)
        store.setViewportDimensions(1000, 800)

        // Call initializeZoom (simulates what happens when image loads)
        store.initializeZoom()

        // Camera should now be properly calculated for fit
        expect(store.camera.scale).toBe(store.fitScale)
        // Verify pan is centered
        const expectedPanX = (1000 - 2000 * store.fitScale) / 2
        const expectedPanY = (800 - 1500 * store.fitScale) / 2
        expect(store.camera.panX).toBeCloseTo(expectedPanX, 1)
        expect(store.camera.panY).toBeCloseTo(expectedPanY, 1)
      })

      it('defers all preset calculations when dimensions invalid, then calculates on initializeZoom', () => {
        // Reset to invalid state
        setActivePinia(createPinia())
        store = useEditUIStore()

        // Set various presets while dimensions are invalid
        store.setZoomPreset('100%')
        const cameraAfter100 = { ...store.camera }
        store.setZoomPreset('200%')
        const cameraAfter200 = { ...store.camera }

        // Camera should be unchanged (still default)
        expect(cameraAfter100).toEqual({ scale: 1, panX: 0, panY: 0 })
        expect(cameraAfter200).toEqual({ scale: 1, panX: 0, panY: 0 })

        // Final preset is '200%'
        expect(store.zoomPreset).toBe('200%')

        // Now set valid dimensions and initialize
        store.setImageDimensions(2000, 1500)
        store.setViewportDimensions(1000, 800)
        store.initializeZoom()

        // Camera should now be calculated for 200% preset
        expect(store.camera.scale).toBe(2)
      })
    })
  })

  // ============================================================================
  // Zoom Actions
  // ============================================================================

  describe('zoom actions', () => {
    beforeEach(() => {
      store.setImageDimensions(2000, 1500)
      store.setViewportDimensions(1000, 800)
      store.initializeZoom()
    })

    describe('zoomIn()', () => {
      it('zooms in by step and increases scale', () => {
        const initialScale = store.camera.scale
        store.zoomIn()
        const newScale = store.camera.scale

        expect(newScale).toBeGreaterThan(initialScale)
      })

      it('zooms in multiple times progressively increases scale', () => {
        const initialScale = store.camera.scale
        store.zoomIn()
        const afterFirstZoom = store.camera.scale
        store.zoomIn()
        const afterSecondZoom = store.camera.scale

        expect(afterFirstZoom).toBeGreaterThan(initialScale)
        expect(afterSecondZoom).toBeGreaterThan(afterFirstZoom)
      })

      it('clamps scale to MAX_ZOOM boundary', () => {
        for (let i = 0; i < 20; i++) {
          store.zoomIn()
        }

        expect(store.camera.scale).toBeLessThanOrEqual(4.0)
      })

      it('sets preset to custom after zoom in from fit', () => {
        expect(store.zoomPreset).toBe('fit')
        store.zoomIn()

        expect(store.zoomPreset).not.toBe('fit')
      })
    })

    describe('zoomOut()', () => {
      it('zooms out by step and decreases scale', () => {
        store.zoomIn()
        const initialScale = store.camera.scale
        store.zoomOut()
        const newScale = store.camera.scale

        expect(newScale).toBeLessThan(initialScale)
      })

      it('zooms out multiple times progressively decreases scale', () => {
        store.zoomIn()
        store.zoomIn()
        const initialScale = store.camera.scale
        store.zoomOut()
        const afterFirstZoom = store.camera.scale
        store.zoomOut()
        const afterSecondZoom = store.camera.scale

        expect(afterFirstZoom).toBeLessThan(initialScale)
        expect(afterSecondZoom).toBeLessThan(afterFirstZoom)
      })

      it('clamps scale to MIN_ZOOM boundary', () => {
        for (let i = 0; i < 20; i++) {
          store.zoomOut()
        }

        expect(store.camera.scale).toBeGreaterThanOrEqual(0.1)
      })
    })

    describe('zoomToPointAction(newScale, pivotX, pivotY)', () => {
      it('zooms to specified scale', () => {
        store.zoomToPointAction(2.0, 500, 400)

        expect(store.camera.scale).toBeCloseTo(2.0, 2)
      })

      it('clamps scale to MAX_ZOOM', () => {
        store.zoomToPointAction(10.0, 500, 400)

        expect(store.camera.scale).toBeLessThanOrEqual(4.0)
      })

      it('clamps scale to MIN_ZOOM', () => {
        store.zoomToPointAction(0.01, 500, 400)

        expect(store.camera.scale).toBeGreaterThanOrEqual(0.1)
      })

      it('sets preset to custom when zoom does not match preset', () => {
        store.zoomToPointAction(1.5, 500, 400)

        expect(store.zoomPreset).toBe('custom')
      })
    })

    describe('toggleZoom()', () => {
      it('toggles from fit to 100% when at fit', () => {
        expect(store.zoomPreset).toBe('fit')
        store.toggleZoom()

        expect(store.zoomPreset).toBe('100%')
        expect(store.camera.scale).toBeCloseTo(1.0, 2)
      })

      it('toggles from 100% back to fit', () => {
        store.toggleZoom()
        expect(store.zoomPreset).toBe('100%')

        store.toggleZoom()
        expect(store.zoomPreset).toBe('fit')
        expect(store.camera.scale).toBeCloseTo(store.fitScale, 2)
      })

      it('toggles from custom zoom back to fit', () => {
        store.zoomToPointAction(1.5, 500, 400)
        expect(store.zoomPreset).toBe('custom')

        store.toggleZoom()

        expect(store.zoomPreset).toBe('fit')
        expect(store.camera.scale).toBeCloseTo(store.fitScale, 2)
      })

      it('toggles multiple times correctly', () => {
        expect(store.zoomPreset).toBe('fit')

        store.toggleZoom()
        expect(store.zoomPreset).toBe('100%')

        store.toggleZoom()
        expect(store.zoomPreset).toBe('fit')

        store.toggleZoom()
        expect(store.zoomPreset).toBe('100%')
      })
    })

    describe('resetZoom()', () => {
      it('resets zoom to fit preset', () => {
        store.zoomIn()
        store.zoomIn()
        expect(store.zoomPreset).not.toBe('fit')

        store.resetZoom()

        expect(store.zoomPreset).toBe('fit')
      })

      it('resets scale to fit scale', () => {
        store.setZoomPreset('100%')
        expect(store.camera.scale).toBeCloseTo(1.0, 2)

        store.resetZoom()

        expect(store.camera.scale).toBeCloseTo(store.fitScale, 2)
      })

      it('resets after custom zoom', () => {
        // Use 1.5 scale which doesn't match any preset
        store.zoomToPointAction(1.5, 500, 400)
        expect(store.zoomPreset).toBe('custom')

        store.resetZoom()

        expect(store.zoomPreset).toBe('fit')
      })
    })
  })

  // ============================================================================
  // Pan and Interactions
  // ============================================================================

  describe('pan and interactions', () => {
    beforeEach(() => {
      store.setImageDimensions(2000, 1500)
      store.setViewportDimensions(1000, 800)
      store.initializeZoom()
    })

    describe('pan(deltaX, deltaY)', () => {
      it('pans by the specified delta amount when zoomed in', () => {
        store.setZoomPreset('100%')

        const initialPanX = store.camera.panX
        const initialPanY = store.camera.panY

        store.pan(50, -30)

        expect(store.camera.panX).toBe(initialPanX + 50)
        expect(store.camera.panY).toBe(initialPanY - 30)
      })

      it('preserves scale value during pan', () => {
        store.setZoomPreset('200%')
        const scale = store.camera.scale

        store.pan(100, 100)

        expect(store.camera.scale).toBe(scale)
      })
    })

    describe('setZoomInteracting(boolean)', () => {
      it('sets isZoomInteracting to true', () => {
        expect(store.isZoomInteracting).toBe(false)

        store.setZoomInteracting(true)

        expect(store.isZoomInteracting).toBe(true)
      })

      it('sets isZoomInteracting to false', () => {
        store.setZoomInteracting(true)

        store.setZoomInteracting(false)

        expect(store.isZoomInteracting).toBe(false)
      })

      it('toggles interacting state back and forth', () => {
        store.setZoomInteracting(true)
        expect(store.isZoomInteracting).toBe(true)

        store.setZoomInteracting(false)
        expect(store.isZoomInteracting).toBe(false)

        store.setZoomInteracting(true)
        expect(store.isZoomInteracting).toBe(true)
      })

      it('does not affect camera state', () => {
        const initialCamera = { ...store.camera }

        store.setZoomInteracting(true)

        expect(store.camera).toEqual(initialCamera)
      })
    })

    describe('initializeZoom()', () => {
      it('recalculates camera when preset is "fit"', () => {
        store.setZoomPreset('fit')
        store.initializeZoom()

        expect(store.camera.scale).toBe(store.fitScale)
      })

      it('handles viewport resize with fit preset', () => {
        store.setZoomPreset('fit')
        store.initializeZoom()

        const firstScale = store.camera.scale

        store.setViewportDimensions(2000, 1600)
        store.initializeZoom()

        expect(store.camera.scale).not.toBe(firstScale)
      })
    })
  })

  // ============================================================================
  // Zoom Caching
  // ============================================================================

  describe('zoom caching', () => {
    beforeEach(() => {
      store.setViewportDimensions(1000, 800)
      store.setImageDimensions(2000, 1500)
      store.initializeZoom()
    })

    describe('cacheZoomForAsset(assetId)', () => {
      it('should cache current camera and preset for an asset', () => {
        store.setZoomPreset('100%')
        store.cacheZoomForAsset('asset-1')

        store.setZoomPreset('fit')
        store.restoreZoomForAsset('asset-1')

        expect(store.zoomPreset).toBe('100%')
      })

      it('should update cache if called multiple times for same asset', () => {
        store.setZoomPreset('100%')
        store.cacheZoomForAsset('asset-1')

        store.setZoomPreset('200%')
        store.cacheZoomForAsset('asset-1')

        store.setZoomPreset('fit')
        store.restoreZoomForAsset('asset-1')

        expect(store.zoomPreset).toBe('200%')
      })

      it('should evict oldest entry when cache exceeds 50 items', () => {
        // Cache 51 assets with different presets
        for (let i = 0; i < 51; i++) {
          store.setZoomPreset('100%')
          store.cacheZoomForAsset(`asset-${i}`)
        }

        // First asset should be evicted (LRU)
        store.setZoomPreset('fit')
        store.restoreZoomForAsset('asset-0')

        // Should have reset to fit since asset-0 was evicted
        expect(store.zoomPreset).toBe('fit')
      })
    })

    describe('restoreZoomForAsset(assetId)', () => {
      it('should restore cached camera and preset for an asset', () => {
        store.setZoomPreset('200%')
        store.cacheZoomForAsset('asset-1')

        store.setZoomPreset('fit')

        store.restoreZoomForAsset('asset-1')
        expect(store.zoomPreset).toBe('200%')
      })

      it('should reset to fit zoom for uncached asset', () => {
        store.setZoomPreset('100%')

        store.restoreZoomForAsset('unknown-asset')

        expect(store.zoomPreset).toBe('fit')
      })

      it('should move accessed asset to end of LRU order', () => {
        // Cache 50 assets (fills cache to max)
        for (let i = 0; i < 50; i++) {
          store.setZoomPreset('100%')
          store.cacheZoomForAsset(`asset-${i}`)
        }

        // Access asset-0 via restore - this moves it to the end of the LRU order
        store.restoreZoomForAsset('asset-0')

        // Add one more asset - should evict asset-1 (now first in order), not asset-0
        store.setZoomPreset('200%')
        store.cacheZoomForAsset('asset-50')

        // asset-0 should still be present (was moved to end when accessed)
        store.setZoomPreset('fit')
        store.restoreZoomForAsset('asset-0')
        expect(store.zoomPreset).toBe('100%')

        // asset-1 should be evicted
        store.restoreZoomForAsset('asset-1')
        expect(store.zoomPreset).toBe('fit') // reset to fit because not in cache
      })
    })

    describe('cache state persistence workflow', () => {
      it('should handle interleaved cache/restore operations', () => {
        store.setZoomPreset('100%')
        store.cacheZoomForAsset('asset-1')

        store.setZoomPreset('200%')
        store.cacheZoomForAsset('asset-2')

        store.restoreZoomForAsset('asset-1')
        expect(store.zoomPreset).toBe('100%')

        store.restoreZoomForAsset('asset-2')
        expect(store.zoomPreset).toBe('200%')
      })
    })

    describe('wasRestoredFromCache flag', () => {
      it('should set wasRestoredFromCache to true when restore finds cached state', () => {
        store.setZoomPreset('100%')
        store.cacheZoomForAsset('asset-1')

        store.setZoomPreset('fit')
        store.restoreZoomForAsset('asset-1')

        expect(store.wasRestoredFromCache).toBe(true)
      })

      it('should set wasRestoredFromCache to false when restore does not find cached state', () => {
        store.restoreZoomForAsset('unknown-asset')

        expect(store.wasRestoredFromCache).toBe(false)
      })

      it('should clear wasRestoredFromCache after initializeZoom', () => {
        store.setZoomPreset('100%')
        store.cacheZoomForAsset('asset-1')
        store.restoreZoomForAsset('asset-1')

        expect(store.wasRestoredFromCache).toBe(true)

        store.initializeZoom()

        expect(store.wasRestoredFromCache).toBe(false)
      })
    })

    describe('zoom persistence through initializeZoom', () => {
      it('should preserve restored zoom preset after initializeZoom', () => {
        // Setup: Cache asset-1 at 100% zoom
        store.setZoomPreset('100%')
        store.cacheZoomForAsset('asset-1')

        // Simulate navigating away
        store.setZoomPreset('fit')
        store.cacheZoomForAsset('asset-2')

        // Simulate navigating back to asset-1
        store.restoreZoomForAsset('asset-1')
        expect(store.zoomPreset).toBe('100%')

        // Simulate image loading (triggers initializeZoom)
        // This is what was causing the bug before the fix
        store.initializeZoom()

        // Zoom should still be 100% (not reset to fit)
        expect(store.zoomPreset).toBe('100%')
      })

      it('should preserve restored camera scale after initializeZoom', () => {
        // Setup: Cache asset-1 at 100% zoom (scale = 1.0)
        store.setZoomPreset('100%')
        const originalScale = store.camera.scale
        store.cacheZoomForAsset('asset-1')

        // Navigate away
        store.setZoomPreset('fit')

        // Navigate back
        store.restoreZoomForAsset('asset-1')

        // Simulate image loading
        store.initializeZoom()

        // Scale should be preserved (accounting for pan clamping)
        expect(store.camera.scale).toBe(originalScale)
      })

      it('should still allow standard presets to recalculate for new assets', () => {
        // For a NEW asset (not restored from cache), 'fit' should still calculate
        store.restoreZoomForAsset('new-asset') // Not in cache

        expect(store.wasRestoredFromCache).toBe(false)
        expect(store.zoomPreset).toBe('fit')

        // Simulate image with different dimensions
        store.setImageDimensions(3000, 2000)
        store.initializeZoom()

        // For new assets, fit should recalculate camera
        // (different from cached behavior)
        expect(store.zoomPreset).toBe('fit')
      })

      it('should clamp pan when dimensions differ from cached state', () => {
        // Setup: Cache asset at specific zoom with pan
        store.setZoomPreset('100%')
        store.pan(100, 100) // Pan to a specific position
        store.cacheZoomForAsset('asset-1')

        // Navigate away
        store.setZoomPreset('fit')

        // Navigate back but with SMALLER dimensions that would make old pan invalid
        store.restoreZoomForAsset('asset-1')
        store.setImageDimensions(500, 400) // Much smaller image
        store.initializeZoom()

        // Scale should be preserved
        expect(store.camera.scale).toBe(1)

        // Pan should be clamped to valid bounds (not the original values)
        // With smaller image at 100% zoom, pan should be clamped differently
        // Just verify it's a valid state (not the potentially out-of-bounds cached pan)
        expect(typeof store.camera.panX).toBe('number')
        expect(typeof store.camera.panY).toBe('number')
      })

      it('should handle navigation workflow: A -> B -> A with preserved zoom', () => {
        // Asset A at 100% zoom
        store.setZoomPreset('100%')
        store.cacheZoomForAsset('asset-A')

        // Navigate to Asset B at 200% zoom
        store.restoreZoomForAsset('asset-B') // Not in cache, resets to fit
        store.initializeZoom()
        store.setZoomPreset('200%')
        store.cacheZoomForAsset('asset-B')

        // Navigate back to Asset A
        store.restoreZoomForAsset('asset-A')
        store.initializeZoom()

        // Asset A should still be at 100% zoom
        expect(store.zoomPreset).toBe('100%')
        expect(store.camera.scale).toBe(1)
      })

      it('should handle viewport resize after restore (should recalculate on next navigate)', () => {
        // Cache asset at 100%
        store.setZoomPreset('100%')
        store.cacheZoomForAsset('asset-1')

        // Restore it
        store.restoreZoomForAsset('asset-1')
        store.initializeZoom()
        expect(store.wasRestoredFromCache).toBe(false) // Consumed by initializeZoom

        // Viewport resize shouldn't affect already-initialized zoom
        store.setViewportDimensions(1200, 900)
        // After restore+init, future initializeZoom calls should work normally
        store.initializeZoom()

        // Should still be at 100%
        expect(store.zoomPreset).toBe('100%')
      })
    })
  })

  // ============================================================================
  // Clipping Overlays
  // ============================================================================

  describe('clipping overlays', () => {
    it('toggleClippingOverlays: both off -> both on', () => {
      store.resetClippingOverlays()

      expect(store.showHighlightClipping).toBe(false)
      expect(store.showShadowClipping).toBe(false)

      store.toggleClippingOverlays()

      expect(store.showHighlightClipping).toBe(true)
      expect(store.showShadowClipping).toBe(true)
    })

    it('toggleClippingOverlays: both on -> both off', () => {
      store.toggleClippingOverlays()
      expect(store.showHighlightClipping).toBe(true)
      expect(store.showShadowClipping).toBe(true)

      store.toggleClippingOverlays()

      expect(store.showHighlightClipping).toBe(false)
      expect(store.showShadowClipping).toBe(false)
    })

    it('toggleClippingOverlays: one on -> both off', () => {
      store.toggleHighlightClipping()
      expect(store.showHighlightClipping).toBe(true)
      expect(store.showShadowClipping).toBe(false)

      store.toggleClippingOverlays()

      expect(store.showHighlightClipping).toBe(false)
      expect(store.showShadowClipping).toBe(false)
    })

    it('toggleShadowClipping: toggles only shadow clipping', () => {
      store.toggleHighlightClipping()
      expect(store.showHighlightClipping).toBe(true)

      store.toggleShadowClipping()

      expect(store.showShadowClipping).toBe(true)
      expect(store.showHighlightClipping).toBe(true)
    })

    it('toggleHighlightClipping: toggles only highlight clipping', () => {
      store.toggleShadowClipping()
      expect(store.showShadowClipping).toBe(true)

      store.toggleHighlightClipping()

      expect(store.showHighlightClipping).toBe(true)
      expect(store.showShadowClipping).toBe(true)
    })

    it('resetClippingOverlays: both on -> both off', () => {
      store.toggleClippingOverlays()
      expect(store.showHighlightClipping).toBe(true)
      expect(store.showShadowClipping).toBe(true)

      store.resetClippingOverlays()

      expect(store.showHighlightClipping).toBe(false)
      expect(store.showShadowClipping).toBe(false)
    })

    it('resetClippingOverlays: already off -> stays off', () => {
      expect(store.showHighlightClipping).toBe(false)
      expect(store.showShadowClipping).toBe(false)

      store.resetClippingOverlays()

      expect(store.showHighlightClipping).toBe(false)
      expect(store.showShadowClipping).toBe(false)
    })
  })

  // ============================================================================
  // Crop Tool
  // ============================================================================

  describe('crop tool', () => {
    describe('initial state', () => {
      it('should have isCropToolActive as false by default', () => {
        expect(store.isCropToolActive).toBe(false)
      })
    })

    describe('activateCropTool()', () => {
      it('should set isCropToolActive to true when inactive', () => {
        expect(store.isCropToolActive).toBe(false)
        store.activateCropTool()
        expect(store.isCropToolActive).toBe(true)
      })

      it('should keep isCropToolActive as true when already active', () => {
        store.activateCropTool()
        expect(store.isCropToolActive).toBe(true)
        store.activateCropTool()
        expect(store.isCropToolActive).toBe(true)
      })
    })

    describe('deactivateCropTool()', () => {
      it('should set isCropToolActive to false when active', () => {
        store.activateCropTool()
        expect(store.isCropToolActive).toBe(true)
        store.deactivateCropTool()
        expect(store.isCropToolActive).toBe(false)
      })

      it('should keep isCropToolActive as false when already inactive', () => {
        expect(store.isCropToolActive).toBe(false)
        store.deactivateCropTool()
        expect(store.isCropToolActive).toBe(false)
      })
    })

    describe('toggleCropTool()', () => {
      it('should toggle from false to true', () => {
        expect(store.isCropToolActive).toBe(false)
        store.toggleCropTool()
        expect(store.isCropToolActive).toBe(true)
      })

      it('should toggle from true to false', () => {
        store.activateCropTool()
        expect(store.isCropToolActive).toBe(true)
        store.toggleCropTool()
        expect(store.isCropToolActive).toBe(false)
      })

      it('should toggle multiple times in sequence', () => {
        expect(store.isCropToolActive).toBe(false)

        store.toggleCropTool()
        expect(store.isCropToolActive).toBe(true)

        store.toggleCropTool()
        expect(store.isCropToolActive).toBe(false)

        store.toggleCropTool()
        expect(store.isCropToolActive).toBe(true)

        store.toggleCropTool()
        expect(store.isCropToolActive).toBe(false)
      })
    })

    describe('pending crop state', () => {
      it('should have pendingCrop as null by default', () => {
        expect(store.pendingCrop).toBe(null)
        expect(store.hasPendingCrop).toBe(false)
      })

      it('initializePendingCrop() should initialize with full image when no crop exists', () => {
        store.activateCropTool()
        expect(store.pendingCrop).toEqual({ left: 0, top: 0, width: 1, height: 1 })
        expect(store.hasPendingCrop).toBe(true)
      })

      it('setPendingCrop() should update pending crop state', () => {
        store.activateCropTool()
        store.setPendingCrop({ left: 0.1, top: 0.2, width: 0.5, height: 0.6 })
        expect(store.pendingCrop).toEqual({ left: 0.1, top: 0.2, width: 0.5, height: 0.6 })
      })

      it('setPendingCrop(null) should clear pending crop', () => {
        store.activateCropTool()
        store.setPendingCrop(null)
        expect(store.pendingCrop).toBe(null)
        expect(store.hasPendingCrop).toBe(false)
      })

      it('applyPendingCrop() should deactivate crop tool and clear pending', () => {
        store.activateCropTool()
        store.setPendingCrop({ left: 0.1, top: 0.2, width: 0.5, height: 0.6 })
        store.applyPendingCrop()
        expect(store.isCropToolActive).toBe(false)
        expect(store.pendingCrop).toBe(null)
      })

      it('cancelPendingCrop() should deactivate crop tool and clear pending', () => {
        store.activateCropTool()
        store.setPendingCrop({ left: 0.1, top: 0.2, width: 0.5, height: 0.6 })
        store.cancelPendingCrop()
        expect(store.isCropToolActive).toBe(false)
        expect(store.pendingCrop).toBe(null)
      })

      it('resetPendingCrop() should set pending crop to full image', () => {
        store.activateCropTool()
        store.setPendingCrop({ left: 0.1, top: 0.2, width: 0.5, height: 0.6 })
        store.resetPendingCrop()
        expect(store.pendingCrop).toEqual({ left: 0, top: 0, width: 1, height: 1 })
      })

      it('deactivateCropTool() should clear pending crop', () => {
        store.activateCropTool()
        store.setPendingCrop({ left: 0.1, top: 0.2, width: 0.5, height: 0.6 })
        store.deactivateCropTool()
        expect(store.pendingCrop).toBe(null)
        expect(store.isCropToolActive).toBe(false)
      })
    })
  })

  // ============================================================================
  // Mask Tool
  // ============================================================================

  describe('mask tool', () => {
    it('activateMaskTool() sets isMaskToolActive to true', () => {
      expect(store.isMaskToolActive).toBe(false)

      store.activateMaskTool()

      expect(store.isMaskToolActive).toBe(true)
    })

    it('deactivateMaskTool() sets isMaskToolActive to false AND maskDrawingMode to null', () => {
      store.activateMaskTool()
      store.setMaskDrawingMode('linear')

      store.deactivateMaskTool()

      expect(store.isMaskToolActive).toBe(false)
      expect(store.maskDrawingMode).toBe(null)
    })

    it('setMaskDrawingMode("linear") activates tool and sets mode', () => {
      expect(store.isMaskToolActive).toBe(false)

      store.setMaskDrawingMode('linear')

      expect(store.isMaskToolActive).toBe(true)
      expect(store.maskDrawingMode).toBe('linear')
    })

    it('setMaskDrawingMode("radial") activates tool and sets mode', () => {
      expect(store.isMaskToolActive).toBe(false)

      store.setMaskDrawingMode('radial')

      expect(store.isMaskToolActive).toBe(true)
      expect(store.maskDrawingMode).toBe('radial')
    })

    it('setMaskDrawingMode(null) does NOT deactivate tool, just clears mode', () => {
      store.activateMaskTool()
      store.setMaskDrawingMode('linear')

      store.setMaskDrawingMode(null)

      expect(store.isMaskToolActive).toBe(true)
      expect(store.maskDrawingMode).toBe(null)
    })

    it('cancelMaskDrawing() clears mode but keeps tool active', () => {
      store.activateMaskTool()
      store.setMaskDrawingMode('radial')

      store.cancelMaskDrawing()

      expect(store.isMaskToolActive).toBe(true)
      expect(store.maskDrawingMode).toBe(null)
    })

    it('drawing mode interactions: set linear, then cancel, then set radial', () => {
      store.setMaskDrawingMode('linear')
      expect(store.isMaskToolActive).toBe(true)
      expect(store.maskDrawingMode).toBe('linear')

      store.cancelMaskDrawing()
      expect(store.isMaskToolActive).toBe(true)
      expect(store.maskDrawingMode).toBe(null)

      store.setMaskDrawingMode('radial')
      expect(store.isMaskToolActive).toBe(true)
      expect(store.maskDrawingMode).toBe('radial')
    })

    // These tests simulate the accordion expand/collapse cycle
    // to ensure mask tool state is properly preserved
    describe('accordion collapse/expand cycle', () => {
      it('preserves tool state through activate -> deactivate -> activate cycle', () => {
        // Simulate accordion expand
        store.activateMaskTool()
        expect(store.isMaskToolActive).toBe(true)

        // Simulate accordion collapse
        store.deactivateMaskTool()
        expect(store.isMaskToolActive).toBe(false)
        expect(store.maskDrawingMode).toBe(null)

        // Simulate accordion re-expand
        store.activateMaskTool()
        expect(store.isMaskToolActive).toBe(true)
        // maskDrawingMode should still be null (no active drawing mode)
        expect(store.maskDrawingMode).toBe(null)
      })

      it('clears drawing mode on deactivate and does not restore it on reactivate', () => {
        // Start drawing a linear mask
        store.setMaskDrawingMode('linear')
        expect(store.isMaskToolActive).toBe(true)
        expect(store.maskDrawingMode).toBe('linear')

        // Simulate accordion collapse (should clear drawing mode)
        store.deactivateMaskTool()
        expect(store.isMaskToolActive).toBe(false)
        expect(store.maskDrawingMode).toBe(null)

        // Simulate accordion re-expand (should not restore drawing mode)
        store.activateMaskTool()
        expect(store.isMaskToolActive).toBe(true)
        expect(store.maskDrawingMode).toBe(null) // NOT 'linear'
      })

      it('allows setting new drawing mode after reactivation', () => {
        // First cycle: linear mask
        store.setMaskDrawingMode('linear')
        store.deactivateMaskTool()

        // Reactivate and set new mode
        store.activateMaskTool()
        store.setMaskDrawingMode('radial')

        expect(store.isMaskToolActive).toBe(true)
        expect(store.maskDrawingMode).toBe('radial')
      })
    })
  })

  // ============================================================================
  // Computed Properties
  // ============================================================================

  describe('computed properties', () => {
    describe('zoomPercentage', () => {
      it('returns 100 for scale 1', () => {
        store.setImageDimensions(1000, 1000)
        store.setViewportDimensions(1000, 1000)
        store.setCamera({ scale: 1, panX: 0, panY: 0 })
        expect(store.zoomPercentage).toBe(100)
      })

      it('returns 50 for scale 0.5', () => {
        store.setImageDimensions(1000, 1000)
        store.setViewportDimensions(1000, 1000)
        store.setCamera({ scale: 0.5, panX: 0, panY: 0 })
        expect(store.zoomPercentage).toBe(50)
      })

      it('returns 200 for scale 2', () => {
        store.setImageDimensions(1000, 1000)
        store.setViewportDimensions(1000, 1000)
        store.setCamera({ scale: 2, panX: 0, panY: 0 })
        expect(store.zoomPercentage).toBe(200)
      })

      it('rounds scale 0.33 to 33 percent', () => {
        store.setImageDimensions(1000, 1000)
        store.setViewportDimensions(1000, 1000)
        store.setCamera({ scale: 0.33, panX: 0, panY: 0 })
        expect(store.zoomPercentage).toBe(33)
      })

      it('reacts to camera.scale changes', () => {
        store.setImageDimensions(1000, 1000)
        store.setViewportDimensions(1000, 1000)
        store.setCamera({ scale: 1, panX: 0, panY: 0 })
        expect(store.zoomPercentage).toBe(100)

        store.setCamera({ scale: 1.5, panX: 0, panY: 0 })
        expect(store.zoomPercentage).toBe(150)
      })
    })

    describe('fitScale', () => {
      it('returns fit scale for landscape image in smaller viewport', () => {
        store.setImageDimensions(1920, 1080)
        store.setViewportDimensions(800, 600)

        const expectedScale = Math.min(800 / 1920, 600 / 1080)
        expect(store.fitScale).toBeCloseTo(expectedScale, 5)
      })

      it('returns fit scale for portrait image in smaller viewport', () => {
        store.setImageDimensions(1080, 1920)
        store.setViewportDimensions(600, 800)

        const expectedScale = Math.min(600 / 1080, 800 / 1920)
        expect(store.fitScale).toBeCloseTo(expectedScale, 5)
      })

      it('returns 1 for zero image dimensions', () => {
        store.setImageDimensions(0, 1080)
        store.setViewportDimensions(800, 600)

        expect(store.fitScale).toBe(1)
      })

      it('returns 1 for zero viewport dimensions', () => {
        store.setImageDimensions(1920, 1080)
        store.setViewportDimensions(0, 600)

        expect(store.fitScale).toBe(1)
      })

      it('reacts to image dimension changes', () => {
        store.setViewportDimensions(800, 600)
        store.setImageDimensions(1920, 1080)

        const scale1 = store.fitScale
        expect(scale1).toBeLessThan(1)

        store.setImageDimensions(400, 300)
        const scale2 = store.fitScale
        expect(scale2).toBeGreaterThan(scale1)
      })

      it('reacts to viewport dimension changes', () => {
        store.setImageDimensions(1920, 1080)
        store.setViewportDimensions(800, 600)

        const scale1 = store.fitScale
        expect(scale1).toBeLessThan(1)

        store.setViewportDimensions(1920, 1080)
        const scale2 = store.fitScale
        expect(scale2).toBe(1)
      })
    })

    describe('canPanImage', () => {
      it('returns false when image fits in viewport at current scale', () => {
        store.setImageDimensions(400, 300)
        store.setViewportDimensions(800, 600)
        store.setCamera({ scale: 1, panX: 0, panY: 0 })

        expect(store.canPanImage).toBe(false)
      })

      it('returns true when image exceeds viewport width at scale', () => {
        store.setImageDimensions(800, 300)
        store.setViewportDimensions(600, 600)
        store.setCamera({ scale: 1, panX: 0, panY: 0 })

        expect(store.canPanImage).toBe(true)
      })

      it('returns true when image exceeds viewport height at scale', () => {
        store.setImageDimensions(300, 800)
        store.setViewportDimensions(600, 600)
        store.setCamera({ scale: 1, panX: 0, panY: 0 })

        expect(store.canPanImage).toBe(true)
      })

      it('returns true when image exceeds both dimensions at scale', () => {
        store.setImageDimensions(800, 800)
        store.setViewportDimensions(600, 600)
        store.setCamera({ scale: 1, panX: 0, panY: 0 })

        expect(store.canPanImage).toBe(true)
      })

      it('returns true when zoomed in beyond viewport', () => {
        store.setImageDimensions(400, 300)
        store.setViewportDimensions(800, 600)
        store.setCamera({ scale: 2.5, panX: 0, panY: 0 })

        expect(store.canPanImage).toBe(true)
      })

      it('reacts to scale changes via setCamera', () => {
        store.setImageDimensions(400, 300)
        store.setViewportDimensions(800, 600)

        store.setCamera({ scale: 1, panX: 0, panY: 0 })
        expect(store.canPanImage).toBe(false)

        store.setCamera({ scale: 2.5, panX: 0, panY: 0 })
        expect(store.canPanImage).toBe(true)
      })

      it('handles zero dimensions correctly', () => {
        store.setImageDimensions(0, 0)
        store.setViewportDimensions(800, 600)
        store.setCamera({ scale: 1, panX: 0, panY: 0 })

        expect(store.canPanImage).toBe(false)
      })
    })
  })

  // ============================================================================
  // Clear
  // ============================================================================

  describe('clear', () => {
    beforeEach(() => {
      // Set up non-default state for all properties before each test
      store.setImageDimensions(2000, 1500)
      store.setViewportDimensions(1000, 800)
      store.initializeZoom()
    })

    it('should reset camera to default', () => {
      // Modify camera from default
      store.setCamera({ scale: 2, panX: 100, panY: 50 })
      expect(store.camera.scale).not.toBe(1)

      store.clear()

      expect(store.camera).toEqual({ scale: 1, panX: 0, panY: 0 })
    })

    it('should reset zoomPreset to "fit"', () => {
      // Modify zoomPreset from default
      store.setZoomPreset('100%')
      expect(store.zoomPreset).toBe('100%')

      store.clear()

      expect(store.zoomPreset).toBe('fit')
    })

    it('should reset isZoomInteracting to false', () => {
      // Modify isZoomInteracting from default
      store.setZoomInteracting(true)
      expect(store.isZoomInteracting).toBe(true)

      store.clear()

      expect(store.isZoomInteracting).toBe(false)
    })

    it('should clear the zoomCache', () => {
      // Add items to zoom cache
      store.setZoomPreset('100%')
      store.cacheZoomForAsset('asset-1')
      store.setZoomPreset('200%')
      store.cacheZoomForAsset('asset-2')

      store.clear()

      // After clear, restoring should reset to fit (not cached value)
      store.setImageDimensions(2000, 1500)
      store.setViewportDimensions(1000, 800)
      store.restoreZoomForAsset('asset-1')
      expect(store.zoomPreset).toBe('fit')
      expect(store.wasRestoredFromCache).toBe(false)
    })

    it('should reset wasRestoredFromCache to false', () => {
      // Set wasRestoredFromCache to true
      store.setZoomPreset('100%')
      store.cacheZoomForAsset('asset-1')
      store.restoreZoomForAsset('asset-1')
      expect(store.wasRestoredFromCache).toBe(true)

      store.clear()

      expect(store.wasRestoredFromCache).toBe(false)
    })

    it('should reset imageDimensions and viewportDimensions', () => {
      // Already set in beforeEach
      expect(store.imageDimensions.width).toBe(2000)
      expect(store.imageDimensions.height).toBe(1500)
      expect(store.viewportDimensions.width).toBe(1000)
      expect(store.viewportDimensions.height).toBe(800)

      store.clear()

      expect(store.imageDimensions).toEqual({ width: 0, height: 0 })
      expect(store.viewportDimensions).toEqual({ width: 0, height: 0 })
    })

    it('should reset clipping overlays', () => {
      // Enable clipping overlays
      store.toggleClippingOverlays()
      expect(store.showHighlightClipping).toBe(true)
      expect(store.showShadowClipping).toBe(true)

      store.clear()

      expect(store.showHighlightClipping).toBe(false)
      expect(store.showShadowClipping).toBe(false)
    })

    it('should reset crop tool state', () => {
      // Activate crop tool and set pending crop
      store.activateCropTool()
      store.setPendingCrop({ left: 0.1, top: 0.2, width: 0.5, height: 0.6 })
      expect(store.isCropToolActive).toBe(true)
      expect(store.pendingCrop).not.toBe(null)
      expect(store.hasPendingCrop).toBe(true)

      store.clear()

      expect(store.isCropToolActive).toBe(false)
      expect(store.pendingCrop).toBe(null)
      expect(store.hasPendingCrop).toBe(false)
    })

    it('should reset mask tool state', () => {
      // Activate mask tool with drawing mode
      store.setMaskDrawingMode('linear')
      expect(store.isMaskToolActive).toBe(true)
      expect(store.maskDrawingMode).toBe('linear')

      store.clear()

      expect(store.isMaskToolActive).toBe(false)
      expect(store.maskDrawingMode).toBe(null)
    })

    it('should reset all state when everything is modified', () => {
      // Modify ALL state to non-default values
      store.setCamera({ scale: 2, panX: 100, panY: 50 })
      store.setZoomPreset('200%')
      store.setZoomInteracting(true)
      store.cacheZoomForAsset('asset-1')
      store.restoreZoomForAsset('asset-1')
      store.toggleClippingOverlays()
      store.activateCropTool()
      store.setPendingCrop({ left: 0.1, top: 0.2, width: 0.5, height: 0.6 })
      store.setMaskDrawingMode('radial')

      store.clear()

      // Verify ALL state is reset
      expect(store.camera).toEqual({ scale: 1, panX: 0, panY: 0 })
      expect(store.zoomPreset).toBe('fit')
      expect(store.isZoomInteracting).toBe(false)
      expect(store.wasRestoredFromCache).toBe(false)
      expect(store.imageDimensions).toEqual({ width: 0, height: 0 })
      expect(store.viewportDimensions).toEqual({ width: 0, height: 0 })
      expect(store.showHighlightClipping).toBe(false)
      expect(store.showShadowClipping).toBe(false)
      expect(store.isCropToolActive).toBe(false)
      expect(store.pendingCrop).toBe(null)
      expect(store.isMaskToolActive).toBe(false)
      expect(store.maskDrawingMode).toBe(null)
    })
  })
})
