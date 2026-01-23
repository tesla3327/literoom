/**
 * Zoom Calculations
 *
 * Pure functions for zoom/pan math calculations.
 * These are UI-only calculations that don't involve image processing.
 */

// ============================================================================
// Types
// ============================================================================

/**
 * Camera state representing current zoom and pan position.
 * panX/panY are in viewport pixels (before scaling).
 */
export interface Camera {
  scale: number
  panX: number
  panY: number
}

/**
 * Preset zoom levels for quick access.
 */
export type ZoomPreset = 'fit' | 'fill' | '50%' | '100%' | '200%' | 'custom'

/**
 * Point coordinates.
 */
export interface Point {
  x: number
  y: number
}

// ============================================================================
// Constants
// ============================================================================

/** Minimum zoom level (can zoom out to 10% or half of fit, whichever is smaller) */
export const MIN_ZOOM = 0.1

/** Maximum zoom level (400%) */
export const MAX_ZOOM = 4.0

/** Zoom step multiplier for incremental zoom */
export const ZOOM_STEP = 1.1

/** Debounce delay for zoom state caching (ms) */
export const ZOOM_CACHE_DEBOUNCE = 300

// ============================================================================
// Scale Calculations
// ============================================================================

/**
 * Calculate the scale needed to fit the entire image within the viewport.
 * Returns a scale where the image fits completely with possible letterboxing.
 */
export function calculateFitScale(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (imageWidth === 0 || imageHeight === 0) return 1
  if (viewportWidth === 0 || viewportHeight === 0) return 1

  const scaleX = viewportWidth / imageWidth
  const scaleY = viewportHeight / imageHeight

  return Math.min(scaleX, scaleY)
}

/**
 * Calculate the scale needed to fill the viewport with the image.
 * Returns a scale where the image covers the entire viewport (may crop).
 */
export function calculateFillScale(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (imageWidth === 0 || imageHeight === 0) return 1
  if (viewportWidth === 0 || viewportHeight === 0) return 1

  const scaleX = viewportWidth / imageWidth
  const scaleY = viewportHeight / imageHeight

  return Math.max(scaleX, scaleY)
}

/**
 * Get the scale value for a zoom preset.
 */
export function getScaleForPreset(
  preset: ZoomPreset,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  switch (preset) {
    case 'fit':
      return calculateFitScale(imageWidth, imageHeight, viewportWidth, viewportHeight)
    case 'fill':
      return calculateFillScale(imageWidth, imageHeight, viewportWidth, viewportHeight)
    case '50%':
      return 0.5
    case '100%':
      return 1.0
    case '200%':
      return 2.0
    case 'custom':
      // Custom doesn't have a specific scale - return current
      return 1.0
    default:
      return 1.0
  }
}

/**
 * Clamp a scale value to min/max bounds.
 * The minimum is either MIN_ZOOM or half of fit scale, whichever is smaller.
 */
export function clampScale(
  scale: number,
  fitScale: number,
): number {
  const minScale = Math.min(MIN_ZOOM, fitScale * 0.5)
  return Math.max(minScale, Math.min(MAX_ZOOM, scale))
}

// ============================================================================
// Pan Calculations
// ============================================================================

/**
 * Clamp pan values to keep the image center visible in the viewport.
 * When zoomed out (image smaller than viewport), center the image.
 * When zoomed in, allow panning but keep at least half the image visible.
 */
export function clampPan(
  camera: Camera,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): Camera {
  const scaledWidth = imageWidth * camera.scale
  const scaledHeight = imageHeight * camera.scale

  // Calculate the centered position
  const centerX = (viewportWidth - scaledWidth) / 2
  const centerY = (viewportHeight - scaledHeight) / 2

  // If image fits in viewport, center it (no pan)
  if (scaledWidth <= viewportWidth && scaledHeight <= viewportHeight) {
    return {
      ...camera,
      panX: centerX,
      panY: centerY,
    }
  }

  // Calculate max pan distances from center
  // Allow panning so that at most half the image is outside viewport
  const maxPanX = Math.max(0, (scaledWidth - viewportWidth) / 2)
  const maxPanY = Math.max(0, (scaledHeight - viewportHeight) / 2)

  // Pan is relative to center, so clamp around center position
  const clampedPanX = clamp(camera.panX, centerX - maxPanX, centerX + maxPanX)
  const clampedPanY = clamp(camera.panY, centerY - maxPanY, centerY + maxPanY)

  return {
    ...camera,
    panX: clampedPanX,
    panY: clampedPanY,
  }
}

/**
 * Calculate centered pan position for a given scale.
 */
export function calculateCenteredPan(
  scale: number,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): { panX: number; panY: number } {
  const scaledWidth = imageWidth * scale
  const scaledHeight = imageHeight * scale

  return {
    panX: (viewportWidth - scaledWidth) / 2,
    panY: (viewportHeight - scaledHeight) / 2,
  }
}

// ============================================================================
// Zoom Operations
// ============================================================================

/**
 * Zoom to a specific scale, keeping a point fixed on screen.
 * This is used for wheel zoom where the cursor position should remain stationary.
 *
 * @param camera - Current camera state
 * @param newScale - Target scale
 * @param pivotX - Screen X coordinate to keep fixed
 * @param pivotY - Screen Y coordinate to keep fixed
 */
export function zoomToPoint(
  camera: Camera,
  newScale: number,
  pivotX: number,
  pivotY: number,
): Camera {
  // Convert pivot from screen to image coordinates at old scale
  const imageX = (pivotX - camera.panX) / camera.scale
  const imageY = (pivotY - camera.panY) / camera.scale

  // Calculate new pan to keep the same image point under the cursor
  const newPanX = pivotX - imageX * newScale
  const newPanY = pivotY - imageY * newScale

  return {
    scale: newScale,
    panX: newPanX,
    panY: newPanY,
  }
}

/**
 * Zoom in by one step.
 */
export function zoomIn(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  fitScale: number,
): Camera {
  const newScale = clampScale(camera.scale * ZOOM_STEP, fitScale)
  // Zoom toward center of viewport
  return zoomToPoint(camera, newScale, viewportWidth / 2, viewportHeight / 2)
}

/**
 * Zoom out by one step.
 */
export function zoomOut(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  fitScale: number,
): Camera {
  const newScale = clampScale(camera.scale / ZOOM_STEP, fitScale)
  // Zoom toward center of viewport
  return zoomToPoint(camera, newScale, viewportWidth / 2, viewportHeight / 2)
}

// ============================================================================
// Coordinate Conversion
// ============================================================================

/**
 * Convert screen coordinates to image coordinates.
 * Used for overlay hit detection when zoomed/panned.
 */
export function screenToImage(
  screenX: number,
  screenY: number,
  camera: Camera,
): Point {
  return {
    x: (screenX - camera.panX) / camera.scale,
    y: (screenY - camera.panY) / camera.scale,
  }
}

/**
 * Convert image coordinates to screen coordinates.
 * Used for positioning overlays when zoomed/panned.
 */
export function imageToScreen(
  imageX: number,
  imageY: number,
  camera: Camera,
): Point {
  return {
    x: imageX * camera.scale + camera.panX,
    y: imageY * camera.scale + camera.panY,
  }
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Clamp a value between min and max.
 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/**
 * Check if camera allows panning (image larger than viewport at current scale).
 */
export function canPan(
  camera: Camera,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): boolean {
  const scaledWidth = imageWidth * camera.scale
  const scaledHeight = imageHeight * camera.scale

  return scaledWidth > viewportWidth || scaledHeight > viewportHeight
}

/**
 * Create a camera state for a zoom preset.
 */
export function createCameraForPreset(
  preset: ZoomPreset,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): Camera {
  const scale = getScaleForPreset(preset, imageWidth, imageHeight, viewportWidth, viewportHeight)
  const { panX, panY } = calculateCenteredPan(scale, imageWidth, imageHeight, viewportWidth, viewportHeight)

  return { scale, panX, panY }
}

/**
 * Calculate zoom percentage for display (100 = native resolution).
 */
export function getZoomPercentage(scale: number): number {
  return Math.round(scale * 100)
}

/**
 * Determine which preset (if any) matches the current camera state.
 * Returns 'custom' if no preset matches.
 */
export function detectPreset(
  camera: Camera,
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): ZoomPreset {
  const fitScale = calculateFitScale(imageWidth, imageHeight, viewportWidth, viewportHeight)
  const fillScale = calculateFillScale(imageWidth, imageHeight, viewportWidth, viewportHeight)

  const tolerance = 0.001

  if (Math.abs(camera.scale - fitScale) < tolerance) return 'fit'
  if (Math.abs(camera.scale - fillScale) < tolerance) return 'fill'
  if (Math.abs(camera.scale - 0.5) < tolerance) return '50%'
  if (Math.abs(camera.scale - 1.0) < tolerance) return '100%'
  if (Math.abs(camera.scale - 2.0) < tolerance) return '200%'

  return 'custom'
}
