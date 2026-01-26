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
