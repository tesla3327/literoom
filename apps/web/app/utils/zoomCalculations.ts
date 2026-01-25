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

/**
 * Combined image and viewport dimensions for zoom calculations.
 */
export interface Dimensions {
  imageWidth: number
  imageHeight: number
  viewportWidth: number
  viewportHeight: number
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

/** Check if dimensions are valid (non-zero) */
function hasValidDimensions(d: Dimensions): boolean {
  return d.imageWidth > 0 && d.imageHeight > 0 && d.viewportWidth > 0 && d.viewportHeight > 0
}

/** Calculate X and Y scale factors */
function calculateScaleFactors(d: Dimensions): { scaleX: number; scaleY: number } {
  return {
    scaleX: d.viewportWidth / d.imageWidth,
    scaleY: d.viewportHeight / d.imageHeight,
  }
}

/** Calculate centered pan position for scaled image */
function calculateCenteredPosition(scaledWidth: number, scaledHeight: number, viewportWidth: number, viewportHeight: number): { centerX: number; centerY: number } {
  return {
    centerX: (viewportWidth - scaledWidth) / 2,
    centerY: (viewportHeight - scaledHeight) / 2,
  }
}

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
  const d: Dimensions = { imageWidth, imageHeight, viewportWidth, viewportHeight }
  if (!hasValidDimensions(d)) return 1
  const { scaleX, scaleY } = calculateScaleFactors(d)
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
  const d: Dimensions = { imageWidth, imageHeight, viewportWidth, viewportHeight }
  if (!hasValidDimensions(d)) return 1
  const { scaleX, scaleY } = calculateScaleFactors(d)
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
  const { centerX, centerY } = calculateCenteredPosition(scaledWidth, scaledHeight, viewportWidth, viewportHeight)

  // If image fits in viewport, center it (no pan)
  if (scaledWidth <= viewportWidth && scaledHeight <= viewportHeight) {
    return { ...camera, panX: centerX, panY: centerY }
  }

  // Calculate max pan distances from center (allow panning so at most half the image is outside viewport)
  const maxPanX = Math.max(0, (scaledWidth - viewportWidth) / 2)
  const maxPanY = Math.max(0, (scaledHeight - viewportHeight) / 2)

  return {
    ...camera,
    panX: clamp(camera.panX, centerX - maxPanX, centerX + maxPanX),
    panY: clamp(camera.panY, centerY - maxPanY, centerY + maxPanY),
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
  const { centerX, centerY } = calculateCenteredPosition(imageWidth * scale, imageHeight * scale, viewportWidth, viewportHeight)
  return { panX: centerX, panY: centerY }
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

/** Check if two scales are approximately equal */
function scalesMatch(a: number, b: number, tolerance = 0.001): boolean {
  return Math.abs(a - b) < tolerance
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
  const scale = camera.scale
  if (scalesMatch(scale, calculateFitScale(imageWidth, imageHeight, viewportWidth, viewportHeight))) return 'fit'
  if (scalesMatch(scale, calculateFillScale(imageWidth, imageHeight, viewportWidth, viewportHeight))) return 'fill'
  if (scalesMatch(scale, 0.5)) return '50%'
  if (scalesMatch(scale, 1.0)) return '100%'
  if (scalesMatch(scale, 2.0)) return '200%'
  return 'custom'
}
