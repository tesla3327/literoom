/**
 * Edit UI Store
 *
 * Manages UI state for the edit view that needs to be shared across components.
 * This includes clipping overlay toggles, zoom/pan state, and other UI-only
 * state that doesn't persist with the edit settings.
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CropRectangle } from '@literoom/core/catalog'
import type { Camera, Dimensions, ZoomPreset } from '~/utils/zoomCalculations'
import {
  calculateFitScale,
  clampPan,
  clampScale,
  createCameraForPreset,
  detectPreset,
  getZoomPercentage,
  hasValidDimensions,
  zoomIn as zoomInCalc,
  zoomOut as zoomOutCalc,
  zoomToPoint,
} from '~/utils/zoomCalculations'

/** Standard presets that should recalculate camera on initializeZoom */
const STANDARD_PRESETS: ReadonlySet<ZoomPreset> = new Set(['fit', 'fill', '100%', '200%'])

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

  /**
   * Flag to indicate that zoom was restored from cache.
   * When true, initializeZoom() will only clamp pan instead of recalculating camera.
   * This preserves the user's per-image zoom preferences.
   */
  const wasRestoredFromCache = ref(false)

  /** Current image dimensions (needed for calculations) */
  const imageDimensions = ref({ width: 0, height: 0 })

  /** Current viewport dimensions (needed for calculations) */
  const viewportDimensions = ref({ width: 0, height: 0 })

  // ============================================================================
  // Dimension Helpers
  // ============================================================================

  /** Get current dimensions as a Dimensions object for calculation functions */
  function getDimensions(): Dimensions {
    return {
      imageWidth: imageDimensions.value.width,
      imageHeight: imageDimensions.value.height,
      viewportWidth: viewportDimensions.value.width,
      viewportHeight: viewportDimensions.value.height,
    }
  }

  // ============================================================================
  // Zoom/Pan Computed
  // ============================================================================

  /** Current zoom as a percentage (100 = native resolution) */
  const zoomPercentage = computed(() => getZoomPercentage(camera.value.scale))

  /** Fit scale for current image/viewport */
  const fitScale = computed(() => {
    const d = getDimensions()
    return calculateFitScale(d.imageWidth, d.imageHeight, d.viewportWidth, d.viewportHeight)
  })

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
    const d = getDimensions()
    // Clamp the pan to valid bounds
    const clamped = clampPan(
      { ...newCamera, scale: clampScale(newCamera.scale, fitScale.value) },
      d.imageWidth,
      d.imageHeight,
      d.viewportWidth,
      d.viewportHeight,
    )
    camera.value = clamped

    // Update preset based on new state
    zoomPreset.value = detectPreset(clamped, d.imageWidth, d.imageHeight, d.viewportWidth, d.viewportHeight)
  }

  /**
   * Set zoom preset and update camera accordingly.
   *
   * NOTE: Camera is only calculated if we have valid dimensions.
   * If dimensions aren't ready yet (e.g., during asset navigation before
   * the new image loads), the preset is set but camera calculation is
   * deferred to initializeZoom() which runs after dimensions are set.
   */
  function setZoomPreset(preset: ZoomPreset): void {
    if (preset === 'custom') return // Can't explicitly set custom

    // Always update the preset
    zoomPreset.value = preset

    // Only calculate camera if we have valid dimensions
    // This prevents incorrect calculations during asset transitions
    const d = getDimensions()
    if (hasValidDimensions(d)) {
      camera.value = createCameraForPreset(preset, d.imageWidth, d.imageHeight, d.viewportWidth, d.viewportHeight)
    }
    // If dimensions aren't ready, initializeZoom() will calculate when they are
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
   * When zoom is restored from cache, wasRestoredFromCache is set to true
   * so that initializeZoom() knows to only clamp pan instead of recalculating.
   */
  function restoreZoomForAsset(assetId: string): void {
    const cached = zoomCache.value.get(assetId)

    if (cached) {
      // Move to end for LRU
      zoomCache.value.delete(assetId)
      zoomCache.value.set(assetId, cached)

      camera.value = { ...cached.camera }
      zoomPreset.value = cached.preset
      wasRestoredFromCache.value = true
    }
    else {
      // Reset to fit - this is not a restore, so don't set the flag
      wasRestoredFromCache.value = false
      resetZoom()
    }
  }

  /**
   * Initialize zoom state when image/viewport dimensions change.
   * Called after both dimensions are set.
   *
   * This handles three scenarios:
   * 1. Restored from cache: Only clamp pan to preserve user's zoom preference
   * 2. Re-fitting when dimensions change while at a preset (e.g., viewport resize)
   * 3. Initial calculation when setZoomPreset() was called before dimensions were ready
   */
  function initializeZoom(): void {
    const d = getDimensions()
    const preset = zoomPreset.value

    // If zoom was restored from cache, just clamp pan to handle dimension differences
    // This preserves the user's per-image zoom preference
    if (wasRestoredFromCache.value) {
      wasRestoredFromCache.value = false
      camera.value = clampPan(camera.value, d.imageWidth, d.imageHeight, d.viewportWidth, d.viewportHeight)
      return
    }

    // For standard presets, recalculate camera
    // This handles both viewport resize and deferred preset calculations
    if (STANDARD_PRESETS.has(preset)) {
      camera.value = createCameraForPreset(preset, d.imageWidth, d.imageHeight, d.viewportWidth, d.viewportHeight)
    }
    else {
      // For custom zoom, just clamp pan to keep image properly positioned
      camera.value = clampPan(camera.value, d.imageWidth, d.imageHeight, d.viewportWidth, d.viewportHeight)
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

  /**
   * Pending crop state - not yet applied to edit store.
   * This allows users to preview crop changes before committing.
   */
  const pendingCrop = ref<CropRectangle | null>(null)

  /** Whether there is a pending crop that differs from the stored crop */
  const hasPendingCrop = computed(() => pendingCrop.value !== null)

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
   * Initialize pending crop from the edit store's current crop value.
   * Called when activating the crop tool.
   */
  function initializePendingCrop(): void {
    const editStore = useEditStore()
    const currentCrop = editStore.cropTransform.crop
    if (currentCrop) {
      pendingCrop.value = { ...currentCrop }
    }
    else {
      // Default to full image if no crop exists
      pendingCrop.value = { left: 0, top: 0, width: 1, height: 1 }
    }
  }

  /**
   * Update the pending crop state (called during drag interactions).
   */
  function setPendingCrop(crop: CropRectangle | null): void {
    pendingCrop.value = crop ? { ...crop } : null
  }

  /**
   * Apply the pending crop to the edit store and deactivate crop tool.
   */
  function applyPendingCrop(): void {
    const editStore = useEditStore()
    if (pendingCrop.value) {
      const crop = pendingCrop.value
      // Check if it's effectively full image (no crop needed)
      const isFullImage
        = Math.abs(crop.left) < 0.001
          && Math.abs(crop.top) < 0.001
          && Math.abs(crop.width - 1) < 0.001
          && Math.abs(crop.height - 1) < 0.001

      if (isFullImage) {
        editStore.setCrop(null)
      }
      else {
        editStore.setCrop({ ...crop })
      }
    }
    pendingCrop.value = null
    isCropToolActive.value = false
  }

  /**
   * Cancel the pending crop and revert to stored state.
   */
  function cancelPendingCrop(): void {
    pendingCrop.value = null
    isCropToolActive.value = false
  }

  /**
   * Reset pending crop to full image (no crop).
   */
  function resetPendingCrop(): void {
    pendingCrop.value = { left: 0, top: 0, width: 1, height: 1 }
  }

  /**
   * Activate the crop tool (show overlay on main preview).
   * Initializes pending crop from current edit state.
   */
  function activateCropTool(): void {
    initializePendingCrop()
    isCropToolActive.value = true
  }

  /**
   * Deactivate the crop tool (hide overlay on main preview).
   * Note: This does NOT apply pending crop - use applyPendingCrop() or cancelPendingCrop().
   */
  function deactivateCropTool(): void {
    pendingCrop.value = null
    isCropToolActive.value = false
  }

  /**
   * Toggle the crop tool active state.
   */
  function toggleCropTool(): void {
    if (isCropToolActive.value) {
      cancelPendingCrop()
    }
    else {
      activateCropTool()
    }
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

  // ============================================================================
  // Clear All State
  // ============================================================================

  /**
   * Reset ALL UI state to defaults.
   * Call this when leaving the edit view or switching catalogs.
   */
  function clear(): void {
    // Zoom/Pan State
    camera.value = { scale: 1, panX: 0, panY: 0 }
    zoomPreset.value = 'fit'
    isZoomInteracting.value = false
    zoomCache.value = new Map()
    wasRestoredFromCache.value = false
    imageDimensions.value = { width: 0, height: 0 }
    viewportDimensions.value = { width: 0, height: 0 }

    // Clipping State
    showHighlightClipping.value = false
    showShadowClipping.value = false

    // Crop Tool State
    isCropToolActive.value = false
    pendingCrop.value = null

    // Mask Tool State
    isMaskToolActive.value = false
    maskDrawingMode.value = null
  }

  return {
    // Zoom/Pan State
    camera,
    zoomPreset,
    isZoomInteracting,
    imageDimensions,
    viewportDimensions,
    wasRestoredFromCache, // For testing - indicates if last restore was from cache
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
    pendingCrop,
    hasPendingCrop,
    // Crop Tool Methods
    initializePendingCrop,
    setPendingCrop,
    applyPendingCrop,
    cancelPendingCrop,
    resetPendingCrop,
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
    // Clear All State
    clear,
  }
})
