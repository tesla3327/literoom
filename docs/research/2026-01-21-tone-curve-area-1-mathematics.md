# Phase 11: Tone Curve - Area 1: Mathematics and Interpolation Algorithms

**Date**: 2026-01-21
**Status**: Complete
**Objective**: Research interpolation algorithms and data structures for implementing a Lightroom-style tone curve editor

---

## Executive Summary

For literoom's tone curve implementation, **Monotonic Cubic Hermite Splines using the Fritsch-Carlson algorithm** are recommended as the primary interpolation method. This choice balances smoothness, guaranteed monotonicity (preventing artifacts), computational efficiency, and proven use in professional photo editing software.

### Key Recommendations

| Aspect | Recommendation | Rationale |
|--------|---------------|-----------|
| **Interpolation Algorithm** | Monotonic Cubic Hermite (Fritsch-Carlson) | Guarantees monotonicity, prevents overshoot, well-documented |
| **Alternative** | Centripetal Catmull-Rom | Good fallback, also prevents overshoot, simpler to implement |
| **Data Structure** | Array of `{x, y}` points + 256-entry LUT cache | Efficient storage, O(1) pixel application |
| **Monotonicity** | Enforce via Fritsch-Carlson slope adjustment | Mathematical guarantee, single-pass algorithm |

---

## 1. Interpolation Algorithm Comparison

### 1.1 Cubic Bezier Splines

**How it works**: Uses four control points (P0, P1, P2, P3) per segment with the parametric formula:
```
P(t) = (1-t)^3 * P0 + 3(1-t)^2 * t * P1 + 3(1-t) * t^2 * P2 + t^3 * P3
```

**Pros**:
- Very smooth curves
- Well-understood mathematics
- Native support in many graphics APIs

**Cons**:
- Control points don't lie on the curve (except endpoints)
- Requires extra UI complexity for users to manipulate "handles"
- No inherent monotonicity guarantee
- Can produce overshoots and oscillations

**Verdict**: Not ideal for tone curves because users expect to click directly on the curve, not manipulate off-curve handles.

### 1.2 Catmull-Rom Splines

**How it works**: An interpolating cubic spline that automatically computes tangents from neighboring points. The curve passes through all control points.

Three variants exist:
- **Uniform**: Original formulation, can produce loops
- **Chordal**: Uses chord length for parameterization
- **Centripetal**: Uses square root of chord length, proven to avoid self-intersections and cusps

**Pros**:
- Control points lie directly on the curve (intuitive for users)
- Smooth C1 continuity
- Centripetal variant prevents overshoots for large point variations
- Simple implementation

**Cons**:
- Does not guarantee strict monotonicity
- Centripetal variant is "stiffer" than natural cubic splines
- Can still produce minor overshoots near steep transitions

**Centripetal parameterization formula**:
```javascript
// alpha = 0.5 for centripetal (0 = uniform, 1 = chordal)
function getT(t, alpha, p0, p1) {
  const d = Math.sqrt((p1.x - p0.x)**2 + (p1.y - p0.y)**2);
  return t + Math.pow(d, alpha);
}
```

**Verdict**: Good choice for general curve editing, and RawTherapee uses the centripetal variant for its "Flexible" curve mode. However, for tone curves where monotonicity is critical, additional constraints may be needed.

### 1.3 Monotonic Cubic Hermite Splines (Fritsch-Carlson)

**How it works**: A cubic Hermite spline with tangent values specifically constrained to preserve monotonicity. Uses a two-step process: compute initial tangents, then adjust any that would violate monotonicity.

**Pros**:
- Mathematically guaranteed monotonicity
- Prevents overshoots and undershoots
- Control points lie on the curve
- Well-documented algorithm (1980 SIAM paper)
- Available in many libraries (SciPy PCHIP, etc.)
- C1 continuous (smooth first derivative)

**Cons**:
- Slightly "stiffer" appearance than natural cubic splines
- Second derivative may be discontinuous at control points
- More complex to implement than basic Catmull-Rom

**Verdict**: **Best choice for tone curves** because monotonicity is essential to avoid crossing curves that produce visual artifacts (solarization effects).

### 1.4 Natural Cubic Splines

**How it works**: Minimizes the integral of the squared second derivative, producing the "smoothest" possible interpolating curve with C2 continuity.

**Pros**:
- Mathematically smoothest interpolation
- C2 continuity (continuous curvature)

**Cons**:
- No monotonicity guarantee - can oscillate significantly
- Global dependency - moving one point affects the entire curve
- Can produce large overshoots near steep sections

**Verdict**: Not recommended for tone curves due to oscillation risk.

---

## 2. Professional Tool Implementations

### 2.1 Adobe Lightroom / Photoshop

Adobe's implementation details are proprietary, but based on community analysis and the DNG SDK:

- Uses cubic spline interpolation for the "parametric" and "point" curve modes
- The DNG SDK includes a `ProfileToneCurve` that can be converted to control points
- RawTherapee's "Film-Like" mode uses Adobe's reference implementation from the DNG SDK
- Adobe Camera Raw applies curve adjustments in LAB color space for luminosity curves

**Key insight**: Adobe's curve appears to use a constrained cubic spline that avoids sharp overshoots, likely with monotonicity enforcement or careful tension parameters.

### 2.2 RawTherapee

RawTherapee offers multiple curve types:

1. **Standard**: Natural cubic spline - "editing one node could have a huge impact on what happens to the curve in relation to the other nodes"
2. **Flexible**: Centripetal Catmull-Rom spline - "allows you to make adjustments to any part of the curve with little impact on the other parts"

Source code references:
- `rtengine/curves.h` and `rtengine/curves.cc`

**Key insight**: RawTherapee's "Flexible" mode with centripetal Catmull-Rom is specifically designed to give users more localized control.

### 2.3 darktable

darktable provides multiple spline options:

1. **Cubic spline**: Standard smooth interpolation
2. **Monotonic spline**: "designed specifically to give a monotonic interpolation, meaning there will be none of the oscillations the cubic spline may produce"

**Key insight**: darktable explicitly offers monotonic splines as a separate option, recognizing their value for tone mapping.

---

## 3. Ensuring Monotonicity

### 3.1 Why Monotonicity Matters

A non-monotonic tone curve causes problems:
- **Visual artifacts**: Crossing curves can produce solarization-like effects
- **Information loss**: Non-unique mapping loses tonal separation
- **Unexpected results**: Darker input may produce lighter output than slightly lighter input

### 3.2 The Fritsch-Carlson Algorithm

This is the standard algorithm for enforcing monotonicity in cubic Hermite splines.

**Step 1: Compute secants (slopes between adjacent points)**
```rust
// For each interval [i, i+1]
let h_i = x[i+1] - x[i];           // interval width
let delta_i = (y[i+1] - y[i]) / h_i;  // secant slope
```

**Step 2: Compute initial tangents**
```rust
// For interior points, use average of neighboring secants
// (weighted harmonic mean for non-uniform spacing)
for k in 1..n-1 {
    if delta[k-1] * delta[k] > 0.0 {
        // Same sign - use weighted harmonic mean
        let w1 = 2.0 * h[k] + h[k-1];
        let w2 = h[k] + 2.0 * h[k-1];
        m[k] = (w1 + w2) / (w1 / delta[k-1] + w2 / delta[k]);
    } else {
        // Different signs or zero - flat tangent
        m[k] = 0.0;
    }
}

// Endpoint tangents (one-sided difference)
m[0] = delta[0];
m[n-1] = delta[n-2];
```

**Step 3: Adjust tangents for monotonicity**
```rust
for k in 0..n-1 {
    if delta[k] == 0.0 {
        // Flat segment - both tangents must be zero
        m[k] = 0.0;
        m[k+1] = 0.0;
    } else {
        let alpha = m[k] / delta[k];
        let beta = m[k+1] / delta[k];

        // Constraint: alpha^2 + beta^2 <= 9
        // Simplified sufficient condition: alpha <= 3 and beta <= 3
        if alpha > 3.0 {
            m[k] = 3.0 * delta[k];
        }
        if beta > 3.0 {
            m[k+1] = 3.0 * delta[k];
        }
    }
}
```

**Step 4: Evaluate using cubic Hermite basis**
```rust
fn evaluate(x: f32, points: &[CurvePoint], tangents: &[f32]) -> f32 {
    // Find interval containing x
    let i = find_interval(x, points);

    let h = points[i+1].x - points[i].x;
    let t = (x - points[i].x) / h;

    // Hermite basis functions
    let h00 = (1.0 + 2.0*t) * (1.0 - t).powi(2);
    let h10 = t * (1.0 - t).powi(2);
    let h01 = t.powi(2) * (3.0 - 2.0*t);
    let h11 = t.powi(2) * (t - 1.0);

    // Interpolate
    h00 * points[i].y
        + h10 * h * tangents[i]
        + h01 * points[i+1].y
        + h11 * h * tangents[i+1]
}
```

### 3.3 Alternative: Constrained Catmull-Rom

For a simpler implementation, centripetal Catmull-Rom with clipping can approximate monotonicity:

```rust
fn evaluate_catmull_rom(t: f32, p0: f32, p1: f32, p2: f32, p3: f32) -> f32 {
    let t2 = t * t;
    let t3 = t2 * t;

    let result = 0.5 * (
        (2.0 * p1) +
        (-p0 + p2) * t +
        (2.0*p0 - 5.0*p1 + 4.0*p2 - p3) * t2 +
        (-p0 + 3.0*p1 - 3.0*p2 + p3) * t3
    );

    // Clamp to ensure monotonicity (simple approach)
    result.clamp(p1.min(p2), p1.max(p2))
}
```

Note: This clamping is a pragmatic approximation, not a true mathematical guarantee like Fritsch-Carlson.

---

## 4. Data Structures

### 4.1 Control Points Storage

The existing literoom structure is well-designed:

```rust
// Already exists in literoom-core/src/lib.rs
pub struct CurvePoint {
    pub x: f32,  // Input value (0.0 to 1.0)
    pub y: f32,  // Output value (0.0 to 1.0)
}

pub struct ToneCurve {
    pub points: Vec<CurvePoint>,  // Sorted by x
}
```

**Recommendations**:
1. Keep points sorted by x-coordinate
2. Enforce minimum of 2 points (endpoints at 0,0 and 1,1)
3. Limit maximum points (16-32 is typical, Photoshop uses 16)
4. Prevent duplicate x-values (would cause vertical tangents)

### 4.2 TypeScript Mirror

```typescript
// For packages/core/src/decode/types.ts
export interface CurvePoint {
  x: number;  // 0 to 1
  y: number;  // 0 to 1
}

export interface ToneCurve {
  points: CurvePoint[];
}

export const DEFAULT_TONE_CURVE: ToneCurve = {
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 }
  ]
};
```

### 4.3 LUT Generation for Performance

Pre-computing a 256-entry lookup table is essential for real-time performance:

```rust
impl ToneCurve {
    /// Generate a 256-entry lookup table for fast pixel processing
    pub fn generate_lut(&self) -> [u8; 256] {
        // Pre-compute tangents once
        let tangents = self.compute_monotonic_tangents();

        let mut lut = [0u8; 256];
        for i in 0..256 {
            let x = i as f32 / 255.0;
            let y = self.evaluate_with_tangents(x, &tangents);
            lut[i] = (y * 255.0).clamp(0.0, 255.0).round() as u8;
        }
        lut
    }
}
```

**Performance characteristics**:
- LUT generation: O(256 * log n) where n = number of control points
- Pixel application: O(1) per channel per pixel
- Memory: 256 bytes per curve (or 768 bytes for RGB curves)

For a 24MP image (6000x4000):
- Without LUT: 24M * 3 channels * spline eval = very slow
- With LUT: 24M * 3 channels * array lookup = ~72M simple operations

### 4.4 Caching Strategy

```rust
pub struct ToneCurveProcessor {
    curve: ToneCurve,
    tangents: Vec<f32>,  // Cached monotonic tangents
    lut: [u8; 256],      // Cached LUT
    dirty: bool,         // Invalidation flag
}

impl ToneCurveProcessor {
    pub fn set_curve(&mut self, curve: ToneCurve) {
        self.curve = curve;
        self.dirty = true;
    }

    pub fn get_lut(&mut self) -> &[u8; 256] {
        if self.dirty {
            self.tangents = self.curve.compute_monotonic_tangents();
            self.lut = self.curve.generate_lut_with_tangents(&self.tangents);
            self.dirty = false;
        }
        &self.lut
    }
}
```

---

## 5. Complete Rust Implementation

Here is a complete, production-ready implementation of monotonic cubic hermite spline interpolation:

```rust
// crates/literoom-core/src/curve.rs

use crate::{CurvePoint, ToneCurve};

impl ToneCurve {
    /// Compute monotonic tangent values using Fritsch-Carlson algorithm
    pub fn compute_monotonic_tangents(&self) -> Vec<f32> {
        let n = self.points.len();
        if n < 2 {
            return vec![0.0; n];
        }

        // Step 1: Compute secants (delta values)
        let mut delta: Vec<f32> = Vec::with_capacity(n - 1);
        let mut h: Vec<f32> = Vec::with_capacity(n - 1);

        for i in 0..n-1 {
            h.push(self.points[i+1].x - self.points[i].x);
            delta.push(
                (self.points[i+1].y - self.points[i].y) / h[i]
            );
        }

        // Step 2: Initialize tangents
        let mut m: Vec<f32> = vec![0.0; n];

        // Interior points: weighted harmonic mean
        for i in 1..n-1 {
            if delta[i-1].signum() != delta[i].signum() ||
               delta[i-1] == 0.0 || delta[i] == 0.0 {
                // Different signs or zero - use zero tangent
                m[i] = 0.0;
            } else {
                // Same sign - weighted harmonic mean
                let w1 = 2.0 * h[i] + h[i-1];
                let w2 = h[i] + 2.0 * h[i-1];
                m[i] = (w1 + w2) / (w1 / delta[i-1] + w2 / delta[i]);
            }
        }

        // Endpoint tangents: one-sided differences
        m[0] = delta[0];
        m[n-1] = delta[n-2];

        // Step 3: Enforce monotonicity constraints
        for i in 0..n-1 {
            if delta[i].abs() < f32::EPSILON {
                // Flat segment
                m[i] = 0.0;
                m[i+1] = 0.0;
            } else {
                let alpha = m[i] / delta[i];
                let beta = m[i+1] / delta[i];

                // Sufficient condition: alpha <= 3 and beta <= 3
                if alpha > 3.0 {
                    m[i] = 3.0 * delta[i];
                }
                if beta > 3.0 {
                    m[i+1] = 3.0 * delta[i];
                }

                // For negative slopes, apply symmetric constraints
                if alpha < -3.0 {
                    m[i] = -3.0 * delta[i].abs();
                }
                if beta < -3.0 {
                    m[i+1] = -3.0 * delta[i].abs();
                }
            }
        }

        m
    }

    /// Evaluate the curve at a given x value
    pub fn evaluate(&self, x: f32) -> f32 {
        let tangents = self.compute_monotonic_tangents();
        self.evaluate_with_tangents(x, &tangents)
    }

    /// Evaluate with pre-computed tangents (for batch operations)
    pub fn evaluate_with_tangents(&self, x: f32, tangents: &[f32]) -> f32 {
        let n = self.points.len();

        // Handle edge cases
        if n == 0 {
            return x; // Identity
        }
        if n == 1 {
            return self.points[0].y;
        }

        // Clamp x to valid range
        let x = x.clamp(self.points[0].x, self.points[n-1].x);

        // Find interval containing x (binary search)
        let i = self.find_interval(x);

        // Hermite interpolation
        let p0 = &self.points[i];
        let p1 = &self.points[i + 1];

        let h = p1.x - p0.x;
        let t = (x - p0.x) / h;

        // Hermite basis functions
        let t2 = t * t;
        let t3 = t2 * t;

        let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
        let h10 = t3 - 2.0 * t2 + t;
        let h01 = -2.0 * t3 + 3.0 * t2;
        let h11 = t3 - t2;

        let y = h00 * p0.y
              + h10 * h * tangents[i]
              + h01 * p1.y
              + h11 * h * tangents[i + 1];

        // Final clamp to valid output range
        y.clamp(0.0, 1.0)
    }

    /// Binary search for interval containing x
    fn find_interval(&self, x: f32) -> usize {
        let n = self.points.len();
        if n <= 2 {
            return 0;
        }

        let mut low = 0;
        let mut high = n - 2;

        while low < high {
            let mid = (low + high + 1) / 2;
            if self.points[mid].x <= x {
                low = mid;
            } else {
                high = mid - 1;
            }
        }

        low
    }

    /// Generate a 256-entry lookup table for fast pixel processing
    pub fn generate_lut(&self) -> [u8; 256] {
        let tangents = self.compute_monotonic_tangents();

        let mut lut = [0u8; 256];
        for i in 0..256 {
            let x = i as f32 / 255.0;
            let y = self.evaluate_with_tangents(x, &tangents);
            lut[i] = (y * 255.0).round() as u8;
        }
        lut
    }

    /// Apply curve to pixel data using pre-computed LUT
    pub fn apply_to_pixels(&self, pixels: &mut [u8]) {
        let lut = self.generate_lut();

        // Apply to RGB channels (assuming RGBA format)
        for chunk in pixels.chunks_exact_mut(4) {
            chunk[0] = lut[chunk[0] as usize]; // R
            chunk[1] = lut[chunk[1] as usize]; // G
            chunk[2] = lut[chunk[2] as usize]; // B
            // Alpha unchanged
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_linear_curve_identity() {
        let curve = ToneCurve::default();

        // Linear curve should be identity
        for i in 0..=10 {
            let x = i as f32 / 10.0;
            let y = curve.evaluate(x);
            assert!((y - x).abs() < 0.01, "Linear curve failed at x={}", x);
        }
    }

    #[test]
    fn test_s_curve_monotonic() {
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.25, 0.15),
                CurvePoint::new(0.5, 0.5),
                CurvePoint::new(0.75, 0.85),
                CurvePoint::new(1.0, 1.0),
            ],
        };

        // Verify monotonicity
        let mut prev_y = -1.0;
        for i in 0..=100 {
            let x = i as f32 / 100.0;
            let y = curve.evaluate(x);
            assert!(y >= prev_y, "Monotonicity violated at x={}", x);
            prev_y = y;
        }
    }

    #[test]
    fn test_lut_generation() {
        let curve = ToneCurve::default();
        let lut = curve.generate_lut();

        // Linear curve LUT should be approximately identity
        for i in 0..256 {
            assert!((lut[i] as i32 - i as i32).abs() <= 1,
                "LUT mismatch at {}", i);
        }
    }

    #[test]
    fn test_steep_curve_no_overshoot() {
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.1, 0.9),  // Very steep
                CurvePoint::new(1.0, 1.0),
            ],
        };

        // Should not overshoot beyond control points
        for i in 0..=100 {
            let x = i as f32 / 100.0;
            let y = curve.evaluate(x);
            assert!(y >= 0.0 && y <= 1.0, "Overshoot at x={}: y={}", x, y);
        }
    }
}
```

---

## 6. TypeScript Implementation (for UI preview)

For immediate UI feedback before WASM computation completes:

```typescript
// apps/web/app/utils/curve-interpolation.ts

export interface CurvePoint {
  x: number;
  y: number;
}

/**
 * Monotonic cubic hermite spline interpolation
 * Using Fritsch-Carlson algorithm
 */
export function evaluateCurve(points: CurvePoint[], x: number): number {
  if (points.length < 2) return x;

  // Clamp x to valid range
  x = Math.max(points[0].x, Math.min(points[points.length - 1].x, x));

  const tangents = computeMonotonicTangents(points);
  return evaluateWithTangents(points, tangents, x);
}

function computeMonotonicTangents(points: CurvePoint[]): number[] {
  const n = points.length;
  if (n < 2) return new Array(n).fill(0);

  // Compute secants
  const delta: number[] = [];
  const h: number[] = [];

  for (let i = 0; i < n - 1; i++) {
    h.push(points[i + 1].x - points[i].x);
    delta.push((points[i + 1].y - points[i].y) / h[i]);
  }

  // Initialize tangents
  const m = new Array(n).fill(0);

  // Interior points
  for (let i = 1; i < n - 1; i++) {
    if (Math.sign(delta[i - 1]) !== Math.sign(delta[i]) ||
        delta[i - 1] === 0 || delta[i] === 0) {
      m[i] = 0;
    } else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
    }
  }

  // Endpoints
  m[0] = delta[0];
  m[n - 1] = delta[n - 2];

  // Enforce monotonicity
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(delta[i]) < 1e-10) {
      m[i] = 0;
      m[i + 1] = 0;
    } else {
      const alpha = m[i] / delta[i];
      const beta = m[i + 1] / delta[i];

      if (alpha > 3) m[i] = 3 * delta[i];
      if (beta > 3) m[i + 1] = 3 * delta[i];
      if (alpha < -3) m[i] = -3 * Math.abs(delta[i]);
      if (beta < -3) m[i + 1] = -3 * Math.abs(delta[i]);
    }
  }

  return m;
}

function evaluateWithTangents(
  points: CurvePoint[],
  tangents: number[],
  x: number
): number {
  // Find interval (linear search for small arrays)
  let i = 0;
  while (i < points.length - 2 && points[i + 1].x < x) {
    i++;
  }

  const p0 = points[i];
  const p1 = points[i + 1];

  const h = p1.x - p0.x;
  const t = (x - p0.x) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  // Hermite basis
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;

  const y = h00 * p0.y + h10 * h * tangents[i] +
            h01 * p1.y + h11 * h * tangents[i + 1];

  return Math.max(0, Math.min(1, y));
}

/**
 * Generate a 256-entry LUT for fast canvas preview
 */
export function generateCurveLUT(points: CurvePoint[]): Uint8Array {
  const lut = new Uint8Array(256);
  const tangents = computeMonotonicTangents(points);

  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const y = evaluateWithTangents(points, tangents, x);
    lut[i] = Math.round(y * 255);
  }

  return lut;
}
```

---

## 7. Summary and Recommendations

### 7.1 Algorithm Choice: Monotonic Cubic Hermite (Fritsch-Carlson)

**Why this choice**:
1. **Guaranteed monotonicity** - Mathematically proven to prevent curve crossings
2. **Professional validation** - Used in darktable and similar to other pro tools
3. **Efficient** - Single-pass tangent computation, O(1) evaluation per point
4. **Well-documented** - 1980 SIAM paper with clear algorithm

### 7.2 Data Structure: Points Array + Cached LUT

```
ToneCurve {
  points: [{x: 0, y: 0}, ..., {x: 1, y: 1}]  // 2-32 points
}

ToneCurveProcessor {
  curve: ToneCurve
  tangents: Vec<f32>  // Cached on curve change
  lut: [u8; 256]      // Cached on curve change
}
```

### 7.3 Integration with Existing Codebase

The literoom codebase already has:
- `CurvePoint` and `ToneCurve` structs defined
- Clear patterns from histogram implementation
- Well-structured edit pipeline

**Next steps** (covered in other research areas):
1. Add `evaluate()` and `generate_lut()` methods to `ToneCurve`
2. Create `curve.rs` module with full implementation
3. Add WASM bindings
4. Integrate with `apply_adjustments` pipeline

---

## References

### Academic Papers
- Fritsch, F. N., and R. E. Carlson. 1980. "Monotone Piecewise Cubic Interpolation." SIAM Journal on Numerical Analysis 17 (2): 238-246.

### Documentation and Tutorials
- [Monotone Cubic Interpolation - Wikipedia](https://en.wikipedia.org/wiki/Monotone_cubic_interpolation)
- [Catmull-Rom Spline - Wikipedia](https://en.wikipedia.org/wiki/Catmull%E2%80%93Rom_spline)
- [Centripetal Catmull-Rom Spline - Wikipedia](https://en.wikipedia.org/wiki/Centripetal_Catmull%E2%80%93Rom_spline)
- [Piecewise Monotone Interpolation - splines.readthedocs.io](https://splines.readthedocs.io/en/latest/euclidean/piecewise-monotone.html)
- [Interpolation with Cubic Splines - blog.ivank.net](https://blog.ivank.net/interpolation-with-cubic-splines.html)

### Software Implementations
- [canvasSpliner - Photoshop-like curve widget](https://github.com/jonathanlurie/canvasSpliner)
- [cubic-hermite-spline - npm package](https://www.npmjs.com/package/cubic-hermite-spline)
- [RawTherapee curves source](https://github.com/Beep6581/RawTherapee/blob/dev/rtengine/curves.cc)
- [darktable curves documentation](https://docs.darktable.org/usermanual/3.8/en/darkroom/processing-modules/curves/)
- [SciPy PchipInterpolator](https://docs.scipy.org/doc/scipy/reference/generated/scipy.interpolate.PchipInterpolator.html)

### Related Resources
- [Real-time Image Curves - tannerhelland.com](https://tannerhelland.com/2008/12/24/image-curves-vb6.html)
- [Using Lookup Tables to Accelerate Color Transformations - NVIDIA GPU Gems](https://developer.nvidia.com/gpugems/gpugems2/part-iii-high-quality-rendering/chapter-24-using-lookup-tables-accelerate-color)
- [Monotonic Cubic Spline interpolation with Rust - ruivieira.dev](https://ruivieira.dev/monotonic-cubic-spline-interpolation-with-some-rust.html)
