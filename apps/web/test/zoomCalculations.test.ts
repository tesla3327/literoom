/**
 * Unit tests for zoom calculation utility functions.
 *
 * These are pure math functions used for zoom/pan behavior in the edit view.
 */

import { describe, it, expect } from 'vitest'
import {
  calculateFitScale,
  calculateFillScale,
  clampScale,
  clampPan,
  zoomToPoint,
  zoomIn,
  zoomOut,
  screenToImage,
  imageToScreen,
  canPan,
  createCameraForPreset,
  getZoomPercentage,
  detectPreset,
  getScaleForPreset,
  calculateCenteredPan,
  MIN_ZOOM,
  MAX_ZOOM,
  ZOOM_STEP,
  type Camera,
  type ZoomPreset,
} from '~/utils/zoomCalculations'

// ============================================================================
// calculateFitScale
// ============================================================================

describe('calculateFitScale', () => {
  it('returns 1 when image exactly fits viewport', () => {
    const scale = calculateFitScale(1000, 800, 1000, 800)
    expect(scale).toBe(1)
  })

  it('returns scale < 1 when image is larger than viewport', () => {
    // Image is 2000x1600, viewport is 1000x800
    // Scale should be 0.5 to fit
    const scale = calculateFitScale(2000, 1600, 1000, 800)
    expect(scale).toBe(0.5)
  })

  it('returns scale > 1 when image is smaller than viewport', () => {
    // Image is 500x400, viewport is 1000x800
    // Scale should be 2 to fit
    const scale = calculateFitScale(500, 400, 1000, 800)
    expect(scale).toBe(2)
  })

  it('uses the smaller scale when aspect ratios differ (letterboxing)', () => {
    // Image is 2000x1000 (2:1), viewport is 1000x800 (1.25:1)
    // Width scale: 1000/2000 = 0.5
    // Height scale: 800/1000 = 0.8
    // Should use 0.5 (width limited)
    const scale = calculateFitScale(2000, 1000, 1000, 800)
    expect(scale).toBe(0.5)
  })

  it('handles portrait image in landscape viewport', () => {
    // Image is 1000x2000 (portrait), viewport is 1600x900 (landscape)
    // Width scale: 1600/1000 = 1.6
    // Height scale: 900/2000 = 0.45
    // Should use 0.45 (height limited)
    const scale = calculateFitScale(1000, 2000, 1600, 900)
    expect(scale).toBe(0.45)
  })

  it('returns 1 when image dimensions are zero', () => {
    expect(calculateFitScale(0, 100, 800, 600)).toBe(1)
    expect(calculateFitScale(100, 0, 800, 600)).toBe(1)
  })

  it('returns 1 when viewport dimensions are zero', () => {
    expect(calculateFitScale(100, 100, 0, 600)).toBe(1)
    expect(calculateFitScale(100, 100, 800, 0)).toBe(1)
  })
})

// ============================================================================
// calculateFillScale
// ============================================================================

describe('calculateFillScale', () => {
  it('returns 1 when image exactly fills viewport', () => {
    const scale = calculateFillScale(1000, 800, 1000, 800)
    expect(scale).toBe(1)
  })

  it('returns the larger scale when aspect ratios differ', () => {
    // Image is 2000x1000 (2:1), viewport is 1000x800 (1.25:1)
    // Width scale: 1000/2000 = 0.5
    // Height scale: 800/1000 = 0.8
    // Should use 0.8 (fills viewport, crops width)
    const scale = calculateFillScale(2000, 1000, 1000, 800)
    expect(scale).toBe(0.8)
  })

  it('handles portrait image in landscape viewport', () => {
    // Image is 1000x2000 (portrait), viewport is 1600x900 (landscape)
    // Width scale: 1600/1000 = 1.6
    // Height scale: 900/2000 = 0.45
    // Should use 1.6 (fills viewport, crops height)
    const scale = calculateFillScale(1000, 2000, 1600, 900)
    expect(scale).toBe(1.6)
  })

  it('returns 1 when image dimensions are zero', () => {
    expect(calculateFillScale(0, 100, 800, 600)).toBe(1)
    expect(calculateFillScale(100, 0, 800, 600)).toBe(1)
  })

  it('returns 1 when viewport dimensions are zero', () => {
    expect(calculateFillScale(100, 100, 0, 600)).toBe(1)
    expect(calculateFillScale(100, 100, 800, 0)).toBe(1)
  })
})

// ============================================================================
// clampScale
// ============================================================================

describe('clampScale', () => {
  it('returns scale when within bounds', () => {
    const scale = clampScale(1.5, 0.5)
    expect(scale).toBe(1.5)
  })

  it('clamps to MAX_ZOOM when scale is too large', () => {
    const scale = clampScale(10, 0.5)
    expect(scale).toBe(MAX_ZOOM)
  })

  it('clamps to MIN_ZOOM or half fit scale when scale is too small', () => {
    // fitScale = 0.5, so min is Math.min(0.1, 0.25) = 0.1
    const scale = clampScale(0.05, 0.5)
    expect(scale).toBe(MIN_ZOOM)
  })

  it('allows zooming out to half of fit scale when fit scale is small', () => {
    // fitScale = 0.1, so min is Math.min(0.1, 0.05) = 0.05
    const scale = clampScale(0.05, 0.1)
    expect(scale).toBe(0.05)
  })

  it('allows exact MIN_ZOOM', () => {
    const scale = clampScale(MIN_ZOOM, 0.5)
    expect(scale).toBe(MIN_ZOOM)
  })

  it('allows exact MAX_ZOOM', () => {
    const scale = clampScale(MAX_ZOOM, 0.5)
    expect(scale).toBe(MAX_ZOOM)
  })
})

// ============================================================================
// clampPan
// ============================================================================

describe('clampPan', () => {
  it('centers image when it fits within viewport', () => {
    // Image at scale 1 is 500x400, viewport is 1000x800
    // Image should be centered
    const camera: Camera = { scale: 1, panX: 100, panY: 50 }
    const result = clampPan(camera, 500, 400, 1000, 800)

    // Centered: panX = (1000 - 500) / 2 = 250, panY = (800 - 400) / 2 = 200
    expect(result.panX).toBe(250)
    expect(result.panY).toBe(200)
    expect(result.scale).toBe(1)
  })

  it('allows panning when image is larger than viewport', () => {
    // Image at scale 2 is 2000x1600, viewport is 1000x800
    // Can pan within bounds
    const camera: Camera = { scale: 2, panX: -200, panY: -100 }
    const result = clampPan(camera, 1000, 800, 1000, 800)

    // Result should be within allowed bounds
    expect(result.scale).toBe(2)
    // The exact values depend on the clamping logic
    expect(typeof result.panX).toBe('number')
    expect(typeof result.panY).toBe('number')
  })

  it('constrains pan to keep image visible', () => {
    // Image at scale 2 is 2000x1600, viewport is 1000x800
    // Extreme pan values should be clamped
    const camera: Camera = { scale: 2, panX: -5000, panY: -5000 }
    const result = clampPan(camera, 1000, 800, 1000, 800)

    // Pan should be constrained to valid range
    expect(result.scale).toBe(2)
    // Center position at scale 2: (1000 - 2000) / 2 = -500
    // Max deviation: (2000 - 1000) / 2 = 500
    // So panX should be clamped to between -1000 and 0
    expect(result.panX).toBeGreaterThanOrEqual(-1000)
    expect(result.panX).toBeLessThanOrEqual(0)
  })

  it('preserves scale value', () => {
    const camera: Camera = { scale: 1.5, panX: 0, panY: 0 }
    const result = clampPan(camera, 500, 400, 1000, 800)
    expect(result.scale).toBe(1.5)
  })
})

// ============================================================================
// calculateCenteredPan
// ============================================================================

describe('calculateCenteredPan', () => {
  it('returns 0 when image exactly matches viewport', () => {
    const { panX, panY } = calculateCenteredPan(1, 1000, 800, 1000, 800)
    expect(panX).toBe(0)
    expect(panY).toBe(0)
  })

  it('returns positive pan when image is smaller than viewport', () => {
    // Image at scale 1 is 500x400, viewport is 1000x800
    const { panX, panY } = calculateCenteredPan(1, 500, 400, 1000, 800)
    expect(panX).toBe(250) // (1000 - 500) / 2
    expect(panY).toBe(200) // (800 - 400) / 2
  })

  it('returns negative pan when image is larger than viewport', () => {
    // Image at scale 2 is 2000x1600, viewport is 1000x800
    const { panX, panY } = calculateCenteredPan(2, 1000, 800, 1000, 800)
    expect(panX).toBe(-500) // (1000 - 2000) / 2
    expect(panY).toBe(-400) // (800 - 1600) / 2
  })
})

// ============================================================================
// zoomToPoint
// ============================================================================

describe('zoomToPoint', () => {
  it('maintains pivot point position when zooming', () => {
    const camera: Camera = { scale: 1, panX: 0, panY: 0 }
    const pivotX = 500
    const pivotY = 400

    // Zoom from 1x to 2x
    const result = zoomToPoint(camera, 2, pivotX, pivotY)

    // The pivot point in image coordinates should remain the same
    // At old scale: imageX = (500 - 0) / 1 = 500
    // At new scale: screenX = 500 * 2 + newPanX should equal pivotX
    // So newPanX = 500 - 500 * 2 = -500
    expect(result.scale).toBe(2)
    expect(result.panX).toBe(-500)
    expect(result.panY).toBe(-400)
  })

  it('zooms toward cursor position at non-center point', () => {
    const camera: Camera = { scale: 1, panX: 0, panY: 0 }
    const pivotX = 100
    const pivotY = 100

    const result = zoomToPoint(camera, 2, pivotX, pivotY)

    expect(result.scale).toBe(2)
    // At old scale: imageX = 100, imageY = 100
    // At new scale: screenX = 100 * 2 + newPanX = 100, so newPanX = -100
    expect(result.panX).toBe(-100)
    expect(result.panY).toBe(-100)
  })

  it('handles zoom out correctly', () => {
    const camera: Camera = { scale: 2, panX: -500, panY: -400 }
    const pivotX = 500
    const pivotY = 400

    const result = zoomToPoint(camera, 1, pivotX, pivotY)

    expect(result.scale).toBe(1)
    expect(result.panX).toBe(0)
    expect(result.panY).toBe(0)
  })
})

// ============================================================================
// zoomIn / zoomOut
// ============================================================================

describe('zoomIn', () => {
  it('increases scale by ZOOM_STEP', () => {
    const camera: Camera = { scale: 1, panX: 0, panY: 0 }
    const result = zoomIn(camera, 1000, 800, 0.5)

    expect(result.scale).toBe(1 * ZOOM_STEP)
  })

  it('zooms toward viewport center', () => {
    const camera: Camera = { scale: 1, panX: 0, panY: 0 }
    const result = zoomIn(camera, 1000, 800, 0.5)

    // Zooming toward center (500, 400)
    expect(result.scale).toBe(ZOOM_STEP)
  })

  it('clamps at MAX_ZOOM', () => {
    const camera: Camera = { scale: MAX_ZOOM, panX: 0, panY: 0 }
    const result = zoomIn(camera, 1000, 800, 0.5)

    expect(result.scale).toBe(MAX_ZOOM)
  })
})

describe('zoomOut', () => {
  it('decreases scale by ZOOM_STEP', () => {
    const camera: Camera = { scale: 2, panX: 0, panY: 0 }
    const result = zoomOut(camera, 1000, 800, 0.5)

    expect(result.scale).toBe(2 / ZOOM_STEP)
  })

  it('clamps at MIN_ZOOM', () => {
    const camera: Camera = { scale: MIN_ZOOM, panX: 0, panY: 0 }
    const result = zoomOut(camera, 1000, 800, 0.5)

    expect(result.scale).toBe(MIN_ZOOM)
  })
})

// ============================================================================
// screenToImage / imageToScreen
// ============================================================================

describe('screenToImage', () => {
  it('converts screen coordinates to image coordinates', () => {
    const camera: Camera = { scale: 1, panX: 0, panY: 0 }
    const result = screenToImage(500, 400, camera)

    expect(result.x).toBe(500)
    expect(result.y).toBe(400)
  })

  it('accounts for pan offset', () => {
    const camera: Camera = { scale: 1, panX: 100, panY: 50 }
    const result = screenToImage(500, 400, camera)

    expect(result.x).toBe(400) // 500 - 100
    expect(result.y).toBe(350) // 400 - 50
  })

  it('accounts for scale', () => {
    const camera: Camera = { scale: 2, panX: 0, panY: 0 }
    const result = screenToImage(500, 400, camera)

    expect(result.x).toBe(250) // 500 / 2
    expect(result.y).toBe(200) // 400 / 2
  })

  it('accounts for both pan and scale', () => {
    const camera: Camera = { scale: 2, panX: 100, panY: 50 }
    const result = screenToImage(500, 400, camera)

    expect(result.x).toBe(200) // (500 - 100) / 2
    expect(result.y).toBe(175) // (400 - 50) / 2
  })
})

describe('imageToScreen', () => {
  it('converts image coordinates to screen coordinates', () => {
    const camera: Camera = { scale: 1, panX: 0, panY: 0 }
    const result = imageToScreen(500, 400, camera)

    expect(result.x).toBe(500)
    expect(result.y).toBe(400)
  })

  it('accounts for pan offset', () => {
    const camera: Camera = { scale: 1, panX: 100, panY: 50 }
    const result = imageToScreen(500, 400, camera)

    expect(result.x).toBe(600) // 500 + 100
    expect(result.y).toBe(450) // 400 + 50
  })

  it('accounts for scale', () => {
    const camera: Camera = { scale: 2, panX: 0, panY: 0 }
    const result = imageToScreen(500, 400, camera)

    expect(result.x).toBe(1000) // 500 * 2
    expect(result.y).toBe(800) // 400 * 2
  })

  it('is the inverse of screenToImage', () => {
    const camera: Camera = { scale: 1.5, panX: 200, panY: -100 }
    const originalX = 500
    const originalY = 400

    const imageCoords = screenToImage(originalX, originalY, camera)
    const backToScreen = imageToScreen(imageCoords.x, imageCoords.y, camera)

    expect(backToScreen.x).toBeCloseTo(originalX)
    expect(backToScreen.y).toBeCloseTo(originalY)
  })
})

// ============================================================================
// canPan
// ============================================================================

describe('canPan', () => {
  it('returns false when image fits within viewport', () => {
    const camera: Camera = { scale: 0.5, panX: 0, panY: 0 }
    // Image is 1000x800, at scale 0.5 = 500x400, viewport is 1000x800
    const result = canPan(camera, 1000, 800, 1000, 800)
    expect(result).toBe(false)
  })

  it('returns true when image is larger than viewport', () => {
    const camera: Camera = { scale: 2, panX: 0, panY: 0 }
    // Image is 1000x800, at scale 2 = 2000x1600, viewport is 1000x800
    const result = canPan(camera, 1000, 800, 1000, 800)
    expect(result).toBe(true)
  })

  it('returns true when only width exceeds viewport', () => {
    const camera: Camera = { scale: 1.5, panX: 0, panY: 0 }
    // Image is 1000x400, at scale 1.5 = 1500x600, viewport is 1000x800
    const result = canPan(camera, 1000, 400, 1000, 800)
    expect(result).toBe(true)
  })

  it('returns true when only height exceeds viewport', () => {
    const camera: Camera = { scale: 1.5, panX: 0, panY: 0 }
    // Image is 400x800, at scale 1.5 = 600x1200, viewport is 1000x800
    const result = canPan(camera, 400, 800, 1000, 800)
    expect(result).toBe(true)
  })

  it('returns false at fit scale', () => {
    // At fit scale, image just fits, can't pan
    const fitScale = calculateFitScale(1000, 800, 1000, 800)
    const camera: Camera = { scale: fitScale, panX: 0, panY: 0 }
    const result = canPan(camera, 1000, 800, 1000, 800)
    expect(result).toBe(false)
  })
})

// ============================================================================
// getScaleForPreset
// ============================================================================

describe('getScaleForPreset', () => {
  it('returns fit scale for "fit" preset', () => {
    const scale = getScaleForPreset('fit', 2000, 1600, 1000, 800)
    expect(scale).toBe(0.5)
  })

  it('returns fill scale for "fill" preset', () => {
    const scale = getScaleForPreset('fill', 2000, 1000, 1000, 800)
    expect(scale).toBe(0.8)
  })

  it('returns 0.5 for "50%" preset', () => {
    const scale = getScaleForPreset('50%', 1000, 800, 1000, 800)
    expect(scale).toBe(0.5)
  })

  it('returns 1.0 for "100%" preset', () => {
    const scale = getScaleForPreset('100%', 1000, 800, 1000, 800)
    expect(scale).toBe(1.0)
  })

  it('returns 2.0 for "200%" preset', () => {
    const scale = getScaleForPreset('200%', 1000, 800, 1000, 800)
    expect(scale).toBe(2.0)
  })

  it('returns 1.0 for "custom" preset', () => {
    const scale = getScaleForPreset('custom', 1000, 800, 1000, 800)
    expect(scale).toBe(1.0)
  })
})

// ============================================================================
// createCameraForPreset
// ============================================================================

describe('createCameraForPreset', () => {
  it('creates centered camera for fit preset', () => {
    const camera = createCameraForPreset('fit', 2000, 1600, 1000, 800)

    expect(camera.scale).toBe(0.5)
    // At scale 0.5, image is 1000x800, viewport is 1000x800
    // Centered: panX = (1000 - 1000) / 2 = 0
    expect(camera.panX).toBe(0)
    expect(camera.panY).toBe(0)
  })

  it('creates centered camera for 100% preset', () => {
    const camera = createCameraForPreset('100%', 500, 400, 1000, 800)

    expect(camera.scale).toBe(1)
    // At scale 1, image is 500x400, viewport is 1000x800
    // Centered: panX = (1000 - 500) / 2 = 250
    expect(camera.panX).toBe(250)
    expect(camera.panY).toBe(200)
  })

  it('creates camera with negative pan for large image', () => {
    const camera = createCameraForPreset('100%', 2000, 1600, 1000, 800)

    expect(camera.scale).toBe(1)
    // At scale 1, image is 2000x1600, viewport is 1000x800
    // Centered: panX = (1000 - 2000) / 2 = -500
    expect(camera.panX).toBe(-500)
    expect(camera.panY).toBe(-400)
  })
})

// ============================================================================
// getZoomPercentage
// ============================================================================

describe('getZoomPercentage', () => {
  it('returns 100 for scale 1', () => {
    expect(getZoomPercentage(1)).toBe(100)
  })

  it('returns 50 for scale 0.5', () => {
    expect(getZoomPercentage(0.5)).toBe(50)
  })

  it('returns 200 for scale 2', () => {
    expect(getZoomPercentage(2)).toBe(200)
  })

  it('rounds to nearest integer', () => {
    expect(getZoomPercentage(0.333)).toBe(33)
    expect(getZoomPercentage(0.337)).toBe(34)
  })
})

// ============================================================================
// detectPreset
// ============================================================================

describe('detectPreset', () => {
  it('detects fit preset', () => {
    const fitScale = calculateFitScale(2000, 1600, 1000, 800)
    const camera: Camera = { scale: fitScale, panX: 0, panY: 0 }
    const preset = detectPreset(camera, 2000, 1600, 1000, 800)
    expect(preset).toBe('fit')
  })

  it('detects fill preset', () => {
    const fillScale = calculateFillScale(2000, 1000, 1000, 800)
    const camera: Camera = { scale: fillScale, panX: 0, panY: 0 }
    const preset = detectPreset(camera, 2000, 1000, 1000, 800)
    expect(preset).toBe('fill')
  })

  it('detects 50% preset', () => {
    const camera: Camera = { scale: 0.5, panX: 0, panY: 0 }
    const preset = detectPreset(camera, 1000, 800, 1000, 800)
    expect(preset).toBe('50%')
  })

  it('detects 100% preset', () => {
    // Use an image that's larger than viewport so fit scale != 1.0
    const camera: Camera = { scale: 1, panX: 0, panY: 0 }
    const preset = detectPreset(camera, 2000, 1600, 1000, 800)
    expect(preset).toBe('100%')
  })

  it('detects 200% preset', () => {
    const camera: Camera = { scale: 2, panX: 0, panY: 0 }
    const preset = detectPreset(camera, 1000, 800, 1000, 800)
    expect(preset).toBe('200%')
  })

  it('returns custom for non-preset scale', () => {
    const camera: Camera = { scale: 1.37, panX: 0, panY: 0 }
    const preset = detectPreset(camera, 1000, 800, 1000, 800)
    expect(preset).toBe('custom')
  })

  it('handles near-preset values within tolerance', () => {
    // Use an image that's larger than viewport so fit scale != 1.0
    const camera: Camera = { scale: 1.0005, panX: 0, panY: 0 }
    const preset = detectPreset(camera, 2000, 1600, 1000, 800)
    expect(preset).toBe('100%')
  })
})

// ============================================================================
// Constants
// ============================================================================

describe('constants', () => {
  it('has valid MIN_ZOOM', () => {
    expect(MIN_ZOOM).toBe(0.1)
    expect(MIN_ZOOM).toBeGreaterThan(0)
    expect(MIN_ZOOM).toBeLessThan(1)
  })

  it('has valid MAX_ZOOM', () => {
    expect(MAX_ZOOM).toBe(4)
    expect(MAX_ZOOM).toBeGreaterThan(1)
  })

  it('has valid ZOOM_STEP', () => {
    expect(ZOOM_STEP).toBe(1.25)
    expect(ZOOM_STEP).toBeGreaterThan(1)
  })
})
