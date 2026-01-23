/**
 * Unit tests for canvas coordinate utility functions.
 *
 * These pure functions handle coordinate conversion between different
 * coordinate systems used by crop, mask, and other canvas overlays.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { toNormalized, toCanvas, getCanvasCoords, debounce } from '~/utils/canvasCoords'

// ============================================================================
// toNormalized
// ============================================================================

describe('toNormalized', () => {
  it('converts canvas center to normalized (0.5, 0.5)', () => {
    const result = toNormalized(500, 400, 1000, 800)
    expect(result).toEqual({ x: 0.5, y: 0.5 })
  })

  it('converts canvas origin to normalized (0, 0)', () => {
    const result = toNormalized(0, 0, 1000, 800)
    expect(result).toEqual({ x: 0, y: 0 })
  })

  it('converts canvas bottom-right to normalized (1, 1)', () => {
    const result = toNormalized(1000, 800, 1000, 800)
    expect(result).toEqual({ x: 1, y: 1 })
  })

  it('clamps values below 0 to 0', () => {
    const result = toNormalized(-100, -50, 1000, 800)
    expect(result).toEqual({ x: 0, y: 0 })
  })

  it('clamps values above canvas size to 1', () => {
    const result = toNormalized(1500, 1200, 1000, 800)
    expect(result).toEqual({ x: 1, y: 1 })
  })

  it('handles non-square canvases correctly', () => {
    // Canvas is 1920x1080
    const result = toNormalized(960, 540, 1920, 1080)
    expect(result.x).toBeCloseTo(0.5)
    expect(result.y).toBeCloseTo(0.5)
  })

  it('handles small canvases', () => {
    const result = toNormalized(5, 5, 10, 10)
    expect(result).toEqual({ x: 0.5, y: 0.5 })
  })

  it('returns clamped values for edge cases', () => {
    // Exactly at edge
    const atEdge = toNormalized(1000, 800, 1000, 800)
    expect(atEdge.x).toBeLessThanOrEqual(1)
    expect(atEdge.y).toBeLessThanOrEqual(1)
  })
})

// ============================================================================
// toCanvas
// ============================================================================

describe('toCanvas', () => {
  it('converts normalized center (0.5, 0.5) to canvas center', () => {
    const result = toCanvas(0.5, 0.5, 1000, 800)
    expect(result).toEqual({ x: 500, y: 400 })
  })

  it('converts normalized origin (0, 0) to canvas origin', () => {
    const result = toCanvas(0, 0, 1000, 800)
    expect(result).toEqual({ x: 0, y: 0 })
  })

  it('converts normalized (1, 1) to canvas bottom-right', () => {
    const result = toCanvas(1, 1, 1000, 800)
    expect(result).toEqual({ x: 1000, y: 800 })
  })

  it('handles non-square canvases correctly', () => {
    // Canvas is 1920x1080
    const result = toCanvas(0.25, 0.75, 1920, 1080)
    expect(result).toEqual({ x: 480, y: 810 })
  })

  it('handles fractional normalized coordinates', () => {
    const result = toCanvas(0.333, 0.666, 300, 300)
    expect(result.x).toBeCloseTo(99.9)
    expect(result.y).toBeCloseTo(199.8)
  })

  it('is inverse of toNormalized', () => {
    const width = 1920
    const height = 1080
    const originalX = 480
    const originalY = 540

    const normalized = toNormalized(originalX, originalY, width, height)
    const backToCanvas = toCanvas(normalized.x, normalized.y, width, height)

    expect(backToCanvas.x).toBeCloseTo(originalX)
    expect(backToCanvas.y).toBeCloseTo(originalY)
  })
})

// ============================================================================
// getCanvasCoords
// ============================================================================

describe('getCanvasCoords', () => {
  // Create a mock canvas element
  function createMockCanvas(
    canvasWidth: number,
    canvasHeight: number,
    rectLeft: number,
    rectTop: number,
    rectWidth: number,
    rectHeight: number,
  ): HTMLCanvasElement {
    return {
      width: canvasWidth,
      height: canvasHeight,
      getBoundingClientRect: () => ({
        left: rectLeft,
        top: rectTop,
        width: rectWidth,
        height: rectHeight,
        right: rectLeft + rectWidth,
        bottom: rectTop + rectHeight,
        x: rectLeft,
        y: rectTop,
        toJSON: () => ({}),
      }),
    } as HTMLCanvasElement
  }

  // Create a mock mouse event
  function createMockMouseEvent(clientX: number, clientY: number): MouseEvent {
    return { clientX, clientY } as MouseEvent
  }

  it('converts mouse position to canvas coordinates (1:1 scale)', () => {
    const canvas = createMockCanvas(1000, 800, 100, 50, 1000, 800)
    const event = createMockMouseEvent(600, 450) // 500px from left edge, 400px from top

    const result = getCanvasCoords(event, canvas)
    expect(result).toEqual({ x: 500, y: 400 })
  })

  it('handles canvas scaled down (CSS display smaller than actual)', () => {
    // Canvas is 2000x1600 but displayed as 1000x800
    const canvas = createMockCanvas(2000, 1600, 0, 0, 1000, 800)
    const event = createMockMouseEvent(500, 400) // Center of displayed canvas

    const result = getCanvasCoords(event, canvas)
    expect(result).toEqual({ x: 1000, y: 800 }) // Center of actual canvas
  })

  it('handles canvas scaled up (CSS display larger than actual)', () => {
    // Canvas is 500x400 but displayed as 1000x800
    const canvas = createMockCanvas(500, 400, 0, 0, 1000, 800)
    const event = createMockMouseEvent(500, 400) // Center of displayed canvas

    const result = getCanvasCoords(event, canvas)
    expect(result).toEqual({ x: 250, y: 200 }) // Center of actual canvas
  })

  it('accounts for canvas position offset', () => {
    // Canvas at position (200, 100) on page
    const canvas = createMockCanvas(800, 600, 200, 100, 800, 600)
    const event = createMockMouseEvent(600, 400) // 400px from canvas left, 300px from top

    const result = getCanvasCoords(event, canvas)
    expect(result).toEqual({ x: 400, y: 300 })
  })

  it('handles CSS transform (zoom) correctly', () => {
    // Canvas is 1000x800, displayed at 2x zoom (2000x1600)
    // getBoundingClientRect returns the transformed size
    const canvas = createMockCanvas(1000, 800, 0, 0, 2000, 1600)
    const event = createMockMouseEvent(1000, 800) // Center of zoomed display

    const result = getCanvasCoords(event, canvas)
    // Should map to center of actual canvas
    expect(result).toEqual({ x: 500, y: 400 })
  })

  it('handles mouse at canvas origin', () => {
    const canvas = createMockCanvas(1000, 800, 50, 25, 1000, 800)
    const event = createMockMouseEvent(50, 25) // At canvas origin

    const result = getCanvasCoords(event, canvas)
    expect(result).toEqual({ x: 0, y: 0 })
  })

  it('handles mouse at canvas bottom-right', () => {
    const canvas = createMockCanvas(1000, 800, 0, 0, 1000, 800)
    const event = createMockMouseEvent(1000, 800) // At canvas bottom-right

    const result = getCanvasCoords(event, canvas)
    expect(result).toEqual({ x: 1000, y: 800 })
  })
})

// ============================================================================
// debounce
// ============================================================================

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('delays function execution', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('passes arguments to the debounced function', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('arg1', 'arg2')
    vi.advanceTimersByTime(100)

    expect(fn).toHaveBeenCalledWith('arg1', 'arg2')
  })

  it('resets timer on subsequent calls', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    vi.advanceTimersByTime(50)

    debounced() // Reset timer
    vi.advanceTimersByTime(50)
    expect(fn).not.toHaveBeenCalled()

    vi.advanceTimersByTime(50)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('only calls function once for rapid successive calls', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    debounced()
    debounced()
    debounced()
    debounced()

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('uses the last arguments when called multiple times', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('first')
    debounced('second')
    debounced('third')

    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledWith('third')
  })

  it('can be cancelled', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced()
    debounced.cancel()

    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
  })

  it('cancel does nothing if no pending call', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    // Should not throw
    debounced.cancel()
    debounced.cancel()

    expect(fn).not.toHaveBeenCalled()
  })

  it('allows function to be called again after delay', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 100)

    debounced('first')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(1)

    debounced('second')
    vi.advanceTimersByTime(100)
    expect(fn).toHaveBeenCalledTimes(2)
    expect(fn).toHaveBeenLastCalledWith('second')
  })

  it('handles zero delay', () => {
    const fn = vi.fn()
    const debounced = debounce(fn, 0)

    debounced()
    expect(fn).not.toHaveBeenCalled() // Still async

    vi.advanceTimersByTime(0)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
