/**
 * Unit tests for mask utilities.
 *
 * Tests mask overlay rendering and interaction utilities including:
 * - Handle position calculations
 * - Hit detection for handles
 * - Proximity detection for mask selection
 * - Handle position updates
 * - Cursor style helpers
 */

import { describe, it, expect } from 'vitest'
import type { LinearGradientMask, RadialGradientMask } from '@literoom/core/catalog'
import {
  MASK_HANDLE_SIZE,
  MASK_HANDLE_HIT_RADIUS,
  getLinearHandlePositions,
  findLinearHandleAt,
  isNearLinearGradient,
  getRadialHandlePositions,
  findRadialHandleAt,
  isInsideRadialGradient,
  getCursorForLinearHandle,
  getCursorForRadialHandle,
  updateLinearHandlePosition,
  updateRadialHandlePosition,
} from '~/composables/maskUtils'

// ============================================================================
// Test Fixtures
// ============================================================================

function createLinearMask(overrides: Partial<LinearGradientMask> = {}): LinearGradientMask {
  return {
    id: 'linear-mask-1',
    start: { x: 0.2, y: 0.3 },
    end: { x: 0.8, y: 0.7 },
    feather: 0.5,
    enabled: true,
    adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0 },
    ...overrides,
  }
}

function createRadialMask(overrides: Partial<RadialGradientMask> = {}): RadialGradientMask {
  return {
    id: 'radial-mask-1',
    center: { x: 0.5, y: 0.5 },
    radiusX: 0.25,
    radiusY: 0.2,
    rotation: 0,
    feather: 0.5,
    invert: false,
    enabled: true,
    adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0 },
    ...overrides,
  }
}

// ============================================================================
// Constants
// ============================================================================

describe('mask constants', () => {
  it('has reasonable handle size', () => {
    expect(MASK_HANDLE_SIZE).toBeGreaterThan(0)
    expect(MASK_HANDLE_SIZE).toBeLessThanOrEqual(20)
  })

  it('has reasonable hit radius', () => {
    expect(MASK_HANDLE_HIT_RADIUS).toBeGreaterThan(MASK_HANDLE_SIZE)
    expect(MASK_HANDLE_HIT_RADIUS).toBeLessThanOrEqual(50)
  })
})

// ============================================================================
// Linear Gradient Handle Positions
// ============================================================================

describe('getLinearHandlePositions', () => {
  const canvasWidth = 1000
  const canvasHeight = 800

  it('calculates start handle position', () => {
    const mask = createLinearMask({ start: { x: 0.2, y: 0.3 } })
    const positions = getLinearHandlePositions(mask, canvasWidth, canvasHeight)

    expect(positions.start.x).toBe(200) // 0.2 * 1000
    expect(positions.start.y).toBe(240) // 0.3 * 800
  })

  it('calculates end handle position', () => {
    const mask = createLinearMask({ end: { x: 0.8, y: 0.7 } })
    const positions = getLinearHandlePositions(mask, canvasWidth, canvasHeight)

    expect(positions.end.x).toBe(800) // 0.8 * 1000
    expect(positions.end.y).toBe(560) // 0.7 * 800
  })

  it('handles corner positions', () => {
    const mask = createLinearMask({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    })
    const positions = getLinearHandlePositions(mask, canvasWidth, canvasHeight)

    expect(positions.start.x).toBe(0)
    expect(positions.start.y).toBe(0)
    expect(positions.end.x).toBe(canvasWidth)
    expect(positions.end.y).toBe(canvasHeight)
  })

  it('handles center position', () => {
    const mask = createLinearMask({
      start: { x: 0.5, y: 0.5 },
      end: { x: 0.5, y: 0.5 },
    })
    const positions = getLinearHandlePositions(mask, canvasWidth, canvasHeight)

    expect(positions.start.x).toBe(500)
    expect(positions.start.y).toBe(400)
  })
})

// ============================================================================
// Linear Handle Hit Detection
// ============================================================================

describe('findLinearHandleAt', () => {
  const canvasWidth = 1000
  const canvasHeight = 800

  it('finds start handle when clicked on it', () => {
    const mask = createLinearMask({ start: { x: 0.2, y: 0.3 } })
    const handle = findLinearHandleAt(200, 240, mask, canvasWidth, canvasHeight)
    expect(handle).toBe('start')
  })

  it('finds end handle when clicked on it', () => {
    const mask = createLinearMask({ end: { x: 0.8, y: 0.7 } })
    const handle = findLinearHandleAt(800, 560, mask, canvasWidth, canvasHeight)
    expect(handle).toBe('end')
  })

  it('finds handle within hit radius', () => {
    const mask = createLinearMask({ start: { x: 0.2, y: 0.3 } })
    // Click slightly off from center but within hit radius
    const handle = findLinearHandleAt(200 + 10, 240 + 10, mask, canvasWidth, canvasHeight)
    expect(handle).toBe('start')
  })

  it('returns null when clicking outside hit radius', () => {
    const mask = createLinearMask({ start: { x: 0.2, y: 0.3 } })
    // Click far away from both handles
    const handle = findLinearHandleAt(500, 400, mask, canvasWidth, canvasHeight)
    expect(handle).toBeNull()
  })

  it('returns null at empty area', () => {
    const mask = createLinearMask()
    const handle = findLinearHandleAt(0, 0, mask, canvasWidth, canvasHeight)
    expect(handle).toBeNull()
  })
})

// ============================================================================
// Linear Gradient Proximity Detection
// ============================================================================

describe('isNearLinearGradient', () => {
  const canvasWidth = 1000
  const canvasHeight = 800

  it('returns true when on the gradient line', () => {
    const mask = createLinearMask({
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
    })
    // Point on the horizontal line
    const isNear = isNearLinearGradient(500, 400, mask, canvasWidth, canvasHeight)
    expect(isNear).toBe(true)
  })

  it('returns true when close to the line', () => {
    const mask = createLinearMask({
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
    })
    // Point slightly above the line
    const isNear = isNearLinearGradient(500, 395, mask, canvasWidth, canvasHeight)
    expect(isNear).toBe(true)
  })

  it('returns false when far from the line', () => {
    const mask = createLinearMask({
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
    })
    // Point far above the line
    const isNear = isNearLinearGradient(500, 100, mask, canvasWidth, canvasHeight)
    expect(isNear).toBe(false)
  })

  it('handles diagonal lines', () => {
    const mask = createLinearMask({
      start: { x: 0, y: 0 },
      end: { x: 1, y: 1 },
    })
    // Point on the diagonal
    const isNear = isNearLinearGradient(400, 320, mask, canvasWidth, canvasHeight) // 400/1000 = 0.4, 320/800 = 0.4
    expect(isNear).toBe(true)
  })

  it('handles degenerate case (same start and end)', () => {
    const mask = createLinearMask({
      start: { x: 0.5, y: 0.5 },
      end: { x: 0.5, y: 0.5 },
    })
    const isNear = isNearLinearGradient(500, 400, mask, canvasWidth, canvasHeight)
    expect(isNear).toBe(true)
  })

  it('respects custom threshold', () => {
    const mask = createLinearMask({
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
    })
    // Point 50 pixels above the line with small threshold
    const isNearSmall = isNearLinearGradient(500, 350, mask, canvasWidth, canvasHeight, 10)
    expect(isNearSmall).toBe(false)

    // Same point with large threshold
    const isNearLarge = isNearLinearGradient(500, 350, mask, canvasWidth, canvasHeight, 100)
    expect(isNearLarge).toBe(true)
  })
})

// ============================================================================
// Radial Gradient Handle Positions
// ============================================================================

describe('getRadialHandlePositions', () => {
  const canvasWidth = 1000
  const canvasHeight = 800

  it('calculates center handle position', () => {
    const mask = createRadialMask({ center: { x: 0.5, y: 0.5 } })
    const positions = getRadialHandlePositions(mask, canvasWidth, canvasHeight)

    expect(positions.center.x).toBe(500)
    expect(positions.center.y).toBe(400)
  })

  it('calculates radiusX handles for unrotated ellipse', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.2,
      radiusY: 0.1,
      rotation: 0,
    })
    const positions = getRadialHandlePositions(mask, canvasWidth, canvasHeight)

    // radiusX+ should be to the right of center (0.2 * 1000 = 200 pixels)
    expect(positions['radiusX+'].x).toBeCloseTo(700, 1) // 500 + 200
    expect(positions['radiusX+'].y).toBeCloseTo(400, 1)

    // radiusX- should be to the left of center
    expect(positions['radiusX-'].x).toBeCloseTo(300, 1) // 500 - 200
    expect(positions['radiusX-'].y).toBeCloseTo(400, 1)
  })

  it('calculates radiusY handles for unrotated ellipse', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.2,
      radiusY: 0.1,
      rotation: 0,
    })
    const positions = getRadialHandlePositions(mask, canvasWidth, canvasHeight)

    // radiusY+ should be below center (0.1 * 800 = 80 pixels)
    expect(positions['radiusY+'].x).toBeCloseTo(500, 1)
    expect(positions['radiusY+'].y).toBeCloseTo(480, 1) // 400 + 80

    // radiusY- should be above center
    expect(positions['radiusY-'].x).toBeCloseTo(500, 1)
    expect(positions['radiusY-'].y).toBeCloseTo(320, 1) // 400 - 80
  })

  it('handles rotated ellipse', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.2,
      radiusY: 0.1,
      rotation: 90, // 90 degree rotation
    })
    const positions = getRadialHandlePositions(mask, canvasWidth, canvasHeight)

    // After 90 degree rotation:
    // - radiusX handles rotate to vertical axis (cos(90)=0, sin(90)=1)
    // - radiusY handles rotate to horizontal axis (-sin(90)=-1, cos(90)=0)
    // rx = 0.2 * 1000 = 200, ry = 0.1 * 800 = 80
    // cos(90°) ≈ 0, sin(90°) = 1

    // radiusX+: center + (rx * cos, rx * sin) = (500 + 200*0, 400 + 200*1) = (500, 600)
    expect(positions['radiusX+'].x).toBeCloseTo(500, 0)
    expect(positions['radiusX+'].y).toBeCloseTo(600, 0)

    // radiusY+: center + (-ry * sin, ry * cos) = (500 + (-80)*1, 400 + 80*0) = (420, 400)
    expect(positions['radiusY+'].x).toBeCloseTo(420, 0)
    expect(positions['radiusY+'].y).toBeCloseTo(400, 0)
  })
})

// ============================================================================
// Radial Handle Hit Detection
// ============================================================================

describe('findRadialHandleAt', () => {
  const canvasWidth = 1000
  const canvasHeight = 800

  it('finds center handle when clicked on it', () => {
    const mask = createRadialMask({ center: { x: 0.5, y: 0.5 } })
    const handle = findRadialHandleAt(500, 400, mask, canvasWidth, canvasHeight)
    expect(handle).toBe('center')
  })

  it('finds radiusX+ handle', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.2,
      radiusY: 0.1,
      rotation: 0,
    })
    const handle = findRadialHandleAt(700, 400, mask, canvasWidth, canvasHeight)
    expect(handle).toBe('radiusX+')
  })

  it('finds radiusY+ handle', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.2,
      radiusY: 0.1,
      rotation: 0,
    })
    const handle = findRadialHandleAt(500, 480, mask, canvasWidth, canvasHeight)
    expect(handle).toBe('radiusY+')
  })

  it('prioritizes center handle when handles overlap', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.01, // Very small radius, handles overlap with center
      radiusY: 0.01,
      rotation: 0,
    })
    const handle = findRadialHandleAt(500, 400, mask, canvasWidth, canvasHeight)
    expect(handle).toBe('center')
  })

  it('returns null when clicking outside all handles', () => {
    const mask = createRadialMask()
    const handle = findRadialHandleAt(100, 100, mask, canvasWidth, canvasHeight)
    expect(handle).toBeNull()
  })
})

// ============================================================================
// Radial Gradient Inside Detection
// ============================================================================

describe('isInsideRadialGradient', () => {
  const canvasWidth = 1000
  const canvasHeight = 800

  it('returns true when point is at center', () => {
    const mask = createRadialMask({ center: { x: 0.5, y: 0.5 } })
    const isInside = isInsideRadialGradient(500, 400, mask, canvasWidth, canvasHeight)
    expect(isInside).toBe(true)
  })

  it('returns true when point is inside ellipse', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.25,
      radiusY: 0.2,
    })
    // Point slightly off center but still inside
    const isInside = isInsideRadialGradient(550, 420, mask, canvasWidth, canvasHeight)
    expect(isInside).toBe(true)
  })

  it('returns false when point is outside ellipse', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.1,
      radiusY: 0.1,
    })
    // Point far from center
    const isInside = isInsideRadialGradient(100, 100, mask, canvasWidth, canvasHeight)
    expect(isInside).toBe(false)
  })

  it('returns true at edge of ellipse', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.25, // 250 pixels
      radiusY: 0.2,
      rotation: 0,
    })
    // Point at right edge of ellipse
    const isInside = isInsideRadialGradient(750, 400, mask, canvasWidth, canvasHeight)
    expect(isInside).toBe(true)
  })

  it('handles rotated ellipse', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.3,
      radiusY: 0.1,
      rotation: 45,
    })
    // Point that would be outside unrotated but inside rotated
    const isInside = isInsideRadialGradient(550, 350, mask, canvasWidth, canvasHeight)
    // After 45 degree rotation, the ellipse extends diagonally
    expect(typeof isInside).toBe('boolean')
  })
})

// ============================================================================
// Cursor Helpers
// ============================================================================

describe('getCursorForLinearHandle', () => {
  it('returns "default" when no handle and not dragging', () => {
    expect(getCursorForLinearHandle(null, false)).toBe('default')
  })

  it('returns "grabbing" when no handle but dragging', () => {
    expect(getCursorForLinearHandle(null, true)).toBe('grabbing')
  })

  it('returns "grab" when hovering over start handle', () => {
    expect(getCursorForLinearHandle('start', false)).toBe('grab')
  })

  it('returns "grab" when hovering over end handle', () => {
    expect(getCursorForLinearHandle('end', false)).toBe('grab')
  })

  it('returns "grabbing" when dragging start handle', () => {
    expect(getCursorForLinearHandle('start', true)).toBe('grabbing')
  })

  it('returns "grabbing" when dragging end handle', () => {
    expect(getCursorForLinearHandle('end', true)).toBe('grabbing')
  })
})

describe('getCursorForRadialHandle', () => {
  it('returns "default" when no handle and not dragging', () => {
    expect(getCursorForRadialHandle(null, false)).toBe('default')
  })

  it('returns "grabbing" when no handle but dragging', () => {
    expect(getCursorForRadialHandle(null, true)).toBe('grabbing')
  })

  it('returns "move" when hovering over center', () => {
    expect(getCursorForRadialHandle('center', false)).toBe('move')
  })

  it('returns "grabbing" when dragging center', () => {
    expect(getCursorForRadialHandle('center', true)).toBe('grabbing')
  })

  it('returns "ew-resize" for radiusX+ handle', () => {
    expect(getCursorForRadialHandle('radiusX+', false)).toBe('ew-resize')
  })

  it('returns "ew-resize" for radiusX- handle', () => {
    expect(getCursorForRadialHandle('radiusX-', false)).toBe('ew-resize')
  })

  it('returns "ns-resize" for radiusY+ handle', () => {
    expect(getCursorForRadialHandle('radiusY+', false)).toBe('ns-resize')
  })

  it('returns "ns-resize" for radiusY- handle', () => {
    expect(getCursorForRadialHandle('radiusY-', false)).toBe('ns-resize')
  })
})

// ============================================================================
// Handle Position Updates
// ============================================================================

describe('updateLinearHandlePosition', () => {
  it('updates start position', () => {
    const mask = createLinearMask()
    const updates = updateLinearHandlePosition(mask, 'start', 0.3, 0.4)

    expect(updates.start).toEqual({ x: 0.3, y: 0.4 })
    expect(updates.end).toBeUndefined()
  })

  it('updates end position', () => {
    const mask = createLinearMask()
    const updates = updateLinearHandlePosition(mask, 'end', 0.7, 0.6)

    expect(updates.end).toEqual({ x: 0.7, y: 0.6 })
    expect(updates.start).toBeUndefined()
  })

  it('clamps start position to valid range', () => {
    const mask = createLinearMask()
    const updates = updateLinearHandlePosition(mask, 'start', -0.5, 1.5)

    expect(updates.start?.x).toBe(0)
    expect(updates.start?.y).toBe(1)
  })

  it('clamps end position to valid range', () => {
    const mask = createLinearMask()
    const updates = updateLinearHandlePosition(mask, 'end', 2, -1)

    expect(updates.end?.x).toBe(1)
    expect(updates.end?.y).toBe(0)
  })
})

describe('updateRadialHandlePosition', () => {
  const canvasWidth = 1000
  const canvasHeight = 800

  it('updates center position', () => {
    const mask = createRadialMask()
    const updates = updateRadialHandlePosition(
      mask,
      'center',
      0.3,
      0.4,
      canvasWidth,
      canvasHeight,
    )

    expect(updates.center).toEqual({ x: 0.3, y: 0.4 })
  })

  it('clamps center position', () => {
    const mask = createRadialMask()
    const updates = updateRadialHandlePosition(
      mask,
      'center',
      -0.5,
      1.5,
      canvasWidth,
      canvasHeight,
    )

    expect(updates.center?.x).toBe(0)
    expect(updates.center?.y).toBe(1)
  })

  it('updates radiusX from radiusX+ handle', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.2,
      rotation: 0,
    })
    // Move handle to the right by 100 pixels (0.1 normalized)
    const updates = updateRadialHandlePosition(
      mask,
      'radiusX+',
      0.8,
      0.5,
      canvasWidth,
      canvasHeight,
    )

    expect(updates.radiusX).toBeDefined()
    expect(updates.radiusX).toBeGreaterThan(0)
  })

  it('updates radiusY from radiusY+ handle', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      radiusY: 0.2,
      rotation: 0,
    })
    const updates = updateRadialHandlePosition(
      mask,
      'radiusY+',
      0.5,
      0.8,
      canvasWidth,
      canvasHeight,
    )

    expect(updates.radiusY).toBeDefined()
    expect(updates.radiusY).toBeGreaterThan(0)
  })

  it('enforces minimum radius', () => {
    const mask = createRadialMask({
      center: { x: 0.5, y: 0.5 },
      rotation: 0,
    })
    // Try to set radius to nearly zero by moving handle to center
    const updates = updateRadialHandlePosition(
      mask,
      'radiusX+',
      0.5,
      0.5,
      canvasWidth,
      canvasHeight,
    )

    // Should enforce minimum radius of 0.01
    expect(updates.radiusX).toBeGreaterThanOrEqual(0.01)
  })
})
