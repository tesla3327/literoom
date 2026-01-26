/**
 * Tone curve utilities.
 *
 * Shared utilities for tone curve operations, including identity curve detection.
 */

import type { CurvePoint } from './types'

/**
 * Tolerance for comparing curve point coordinates.
 * Points within this distance from expected values are considered equal.
 */
export const CURVE_POINT_TOLERANCE = 0.001

/**
 * Check if curve points form a linear (identity) curve.
 *
 * A linear curve has exactly 2 points: (0,0) and (1,1).
 * Small deviations within CURVE_POINT_TOLERANCE are allowed.
 *
 * @param points - Curve control points to check
 * @returns true if the curve is linear/identity
 */
export function isLinearCurve(
  points: readonly CurvePoint[] | Array<{ x: number; y: number }>
): boolean {
  if (points.length !== 2) return false
  const [p0, p1] = points
  return (
    Math.abs(p0.x) < CURVE_POINT_TOLERANCE &&
    Math.abs(p0.y) < CURVE_POINT_TOLERANCE &&
    Math.abs(p1.x - 1) < CURVE_POINT_TOLERANCE &&
    Math.abs(p1.y - 1) < CURVE_POINT_TOLERANCE
  )
}

/**
 * Linear interpolation on a tone curve.
 *
 * Finds the segment containing x and linearly interpolates the y value.
 * Used for UI preview rendering and mock implementations where full
 * monotonic spline interpolation is not needed.
 *
 * @param points - Curve control points sorted by x
 * @param x - Input value to evaluate (0-1)
 * @returns Interpolated y value (0-1)
 */
export function linearInterpolateCurve(
  points: readonly CurvePoint[] | Array<{ x: number; y: number }>,
  x: number
): number {
  if (points.length < 2) return x

  // Handle endpoints
  const first = points[0]!
  const last = points[points.length - 1]!
  if (x <= first.x) return first.y
  if (x >= last.x) return last.y

  // Find segment containing x
  let segIndex = 0
  while (segIndex < points.length - 1 && points[segIndex + 1]!.x < x) {
    segIndex++
  }

  const p0 = points[segIndex]!
  const p1 = points[segIndex + 1] ?? p0

  // Linear interpolation
  if (p1.x === p0.x) return p0.y
  const t = (x - p0.x) / (p1.x - p0.x)
  return p0.y + t * (p1.y - p0.y)
}
