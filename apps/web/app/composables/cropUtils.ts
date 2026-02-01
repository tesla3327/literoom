/**
 * Crop Utilities
 *
 * Shared utilities for crop overlay rendering and interaction.
 * Used by both useCropEditor (panel) and useCropOverlay (main preview).
 *
 * For coordinate conversion functions (toNormalized, toCanvas, getCanvasCoords)
 * and debounce, import from '~/utils/canvasCoords' directly.
 */

import type { CropRectangle } from '@literoom/core/catalog'

// Import coordinate utilities
import { distance } from '~/utils/canvasCoords'

// ============================================================================
// Constants
// ============================================================================

export const CROP_CROP_HANDLE_SIZE = 12
export const CROP_CROP_HANDLE_HIT_RADIUS = 20

export const COLORS = {
  overlay: 'rgba(0, 0, 0, 0.6)',
  border: '#ffffff',
  borderActive: '#3b82f6',
  grid: 'rgba(255, 255, 255, 0.3)',
  handle: '#ffffff',
  handleActive: '#3b82f6',
}

// ============================================================================
// Types
// ============================================================================

export const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const
export type HandlePosition = (typeof HANDLES)[number]

/**
 * Get handle positions in canvas coordinates.
 */
export function getHandlePositions(
  crop: CropRectangle,
  canvasWidth: number,
  canvasHeight: number,
): Record<HandlePosition, { x: number, y: number }> {
  const left = crop.left * canvasWidth
  const top = crop.top * canvasHeight
  const right = (crop.left + crop.width) * canvasWidth
  const bottom = (crop.top + crop.height) * canvasHeight
  const midX = left + (crop.width * canvasWidth) / 2
  const midY = top + (crop.height * canvasHeight) / 2

  return {
    nw: { x: left, y: top },
    n: { x: midX, y: top },
    ne: { x: right, y: top },
    e: { x: right, y: midY },
    se: { x: right, y: bottom },
    s: { x: midX, y: bottom },
    sw: { x: left, y: bottom },
    w: { x: left, y: midY },
  }
}

/**
 * Find handle at canvas coordinates.
 */
export function findHandleAt(
  canvasX: number,
  canvasY: number,
  crop: CropRectangle,
  canvasWidth: number,
  canvasHeight: number,
): HandlePosition | null {
  const positions = getHandlePositions(crop, canvasWidth, canvasHeight)
  for (const handle of HANDLES) {
    const pos = positions[handle]
    if (distance(canvasX, canvasY, pos.x, pos.y) <= CROP_CROP_HANDLE_HIT_RADIUS) return handle
  }
  return null
}

/**
 * Check if point is inside the crop region (for move).
 */
export function isInsideCrop(
  canvasX: number,
  canvasY: number,
  crop: CropRectangle,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const normX = canvasX / canvasWidth
  const normY = canvasY / canvasHeight
  return (
    normX >= crop.left
    && normX <= crop.left + crop.width
    && normY >= crop.top
    && normY <= crop.top + crop.height
  )
}

// ============================================================================
// Rendering Functions
// ============================================================================

/**
 * Draw dark overlay outside crop region.
 */
export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  crop: CropRectangle,
  w: number,
  h: number,
): void {
  ctx.fillStyle = COLORS.overlay

  // Top
  ctx.fillRect(0, 0, w, crop.top * h)
  // Bottom
  ctx.fillRect(0, (crop.top + crop.height) * h, w, (1 - crop.top - crop.height) * h)
  // Left
  ctx.fillRect(0, crop.top * h, crop.left * w, crop.height * h)
  // Right
  ctx.fillRect(
    (crop.left + crop.width) * w,
    crop.top * h,
    (1 - crop.left - crop.width) * w,
    crop.height * h,
  )
}

/**
 * Draw crop border.
 */
export function drawBorder(
  ctx: CanvasRenderingContext2D,
  crop: CropRectangle,
  w: number,
  h: number,
  isActive: boolean,
): void {
  ctx.strokeStyle = isActive ? COLORS.borderActive : COLORS.border
  ctx.lineWidth = 2
  ctx.strokeRect(crop.left * w, crop.top * h, crop.width * w, crop.height * h)
}

/**
 * Draw rule of thirds grid.
 */
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  crop: CropRectangle,
  w: number,
  h: number,
): void {
  ctx.strokeStyle = COLORS.grid
  ctx.lineWidth = 1

  const cropX = crop.left * w
  const cropY = crop.top * h
  const cropW = crop.width * w
  const cropH = crop.height * h

  // Vertical lines
  for (let i = 1; i < 3; i++) {
    const x = cropX + (cropW * i) / 3
    ctx.beginPath()
    ctx.moveTo(x, cropY)
    ctx.lineTo(x, cropY + cropH)
    ctx.stroke()
  }

  // Horizontal lines
  for (let i = 1; i < 3; i++) {
    const y = cropY + (cropH * i) / 3
    ctx.beginPath()
    ctx.moveTo(cropX, y)
    ctx.lineTo(cropX + cropW, y)
    ctx.stroke()
  }
}

/**
 * Draw resize handles.
 */
export function drawHandles(
  ctx: CanvasRenderingContext2D,
  crop: CropRectangle,
  w: number,
  h: number,
  activeHandle: HandlePosition | null,
): void {
  const positions = getHandlePositions(crop, w, h)
  const half = CROP_CROP_HANDLE_SIZE / 2

  ctx.lineWidth = 1

  for (const handle of HANDLES) {
    const pos = positions[handle]
    const isActive = activeHandle === handle

    // Handle fill
    ctx.fillStyle = isActive ? COLORS.handleActive : COLORS.handle
    ctx.fillRect(pos.x - half, pos.y - half, CROP_CROP_HANDLE_SIZE, CROP_CROP_HANDLE_SIZE)

    // Handle border
    ctx.strokeStyle = '#000'
    ctx.strokeRect(pos.x - half, pos.y - half, CROP_CROP_HANDLE_SIZE, CROP_CROP_HANDLE_SIZE)
  }
}

// ============================================================================
// Cursor Helpers
// ============================================================================

/**
 * Get cursor style for a given handle position.
 */
export function getCursorForHandle(handle: HandlePosition | null): string {
  if (!handle) return 'default'

  const cursors: Record<HandlePosition, string> = {
    nw: 'nwse-resize',
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize',
  }

  return cursors[handle]
}
