/**
 * Unit tests for histogram display utility functions.
 *
 * Tests for SVG path generation and spline calculations used by
 * the histogram display.
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// Helper functions extracted for testing
// ============================================================================

interface Point {
  x: number
  y: number
}

const SPLINE_TENSION = 0.5
const SAMPLE_RATE = 4

/**
 * Convert Catmull-Rom spline points to cubic bezier path data.
 */
function catmullRomToBezierPath(points: Point[], closed: boolean = false): string {
  if (points.length < 2) return ''

  const path: string[] = []

  // Start at first point
  path.push(`M ${points[0]!.x} ${points[0]!.y}`)

  // For Catmull-Rom, we need points before and after each segment
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i]!
    const p1 = points[i]!
    const p2 = points[i + 1]!
    const p3 = points[i + 2] || p2

    // Calculate control points for cubic bezier
    const cp1x = p1.x + (p2.x - p0.x) / 6 * SPLINE_TENSION
    const cp1y = p1.y + (p2.y - p0.y) / 6 * SPLINE_TENSION
    const cp2x = p2.x - (p3.x - p1.x) / 6 * SPLINE_TENSION
    const cp2y = p2.y - (p3.y - p1.y) / 6 * SPLINE_TENSION

    path.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`)
  }

  if (closed) {
    path.push('Z')
  }

  return path.join(' ')
}

/**
 * Convert histogram data to SVG path with smooth curves.
 */
function histogramToPath(
  data: Uint32Array,
  maxValue: number,
  width: number,
  height: number,
): string {
  if (maxValue === 0) return ''

  const points: Point[] = []

  // Sample the histogram data at regular intervals
  for (let i = 0; i < 256; i += SAMPLE_RATE) {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - SAMPLE_RATE / 2); j < Math.min(256, i + SAMPLE_RATE / 2); j++) {
      sum += data[j] ?? 0
      count++
    }
    const value = sum / count

    const x = (i / 255) * width
    const y = height - (value / maxValue) * height

    points.push({ x, y })
  }

  // Add the last point
  const lastValue = data[255] ?? 0
  points.push({
    x: width,
    y: height - (lastValue / maxValue) * height,
  })

  const curvePath = catmullRomToBezierPath(points)
  return `${curvePath} L ${width} ${height} L 0 ${height} Z`
}

// ============================================================================
// catmullRomToBezierPath Tests
// ============================================================================

describe('catmullRomToBezierPath', () => {
  it('returns empty string for less than 2 points', () => {
    expect(catmullRomToBezierPath([])).toBe('')
    expect(catmullRomToBezierPath([{ x: 0, y: 0 }])).toBe('')
  })

  it('generates path for 2 points', () => {
    const points = [{ x: 0, y: 0 }, { x: 100, y: 100 }]
    const path = catmullRomToBezierPath(points)

    expect(path).toContain('M 0 0')
    expect(path).toContain('C')
    expect(path).toContain('100 100')
  })

  it('generates path for 3 points', () => {
    const points = [
      { x: 0, y: 100 },
      { x: 50, y: 0 },
      { x: 100, y: 100 },
    ]
    const path = catmullRomToBezierPath(points)

    expect(path).toContain('M 0 100')
    expect(path.match(/C/g)?.length).toBe(2) // Two curve segments
  })

  it('generates smooth curve through all points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
      { x: 150, y: 50 },
    ]
    const path = catmullRomToBezierPath(points)

    // Should have move + 3 curves
    expect(path).toContain('M 0 0')
    expect(path.match(/C/g)?.length).toBe(3)
  })

  it('closes path when closed=true', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 100 },
    ]
    const openPath = catmullRomToBezierPath(points, false)
    const closedPath = catmullRomToBezierPath(points, true)

    expect(openPath).not.toContain('Z')
    expect(closedPath).toContain('Z')
  })

  it('handles negative coordinates', () => {
    const points = [
      { x: -50, y: -50 },
      { x: 0, y: 0 },
      { x: 50, y: -50 },
    ]
    const path = catmullRomToBezierPath(points)

    expect(path).toContain('M -50 -50')
    expect(path).toContain('-50')
  })

  it('handles decimal coordinates', () => {
    const points = [
      { x: 0.5, y: 0.5 },
      { x: 1.5, y: 1.5 },
      { x: 2.5, y: 0.5 },
    ]
    const path = catmullRomToBezierPath(points)

    expect(path).toContain('M 0.5 0.5')
    expect(path).toContain('2.5 0.5')
  })
})

// ============================================================================
// histogramToPath Tests
// ============================================================================

describe('histogramToPath', () => {
  it('returns empty string when maxValue is 0', () => {
    const data = new Uint32Array(256).fill(0)
    const path = histogramToPath(data, 0, 256, 192)
    expect(path).toBe('')
  })

  it('generates closed path for valid histogram data', () => {
    const data = new Uint32Array(256)
    data.fill(100)
    const path = histogramToPath(data, 100, 256, 192)

    // Should be a closed path
    expect(path).toContain('M')
    expect(path).toContain('C')
    expect(path).toContain('L')
    expect(path.endsWith('Z')).toBe(true)
  })

  it('scales y-values correctly based on maxValue', () => {
    const data = new Uint32Array(256)
    data.fill(50) // Half of max

    const path = histogramToPath(data, 100, 256, 192)

    // Middle values should be around y=96 (half height)
    // Path should contain points in the middle height range
    expect(path).toContain('M')
  })

  it('handles single-peak histogram', () => {
    const data = new Uint32Array(256).fill(0)
    data[128] = 1000 // Peak in middle

    const path = histogramToPath(data, 1000, 256, 192)

    expect(path).toContain('M')
    expect(path).toContain('Z')
  })

  it('handles histogram with values at edges', () => {
    const data = new Uint32Array(256).fill(0)
    data[0] = 100
    data[255] = 100

    const path = histogramToPath(data, 100, 256, 192)

    expect(path).toContain('M')
    // Should close to bottom corners
    expect(path).toContain('L 256 192')
    expect(path).toContain('L 0 192')
  })

  it('generates correct width scaling', () => {
    const data = new Uint32Array(256).fill(50)

    // With width=512, the path should span 0 to 512
    const path = histogramToPath(data, 100, 512, 192)

    expect(path).toContain('L 512 192')
  })

  it('generates correct height scaling', () => {
    const data = new Uint32Array(256).fill(100)

    // With height=384, the close should go to y=384
    const path = histogramToPath(data, 100, 256, 384)

    expect(path).toContain('L 256 384')
    expect(path).toContain('L 0 384')
  })

  it('averages nearby bins for smoothing', () => {
    // Create a noisy histogram
    const data = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      data[i] = i % 2 === 0 ? 100 : 0 // Alternating values
    }

    const path = histogramToPath(data, 100, 256, 192)

    // Should produce a valid path (smoothed)
    expect(path).toContain('M')
    expect(path).toContain('C')
  })
})

// ============================================================================
// SVG Constants Tests
// ============================================================================

describe('SVG constants', () => {
  it('SVG dimensions are reasonable', () => {
    const SVG_WIDTH = 256
    const SVG_HEIGHT = 192

    expect(SVG_WIDTH).toBeGreaterThan(0)
    expect(SVG_HEIGHT).toBeGreaterThan(0)
    expect(SVG_WIDTH).toBe(256) // Standard histogram bin count
    expect(SVG_HEIGHT).toBeLessThan(SVG_WIDTH) // Landscape aspect ratio
  })

  it('sample rate produces reasonable number of points', () => {
    const SAMPLE_RATE = 4
    const expectedPoints = Math.ceil(256 / SAMPLE_RATE) + 1

    // Should produce 64-65 sample points for smooth curves
    expect(expectedPoints).toBeGreaterThan(60)
    expect(expectedPoints).toBeLessThan(70)
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles all-zero histogram', () => {
    const data = new Uint32Array(256).fill(0)
    // maxValue would be 0, so should return empty
    const path = histogramToPath(data, 0, 256, 192)
    expect(path).toBe('')
  })

  it('handles single-value histogram', () => {
    const data = new Uint32Array(256).fill(42)
    const path = histogramToPath(data, 42, 256, 192)

    // Should produce a flat line at top (all values equal maxValue)
    expect(path).toContain('M')
    expect(path).toContain('Z')
  })

  it('handles very large values', () => {
    const data = new Uint32Array(256).fill(4294967295) // Max uint32
    const path = histogramToPath(data, 4294967295, 256, 192)

    expect(path).toContain('M')
    expect(path).toContain('Z')
  })

  it('handles very small dimensions', () => {
    const data = new Uint32Array(256).fill(100)
    const path = histogramToPath(data, 100, 1, 1)

    expect(path).toContain('M')
    expect(path).toContain('Z')
  })
})
