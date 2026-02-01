/**
 * Mask Utilities
 *
 * Shared utilities for mask overlay rendering and interaction.
 * Used by useMaskOverlay for creating and editing linear/radial gradient masks.
 *
 * For coordinate conversion functions, import from '~/utils/canvasCoords'.
 * This file provides mask-specific wrappers that return Point2D types.
 */

import type { LinearGradientMask, RadialGradientMask } from '@literoom/core/catalog'
import {
  toCanvas as toCanvasBase,
  distance,
  clamp01,
} from '~/utils/canvasCoords'

// ============================================================================
// Constants
// ============================================================================

export const MASK_HANDLE_SIZE = 10
export const MASK_HANDLE_HIT_RADIUS = 20

export const MASK_COLORS = {
  // Selected mask colors
  selectedLine: '#3b82f6',
  selectedHandle: '#3b82f6',
  selectedFill: 'rgba(59, 130, 246, 0.15)',
  // Unselected mask colors
  unselectedLine: '#888888',
  unselectedHandle: '#888888',
  unselectedFill: 'rgba(100, 100, 100, 0.1)',
  // Feather indicator
  featherLine: '#60a5fa',
  // Drawing mode
  drawingLine: '#22c55e',
  drawingHandle: '#22c55e',
}

// ============================================================================
// Color Selection Helper
// ============================================================================

interface MaskRenderColors {
  line: string
  handle: string
  fill: string
}

/**
 * Get mask rendering colors based on selection state.
 */
function getMaskColors(isSelected: boolean): MaskRenderColors {
  return isSelected
    ? { line: MASK_COLORS.selectedLine, handle: MASK_COLORS.selectedHandle, fill: MASK_COLORS.selectedFill }
    : { line: MASK_COLORS.unselectedLine, handle: MASK_COLORS.unselectedHandle, fill: MASK_COLORS.unselectedFill }
}

// ============================================================================
// Types
// ============================================================================

/** Handle types for linear gradient masks */
export type LinearHandle = 'start' | 'end'

/** Handle types for radial gradient masks */
export type RadialHandle = 'center' | 'radiusX+' | 'radiusX-' | 'radiusY+' | 'radiusY-'

/** Union of all handle types */
export type MaskHandle = LinearHandle | RadialHandle

// ============================================================================
// Coordinate Conversions (Internal use - delegate to canvasCoords)
// ============================================================================

// These are used internally and by useMaskOverlay
// Using the base implementations from canvasCoords

/** Convert normalized to canvas coordinates */
function toCanvasCoords(
  normX: number,
  normY: number,
  canvasWidth: number,
  canvasHeight: number,
): { x: number, y: number } {
  return toCanvasBase(normX, normY, canvasWidth, canvasHeight)
}

// ============================================================================
// Linear Gradient Handle Positions
// ============================================================================

/**
 * Get handle positions for a linear gradient mask in canvas coordinates.
 */
export function getLinearHandlePositions(
  mask: LinearGradientMask,
  canvasWidth: number,
  canvasHeight: number,
): Record<LinearHandle, { x: number, y: number }> {
  return {
    start: toCanvasCoords(mask.start.x, mask.start.y, canvasWidth, canvasHeight),
    end: toCanvasCoords(mask.end.x, mask.end.y, canvasWidth, canvasHeight),
  }
}

/**
 * Find which linear gradient handle (if any) is at the given canvas position.
 */
export function findLinearHandleAt(
  canvasX: number,
  canvasY: number,
  mask: LinearGradientMask,
  canvasWidth: number,
  canvasHeight: number,
): LinearHandle | null {
  const positions = getLinearHandlePositions(mask, canvasWidth, canvasHeight)

  for (const handle of ['start', 'end'] as LinearHandle[]) {
    const pos = positions[handle]
    if (distance(canvasX, canvasY, pos.x, pos.y) <= MASK_HANDLE_HIT_RADIUS) return handle
  }

  return null
}

/**
 * Check if a point is near the linear gradient line (for selection).
 */
export function isNearLinearGradient(
  canvasX: number,
  canvasY: number,
  mask: LinearGradientMask,
  canvasWidth: number,
  canvasHeight: number,
  threshold: number = MASK_HANDLE_HIT_RADIUS,
): boolean {
  const positions = getLinearHandlePositions(mask, canvasWidth, canvasHeight)
  const { start, end } = positions

  // Calculate distance from point to line segment
  const dx = end.x - start.x
  const dy = end.y - start.y
  const lengthSq = dx * dx + dy * dy

  if (lengthSq === 0) {
    // Start and end are the same point
    return distance(canvasX, canvasY, start.x, start.y) <= threshold
  }

  // Parameter t for closest point on line (clamped to segment)
  const t = clamp01(((canvasX - start.x) * dx + (canvasY - start.y) * dy) / lengthSq)

  // Closest point on line segment
  const closestX = start.x + t * dx
  const closestY = start.y + t * dy

  return distance(canvasX, canvasY, closestX, closestY) <= threshold
}

// ============================================================================
// Radial Gradient Handle Positions
// ============================================================================

/**
 * Get handle positions for a radial gradient mask in canvas coordinates.
 */
export function getRadialHandlePositions(
  mask: RadialGradientMask,
  canvasWidth: number,
  canvasHeight: number,
): Record<RadialHandle, { x: number, y: number }> {
  const center = toCanvasCoords(mask.center.x, mask.center.y, canvasWidth, canvasHeight)
  const rx = mask.radiusX * canvasWidth
  const ry = mask.radiusY * canvasHeight
  const cos = Math.cos(mask.rotation * Math.PI / 180)
  const sin = Math.sin(mask.rotation * Math.PI / 180)

  return {
    center,
    'radiusX+': { x: center.x + rx * cos, y: center.y + rx * sin },
    'radiusX-': { x: center.x - rx * cos, y: center.y - rx * sin },
    'radiusY+': { x: center.x - ry * sin, y: center.y + ry * cos },
    'radiusY-': { x: center.x + ry * sin, y: center.y - ry * cos },
  }
}

/**
 * Find which radial gradient handle (if any) is at the given canvas position.
 */
export function findRadialHandleAt(
  canvasX: number,
  canvasY: number,
  mask: RadialGradientMask,
  canvasWidth: number,
  canvasHeight: number,
): RadialHandle | null {
  const positions = getRadialHandlePositions(mask, canvasWidth, canvasHeight)

  // Check center first (higher priority)
  if (distance(canvasX, canvasY, positions.center.x, positions.center.y) <= MASK_HANDLE_HIT_RADIUS) {
    return 'center'
  }

  // Check radius handles
  for (const handle of ['radiusX+', 'radiusX-', 'radiusY+', 'radiusY-'] as RadialHandle[]) {
    const pos = positions[handle]
    if (distance(canvasX, canvasY, pos.x, pos.y) <= MASK_HANDLE_HIT_RADIUS) return handle
  }

  return null
}

/**
 * Check if a point is inside a radial gradient ellipse (for selection).
 */
export function isInsideRadialGradient(
  canvasX: number,
  canvasY: number,
  mask: RadialGradientMask,
  canvasWidth: number,
  canvasHeight: number,
): boolean {
  const center = toCanvasCoords(mask.center.x, mask.center.y, canvasWidth, canvasHeight)
  const rx = mask.radiusX * canvasWidth
  const ry = mask.radiusY * canvasHeight

  // Translate point to ellipse center
  const dx = canvasX - center.x
  const dy = canvasY - center.y

  // Apply inverse rotation
  const rad = -mask.rotation * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const rotX = dx * cos - dy * sin
  const rotY = dx * sin + dy * cos

  // Check if point is inside ellipse (normalized distance <= 1)
  const normalizedDist = (rotX * rotX) / (rx * rx) + (rotY * rotY) / (ry * ry)
  return normalizedDist <= 1
}

// ============================================================================
// Rendering Functions - Linear Gradient
// ============================================================================

/**
 * Draw a linear gradient mask on the canvas.
 */
export function drawLinearMask(
  ctx: CanvasRenderingContext2D,
  mask: LinearGradientMask,
  canvasWidth: number,
  canvasHeight: number,
  isSelected: boolean,
  activeHandle: LinearHandle | null,
): void {
  const colors = getMaskColors(isSelected)
  const positions = getLinearHandlePositions(mask, canvasWidth, canvasHeight)
  const { start, end } = positions

  // Draw gradient visualization (semi-transparent fill perpendicular to line)
  if (isSelected) {
    drawLinearGradientVisualization(ctx, start, end, mask.feather, canvasWidth, canvasHeight, colors.fill)
  }

  // Draw main gradient line
  ctx.beginPath()
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 2
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()

  // Draw handles
  for (const handle of ['start', 'end'] as LinearHandle[]) {
    const pos = positions[handle]
    const isActive = activeHandle === handle

    drawHandle(ctx, pos.x, pos.y, isActive ? colors.handle : '#ffffff', colors.handle)
  }
}

/**
 * Draw gradient visualization showing the effect zone.
 */
function drawLinearGradientVisualization(
  ctx: CanvasRenderingContext2D,
  start: { x: number, y: number },
  end: { x: number, y: number },
  feather: number,
  canvasWidth: number,
  canvasHeight: number,
  fillColor: string,
): void {
  // Calculate perpendicular direction
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.sqrt(dx * dx + dy * dy)

  if (length < 1) return

  // Perpendicular unit vector
  const perpX = -dy / length
  const perpY = dx / length

  // Width of visualization (extend beyond canvas edges)
  const visualWidth = Math.max(canvasWidth, canvasHeight) * 2

  // Draw a quad representing the gradient zone
  ctx.beginPath()
  ctx.fillStyle = fillColor
  ctx.moveTo(start.x + perpX * visualWidth, start.y + perpY * visualWidth)
  ctx.lineTo(start.x - perpX * visualWidth, start.y - perpY * visualWidth)
  ctx.lineTo(end.x - perpX * visualWidth, end.y - perpY * visualWidth)
  ctx.lineTo(end.x + perpX * visualWidth, end.y + perpY * visualWidth)
  ctx.closePath()
  ctx.fill()
}

// ============================================================================
// Rendering Functions - Radial Gradient
// ============================================================================

/**
 * Draw a radial gradient mask on the canvas.
 */
export function drawRadialMask(
  ctx: CanvasRenderingContext2D,
  mask: RadialGradientMask,
  canvasWidth: number,
  canvasHeight: number,
  isSelected: boolean,
  activeHandle: RadialHandle | null,
): void {
  const colors = getMaskColors(isSelected)
  const center = toCanvasCoords(mask.center.x, mask.center.y, canvasWidth, canvasHeight)
  const rx = mask.radiusX * canvasWidth
  const ry = mask.radiusY * canvasHeight

  // Save context for rotation
  ctx.save()
  ctx.translate(center.x, center.y)
  ctx.rotate(mask.rotation * Math.PI / 180)

  // Draw ellipse fill
  ctx.beginPath()
  ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2)
  ctx.fillStyle = colors.fill
  ctx.fill()

  // Draw ellipse stroke
  ctx.strokeStyle = colors.line
  ctx.lineWidth = 2
  ctx.stroke()

  // Restore context
  ctx.restore()

  // Draw handles (in canvas coordinates, not rotated context)
  const positions = getRadialHandlePositions(mask, canvasWidth, canvasHeight)

  for (const handle of ['center', 'radiusX+', 'radiusX-', 'radiusY+', 'radiusY-'] as RadialHandle[]) {
    const pos = positions[handle]
    const isActive = activeHandle === handle
    const isCenter = handle === 'center'

    // Draw center handle as a crosshair
    if (isCenter) {
      drawCenterHandle(ctx, pos.x, pos.y, isActive ? colors.handle : '#ffffff', colors.handle)
    }
    else {
      drawHandle(ctx, pos.x, pos.y, isActive ? colors.handle : '#ffffff', colors.handle)
    }
  }
}

// ============================================================================
// Handle Drawing Utilities
// ============================================================================

/**
 * Draw a circular handle.
 */
function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fillColor: string,
  strokeColor: string,
): void {
  const radius = MASK_HANDLE_SIZE / 2

  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 2
  ctx.stroke()
}

/**
 * Draw a center handle with crosshair pattern.
 */
function drawCenterHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fillColor: string,
  strokeColor: string,
): void {
  const radius = MASK_HANDLE_SIZE / 2
  const crossSize = radius * 0.7

  // Outer circle
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)
  ctx.fillStyle = fillColor
  ctx.fill()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 2
  ctx.stroke()

  // Inner crosshair
  ctx.beginPath()
  ctx.strokeStyle = strokeColor
  ctx.lineWidth = 1.5
  ctx.moveTo(x - crossSize, y)
  ctx.lineTo(x + crossSize, y)
  ctx.moveTo(x, y - crossSize)
  ctx.lineTo(x, y + crossSize)
  ctx.stroke()
}

/**
 * Draw a temporary mask during drawing mode.
 */
export function drawTempLinearMask(
  ctx: CanvasRenderingContext2D,
  start: { x: number, y: number },
  end: { x: number, y: number },
): void {
  // Draw line with dashed pattern
  ctx.beginPath()
  ctx.strokeStyle = MASK_COLORS.drawingLine
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
  ctx.setLineDash([])

  // Draw handles
  drawHandle(ctx, start.x, start.y, '#ffffff', MASK_COLORS.drawingHandle)
  drawHandle(ctx, end.x, end.y, '#ffffff', MASK_COLORS.drawingHandle)
}

/**
 * Draw a temporary radial mask during drawing mode.
 */
export function drawTempRadialMask(
  ctx: CanvasRenderingContext2D,
  center: { x: number, y: number },
  radiusX: number,
  radiusY: number,
): void {
  // Draw ellipse with dashed pattern
  ctx.beginPath()
  ctx.strokeStyle = MASK_COLORS.drawingLine
  ctx.lineWidth = 2
  ctx.setLineDash([5, 5])
  ctx.ellipse(center.x, center.y, radiusX, radiusY, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  // Draw center handle
  drawCenterHandle(ctx, center.x, center.y, '#ffffff', MASK_COLORS.drawingHandle)
}

// ============================================================================
// Cursor Helpers
// ============================================================================

/**
 * Get cursor style for a linear gradient handle.
 */
export function getCursorForLinearHandle(handle: LinearHandle | null, isDragging: boolean): string {
  if (!handle) return isDragging ? 'grabbing' : 'default'
  return isDragging ? 'grabbing' : 'grab'
}

/**
 * Get cursor style for a radial gradient handle.
 */
export function getCursorForRadialHandle(handle: RadialHandle | null, isDragging: boolean): string {
  if (!handle) return isDragging ? 'grabbing' : 'default'

  if (handle === 'center') {
    return isDragging ? 'grabbing' : 'move'
  }

  // Radius handles get resize cursors
  const cursors: Record<RadialHandle, string> = {
    'center': 'move',
    'radiusX+': 'ew-resize',
    'radiusX-': 'ew-resize',
    'radiusY+': 'ns-resize',
    'radiusY-': 'ns-resize',
  }

  return cursors[handle]
}

// ============================================================================
// Mask Update Helpers
// ============================================================================

/**
 * Update a linear gradient mask's handle position.
 * Returns a new mask object with the updated position.
 */
export function updateLinearHandlePosition(
  mask: LinearGradientMask,
  handle: LinearHandle,
  normalizedX: number,
  normalizedY: number,
): Partial<LinearGradientMask> {
  const clampedX = clamp01(normalizedX)
  const clampedY = clamp01(normalizedY)

  if (handle === 'start') {
    return { start: { x: clampedX, y: clampedY } }
  }
  else {
    return { end: { x: clampedX, y: clampedY } }
  }
}

/**
 * Update a radial gradient mask's handle position.
 * Returns partial updates for the mask.
 */
export function updateRadialHandlePosition(
  mask: RadialGradientMask,
  handle: RadialHandle,
  normalizedX: number,
  normalizedY: number,
  canvasWidth: number,
  canvasHeight: number,
): Partial<RadialGradientMask> {
  const clampedX = clamp01(normalizedX)
  const clampedY = clamp01(normalizedY)

  if (handle === 'center') {
    return { center: { x: clampedX, y: clampedY } }
  }

  // For radius handles, calculate new radius based on distance from center
  const center = toCanvasCoords(mask.center.x, mask.center.y, canvasWidth, canvasHeight)
  const newPos = toCanvasCoords(clampedX, clampedY, canvasWidth, canvasHeight)

  // Calculate distance from center to new position
  const dx = newPos.x - center.x
  const dy = newPos.y - center.y

  // Apply inverse rotation to get distance in local coordinates
  const rad = -mask.rotation * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const localX = dx * cos - dy * sin
  const localY = dx * sin + dy * cos

  if (handle === 'radiusX+' || handle === 'radiusX-') {
    const newRadiusX = Math.abs(localX) / canvasWidth
    return { radiusX: Math.max(0.01, newRadiusX) }
  }
  else {
    const newRadiusY = Math.abs(localY) / canvasHeight
    return { radiusY: Math.max(0.01, newRadiusY) }
  }
}
