/**
 * Edit UI Store
 *
 * Manages UI state for the edit view that needs to be shared across components.
 * This includes clipping overlay toggles, zoom/pan state, and other UI-only
 * state that doesn't persist with the edit settings.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Camera, ZoomPreset } from '~/utils/zoomCalculations'
import {
  calculateCenteredPan,
  calculateFitScale,
  clampPan,
  clampScale,
  createCameraForPreset,
  detectPreset,
  getZoomPercentage,
  zoomIn as zoomInCalc,
  zoomOut as zoomOutCalc,
  zoomToPoint,
} from '~/utils/zoomCalculations'

/** Per-image cached zoom state */
interface CachedZoomState {
  camera: Camera
  preset: ZoomPreset
}

/** Maximum number of zoom states to cache per image */
const ZOOM_CACHE_MAX_SIZE = 50

export const useEditUIStore = defineStore('editUI', () => {
  // ============================================================================
  // Zoom/Pan State
  // ============================================================================

  /** Current camera state (scale + pan) */
  const camera = ref<Camera>({ scale: 1, panX: 0, panY: 0 })

  /** Current zoom preset (fit, fill, 100%, etc.) */
  const zoomPreset = ref<ZoomPreset>('fit')

  /** Whether user is currently interacting (dragging/zooming) */
  const isZoomInteracting = ref(false)

  /** Per-image zoom cache (LRU) */
  const zoomCache = ref<Map<string, CachedZoomState>>(new Map())

  /** Current image dimensions (needed for calculations) */
  const imageDimensions = ref({ width: 0, height: 0 })

  /** Current viewport dimensions (needed for calculations) */
  const viewportDimensions = ref({ width: 0, height: 0 })

  // ============================================================================
  // Zoom/Pan Computed
  // ============================================================================

  /** Current zoom as a percentage (100 = native resolution) */
  const zoomPercentage = computed(() => getZoomPercentage(camera.value.scale))

  /** Fit scale for current image/viewport */
  const fitScale = computed(() =>
    calculateFitScale(
      imageDimensions.value.width,
      imageDimensions.value.height,
      viewportDimensions.value.width,
      viewportDimensions.value.height,
    ),
  )

  /** Whether panning is currently allowed (zoomed in) */
  const canPanImage = computed(() => {
    const scaledWidth = imageDimensions.value.width * camera.value.scale
    const scaledHeight = imageDimensions.value.height * camera.value.scale
    return (
      scaledWidth > viewportDimensions.value.width
      || scaledHeight > viewportDimensions.value.height
    )
  })

  // ============================================================================
  // Zoom/Pan Methods
  // ============================================================================

  /**
   * Set viewport dimensions (called when container resizes).
   */
  function setViewportDimensions(width: number, height: number): void {
    viewportDimensions.value = { width, height }
  }

  /**
   * Set image dimensions (called when image loads).
   */
  function setImageDimensions(width: number, height: number): void {
    imageDimensions.value = { width, height }
  }

  /**
   * Set camera state directly.
   */
  function setCamera(newCamera: Camera): void {
    // Clamp the pan to valid bounds
    const clamped = clampPan(
      { ...newCamera, scale: clampScale(newCamera.scale, fitScale.value) },
      imageDimensions.value.width,
      imageDimensions.value.height,
      viewportDimensions.value.width,
      viewportDimensions.value.height,
    )
    camera.value = clamped

    // Update preset based on new state
    zoomPreset.value = detectPreset(
      clamped,
      imageDimensions.value.width,
      imageDimensions.value.height,
      viewportDimensions.value.width,
      viewportDimensions.value.height,
    )
  }

  /**
   * Set zoom preset and update camera accordingly.
   */
  function setZoomPreset(preset: ZoomPreset): void {
    if (preset === 'custom') return // Can't explicitly set custom

    const newCamera = createCameraForPreset(
      preset,
      imageDimensions.value.width,
      imageDimensions.value.height,
      viewportDimensions.value.width,
      viewportDimensions.value.height,
    )

    camera.value = newCamera
    zoomPreset.value = preset
  }

  /**
   * Zoom to a specific point (for wheel zoom).
   */
  function zoomToPointAction(newScale: number, pivotX: number, pivotY: number): void {
    const clampedScale = clampScale(newScale, fitScale.value)
    const newCamera = zoomToPoint(camera.value, clampedScale, pivotX, pivotY)
    setCamera(newCamera)
  }

  /**
   * Zoom in by one step.
   */
  function zoomIn(): void {
    const newCamera = zoomInCalc(
      camera.value,
      viewportDimensions.value.width,
      viewportDimensions.value.height,
      fitScale.value,
    )
    setCamera(newCamera)
  }

  /**
   * Zoom out by one step.
   */
  function zoomOut(): void {
    const newCamera = zoomOutCalc(
      camera.value,
      viewportDimensions.value.width,
      viewportDimensions.value.height,
      fitScale.value,
    )
    setCamera(newCamera)
  }

  /**
   * Toggle between fit and 100% zoom.
   */
  function toggleZoom(): void {
    if (zoomPreset.value === 'fit') {
      setZoomPreset('100%')
    }
    else {
      setZoomPreset('fit')
    }
  }

  /**
   * Reset zoom to fit.
   */
  function resetZoom(): void {
    setZoomPreset('fit')
  }

  /**
   * Pan by a delta amount.
   */
  function pan(deltaX: number, deltaY: number): void {
    setCamera({
      ...camera.value,
      panX: camera.value.panX + deltaX,
      panY: camera.value.panY + deltaY,
    })
  }

  /**
   * Set interacting state.
   */
  function setZoomInteracting(interacting: boolean): void {
    isZoomInteracting.value = interacting
  }

  /**
   * Cache current zoom state for an asset.
   */
  function cacheZoomForAsset(assetId: string): void {
    // LRU eviction if at max size
    if (zoomCache.value.size >= ZOOM_CACHE_MAX_SIZE) {
      const firstKey = zoomCache.value.keys().next().value
      if (firstKey) {
        zoomCache.value.delete(firstKey)
      }
    }

    zoomCache.value.set(assetId, {
      camera: { ...camera.value },
      preset: zoomPreset.value,
    })
  }

  /**
   * Restore zoom state for an asset, or reset to fit if not cached.
   */
  function restoreZoomForAsset(assetId: string): void {
    const cached = zoomCache.value.get(assetId)

    if (cached) {
      // Move to end for LRU
      zoomCache.value.delete(assetId)
      zoomCache.value.set(assetId, cached)

      camera.value = { ...cached.camera }
      zoomPreset.value = cached.preset
    }
    else {
      // Reset to fit
      resetZoom()
    }
  }

  /**
   * Initialize zoom state when image/viewport dimensions change.
   * Called after both dimensions are set.
   */
  function initializeZoom(): void {
    // If currently at fit preset, recalculate to fit new dimensions
    if (zoomPreset.value === 'fit') {
      const newCamera = createCameraForPreset(
        'fit',
        imageDimensions.value.width,
        imageDimensions.value.height,
        viewportDimensions.value.width,
        viewportDimensions.value.height,
      )
      camera.value = newCamera
    }
    else {
      // Recalculate pan to keep image properly positioned
      const clamped = clampPan(
        camera.value,
        imageDimensions.value.width,
        imageDimensions.value.height,
        viewportDimensions.value.width,
        viewportDimensions.value.height,
      )
      camera.value = clamped
    }
  }

  // ============================================================================
  // Clipping Overlay State
  // ============================================================================

  /** Whether to show highlight clipping overlay on the preview */
  const showHighlightClipping = ref(false)

  /** Whether to show shadow clipping overlay on the preview */
  const showShadowClipping = ref(false)

  // ============================================================================
  // Crop Tool State
  // ============================================================================

  /** Whether the crop tool is active (overlay visible on main preview) */
  const isCropToolActive = ref(false)

  // ============================================================================
  // Mask Tool State
  // ============================================================================

  /** Whether the mask tool is active (overlay visible on main preview) */
  const isMaskToolActive = ref(false)

  /** Current mask drawing mode: 'linear', 'radial', or null (not drawing) */
  const maskDrawingMode = ref<'linear' | 'radial' | null>(null)

  // ============================================================================
  // Clipping Toggle Methods
  // ============================================================================

  /**
   * Toggle both clipping overlays (J key behavior).
   * If either overlay is on, turn both off. Otherwise, turn both on.
   */
  function toggleClippingOverlays(): void {
    if (showHighlightClipping.value || showShadowClipping.value) {
      showHighlightClipping.value = false
      showShadowClipping.value = false
    }
    else {
      showHighlightClipping.value = true
      showShadowClipping.value = true
    }
  }

  /**
   * Toggle shadow clipping overlay only.
   */
  function toggleShadowClipping(): void {
    showShadowClipping.value = !showShadowClipping.value
  }

  /**
   * Toggle highlight clipping overlay only.
   */
  function toggleHighlightClipping(): void {
    showHighlightClipping.value = !showHighlightClipping.value
  }

  /**
   * Reset all clipping overlays to hidden.
   */
  function resetClippingOverlays(): void {
    showHighlightClipping.value = false
    showShadowClipping.value = false
  }

  // ============================================================================
  // Crop Tool Methods
  // ============================================================================

  /**
   * Activate the crop tool (show overlay on main preview).
   */
  function activateCropTool(): void {
    isCropToolActive.value = true
  }

  /**
   * Deactivate the crop tool (hide overlay on main preview).
   */
  function deactivateCropTool(): void {
    isCropToolActive.value = false
  }

  /**
   * Toggle the crop tool active state.
   */
  function toggleCropTool(): void {
    isCropToolActive.value = !isCropToolActive.value
  }

  // ============================================================================
  // Mask Tool Methods
  // ============================================================================

  /**
   * Activate the mask tool (show overlay on main preview).
   */
  function activateMaskTool(): void {
    isMaskToolActive.value = true
  }

  /**
   * Deactivate the mask tool and exit drawing mode.
   */
  function deactivateMaskTool(): void {
    isMaskToolActive.value = false
    maskDrawingMode.value = null
  }

  /**
   * Set the mask drawing mode for creating new masks.
   * Setting a mode automatically activates the mask tool.
   */
  function setMaskDrawingMode(mode: 'linear' | 'radial' | null): void {
    maskDrawingMode.value = mode
    if (mode) {
      isMaskToolActive.value = true
    }
  }

  /**
   * Cancel the current drawing mode without deactivating the mask tool.
   */
  function cancelMaskDrawing(): void {
    maskDrawingMode.value = null
  }

  return {
    // Zoom/Pan State
    camera,
    zoomPreset,
    isZoomInteracting,
    imageDimensions,
    viewportDimensions,
    // Zoom/Pan Computed
    zoomPercentage,
    fitScale,
    canPanImage,
    // Zoom/Pan Methods
    setViewportDimensions,
    setImageDimensions,
    setCamera,
    setZoomPreset,
    zoomToPointAction,
    zoomIn,
    zoomOut,
    toggleZoom,
    resetZoom,
    pan,
    setZoomInteracting,
    cacheZoomForAsset,
    restoreZoomForAsset,
    initializeZoom,
    // Clipping State
    showHighlightClipping,
    showShadowClipping,
    // Clipping Methods
    toggleClippingOverlays,
    toggleShadowClipping,
    toggleHighlightClipping,
    resetClippingOverlays,
    // Crop Tool State
    isCropToolActive,
    // Crop Tool Methods
    activateCropTool,
    deactivateCropTool,
    toggleCropTool,
    // Mask Tool State
    isMaskToolActive,
    maskDrawingMode,
    // Mask Tool Methods
    activateMaskTool,
    deactivateMaskTool,
    setMaskDrawingMode,
    cancelMaskDrawing,
  }
})
