/**
 * Canvas Coordinate Utilities
 *
 * Shared utilities for converting between coordinate systems used
 * by crop, mask, and other canvas overlays.
 */

// ============================================================================
// Math Utilities
// ============================================================================

/**
 * Calculate Euclidean distance between two points.
 */
export function distance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
}

/**
 * Clamp a value to the range [0, 1].
 */
export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

// ============================================================================
// Coordinate Conversion
// ============================================================================

/**
 * Convert canvas coordinates to normalized (0-1) coordinates.
 *
 * @param canvasX - X coordinate in canvas pixels
 * @param canvasY - Y coordinate in canvas pixels
 * @param canvasWidth - Canvas width in pixels
 * @param canvasHeight - Canvas height in pixels
 * @returns Normalized coordinates clamped to [0, 1]
 */
export function toNormalized(
  canvasX: number,
  canvasY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number, y: number } {
  return {
    x: clamp01(canvasX / canvasWidth),
    y: clamp01(canvasY / canvasHeight),
  }
}

/**
 * Convert normalized coordinates to canvas coordinates.
 *
 * @param normX - Normalized X coordinate (0-1)
 * @param normY - Normalized Y coordinate (0-1)
 * @param canvasWidth - Canvas width in pixels
 * @param canvasHeight - Canvas height in pixels
 * @returns Canvas coordinates in pixels
 */
export function toCanvas(
  normX: number,
  normY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number, y: number } {
  return {
    x: normX * canvasWidth,
    y: normY * canvasHeight,
  }
}

/**
 * Get canvas coordinates from mouse event.
 *
 * This function correctly handles CSS transforms (zoom/pan) because
 * getBoundingClientRect() returns the transformed position and size.
 * The formula (e.clientX - rect.left) * (canvas.width / rect.width)
 * correctly converts from screen pixels to canvas pixels regardless
 * of any CSS transform applied to the canvas or its ancestors.
 *
 * @param e - Mouse event
 * @param canvas - Canvas element
 * @returns Canvas coordinates in pixels
 */
export function getCanvasCoords(
  e: MouseEvent,
  canvas: HTMLCanvasElement,
): { x: number, y: number } {
  const rect = canvas.getBoundingClientRect()
  const scaleX = canvas.width / rect.width
  const scaleY = canvas.height / rect.height
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top) * scaleY,
  }
}

// ============================================================================
// Debounce Utility
// ============================================================================

/**
 * Simple debounce function with cancel capability.
 *
 * @param fn - Function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function with cancel method
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      fn(...args)
      timeoutId = null
    }, delay)
  }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced as T & { cancel: () => void }
}
