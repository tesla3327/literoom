/**
 * Tests for curve-utils.ts
 */

import { describe, it, expect } from 'vitest'
import { isLinearCurve, CURVE_POINT_TOLERANCE } from './curve-utils'

describe('isLinearCurve', () => {
  it('returns true for exact identity curve [(0,0), (1,1)]', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
    expect(isLinearCurve(points)).toBe(true)
  })

  it('returns true for identity curve within tolerance', () => {
    const almostZero = CURVE_POINT_TOLERANCE * 0.9
    const almostOne = 1 - almostZero
    const points = [
      { x: almostZero, y: almostZero },
      { x: almostOne, y: almostOne },
    ]
    expect(isLinearCurve(points)).toBe(true)
  })

  it('returns false for curve outside tolerance', () => {
    const outsideTolerance = CURVE_POINT_TOLERANCE * 1.5
    const points = [
      { x: outsideTolerance, y: 0 },
      { x: 1, y: 1 },
    ]
    expect(isLinearCurve(points)).toBe(false)
  })

  it('returns false for single point', () => {
    const points = [{ x: 0, y: 0 }]
    expect(isLinearCurve(points)).toBe(false)
  })

  it('returns false for three points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ]
    expect(isLinearCurve(points)).toBe(false)
  })

  it('returns false for empty array', () => {
    expect(isLinearCurve([])).toBe(false)
  })

  it('returns false for non-identity two-point curve', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0.5 },
    ]
    expect(isLinearCurve(points)).toBe(false)
  })

  it('returns false for S-curve', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.25, y: 0.15 },
      { x: 0.75, y: 0.85 },
      { x: 1, y: 1 },
    ]
    expect(isLinearCurve(points)).toBe(false)
  })

  it('works with readonly arrays', () => {
    const points: readonly { x: number; y: number }[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]
    expect(isLinearCurve(points)).toBe(true)
  })

  it('returns false when first point y is not near 0', () => {
    const points = [
      { x: 0, y: 0.5 },
      { x: 1, y: 1 },
    ]
    expect(isLinearCurve(points)).toBe(false)
  })

  it('returns false when second point x is not near 1', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 0.9, y: 1 },
    ]
    expect(isLinearCurve(points)).toBe(false)
  })

  it('returns false when second point y is not near 1', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0.8 },
    ]
    expect(isLinearCurve(points)).toBe(false)
  })
})

describe('CURVE_POINT_TOLERANCE', () => {
  it('has expected value of 0.001', () => {
    expect(CURVE_POINT_TOLERANCE).toBe(0.001)
  })
})
