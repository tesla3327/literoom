# Research Area 2: WASM/Rust Implementation for Tone Curve

**Date**: 2026-01-21
**Research Plan**: [Tone Curve Research Plan](./2026-01-21-tone-curve-research-plan.md)

## Objective

Determine the best approach for implementing tone curve pixel processing in Rust/WASM, including LUT generation strategy, integration with the existing `apply_adjustments` pipeline, and performance optimization for real-time preview.

---

## Key Questions Answered

### 1. How to apply a tone curve LUT to pixels efficiently in Rust?

**Recommended Approach: Pre-computed 256-entry LUT with O(1) lookup**

```rust
/// A pre-computed lookup table for tone curve application.
/// Each channel (R, G, B) can have the same LUT (composite curve)
/// or separate LUTs (per-channel curves, future feature).
pub struct ToneCurveLut {
    /// 256-entry lookup table: output[input_value] = adjusted_value
    pub lut: [u8; 256],
}

impl ToneCurveLut {
    /// Apply LUT to a single pixel (RGB).
    /// For composite curve, same LUT applies to all channels.
    #[inline]
    pub fn apply(&self, r: u8, g: u8, b: u8) -> (u8, u8, u8) {
        (self.lut[r as usize], self.lut[g as usize], self.lut[b as usize])
    }
}

/// Apply tone curve to entire image using pre-computed LUT.
pub fn apply_tone_curve(pixels: &mut [u8], lut: &ToneCurveLut) {
    for chunk in pixels.chunks_exact_mut(3) {
        chunk[0] = lut.lut[chunk[0] as usize];
        chunk[1] = lut.lut[chunk[1] as usize];
        chunk[2] = lut.lut[chunk[2] as usize];
    }
}
```

**Why LUT-based processing?**

| Approach | Time Complexity | Per-Pixel Cost | Notes |
|----------|-----------------|----------------|-------|
| Direct spline interpolation | O(n * k) | ~50-100 cycles | k = control points, spline math each pixel |
| Pre-computed LUT | O(n) | ~3 cycles | Array index lookup only |
| Hybrid (LUT + interpolation) | O(n) | ~10 cycles | For higher precision if needed |

For a 2560x1440 image (3.7M pixels), direct interpolation could take 185-370M cycles vs 11M cycles with LUT. At 3GHz, that's ~120ms vs ~4ms. **LUT is essential for real-time preview.**

---

### 2. Should we generate a 256-entry LUT from the curve for O(1) lookups?

**Yes, absolutely. This is the standard approach.**

**LUT Generation Algorithm:**

```rust
use crate::{ToneCurve, CurvePoint};

impl ToneCurveLut {
    /// Generate LUT from tone curve control points using cubic spline interpolation.
    pub fn from_curve(curve: &ToneCurve) -> Self {
        let mut lut = [0u8; 256];

        // Build spline from control points
        let spline = CatmullRomSpline::from_points(&curve.points);

        // Sample at each input level (0-255)
        for i in 0..256 {
            let input = i as f32 / 255.0;  // Normalize to 0.0-1.0
            let output = spline.evaluate(input);
            lut[i] = (output.clamp(0.0, 1.0) * 255.0).round() as u8;
        }

        ToneCurveLut { lut }
    }

    /// Generate a linear (identity) LUT.
    pub fn linear() -> Self {
        let mut lut = [0u8; 256];
        for i in 0..256 {
            lut[i] = i as u8;
        }
        ToneCurveLut { lut }
    }

    /// Check if LUT is identity (no adjustment needed).
    pub fn is_identity(&self) -> bool {
        self.lut.iter().enumerate().all(|(i, &v)| v == i as u8)
    }
}
```

**LUT Characteristics:**

| Property | Value |
|----------|-------|
| Memory size | 256 bytes |
| Generation time | ~5-10 microseconds |
| Lookup time | 1 CPU cycle per value |
| Cache efficiency | Fits in L1 cache (typically 32KB+) |

---

### 3. How to integrate with existing `apply_adjustments` pipeline? Should tone curve be separate or added?

**Recommendation: Keep tone curve SEPARATE from `apply_adjustments`**

**Rationale:**

1. **Different Application Order**: Tone curves are typically applied AFTER basic adjustments in professional tools (Lightroom applies: Exposure/Contrast first, then Tone Curve, then Saturation/Vibrance).

2. **Different Update Frequency**: Basic adjustments change frequently during editing; the tone curve is adjusted less often but requires LUT regeneration.

3. **Separate LUT Lifecycle**: The LUT should be cached and only regenerated when control points change, not on every adjustment slider move.

4. **Cleaner API**: Keeps concerns separated and makes testing easier.

**Proposed Pipeline:**

```
Input Pixels
    |
    v
apply_adjustments()  <-- Exposure, Contrast, Temperature, etc.
    |                     (per-pixel math, no LUT)
    v
apply_tone_curve()   <-- Uses pre-computed LUT
    |                     (O(1) lookup per channel)
    v
Output Pixels
```

**Integration Architecture:**

```rust
// In crates/literoom-core/src/lib.rs - add new module
pub mod tone_curve;

// In crates/literoom-core/src/tone_curve.rs
use crate::{ToneCurve, CurvePoint};

/// Lookup table for fast tone curve application.
pub struct ToneCurveLut {
    pub lut: [u8; 256],
}

/// Apply tone curve LUT to pixels in place.
pub fn apply_tone_curve(pixels: &mut [u8], lut: &ToneCurveLut) {
    for chunk in pixels.chunks_exact_mut(3) {
        chunk[0] = lut.lut[chunk[0] as usize];
        chunk[1] = lut.lut[chunk[1] as usize];
        chunk[2] = lut.lut[chunk[2] as usize];
    }
}

// In WASM bindings - crates/literoom-wasm/src/tone_curve.rs
use wasm_bindgen::prelude::*;
use crate::types::JsDecodedImage;
use literoom_core::tone_curve::{ToneCurveLut, apply_tone_curve as core_apply_tone_curve};

#[wasm_bindgen]
pub struct JsToneCurveLut {
    inner: ToneCurveLut,
}

#[wasm_bindgen]
impl JsToneCurveLut {
    /// Generate LUT from curve points.
    /// Points should be array of {x, y} objects, sorted by x.
    #[wasm_bindgen(constructor)]
    pub fn new(points: JsValue) -> Result<JsToneCurveLut, JsValue> {
        // Parse points from JS
        let points: Vec<CurvePoint> = serde_wasm_bindgen::from_value(points)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;

        let curve = ToneCurve { points };
        let lut = ToneCurveLut::from_curve(&curve);

        Ok(JsToneCurveLut { inner: lut })
    }

    /// Create identity (no-op) LUT.
    pub fn linear() -> JsToneCurveLut {
        JsToneCurveLut {
            inner: ToneCurveLut::linear(),
        }
    }

    /// Check if this LUT is identity.
    pub fn is_identity(&self) -> bool {
        self.inner.is_identity()
    }
}

/// Apply tone curve to an image.
#[wasm_bindgen]
pub fn apply_tone_curve(image: &JsDecodedImage, lut: &JsToneCurveLut) -> JsDecodedImage {
    let mut pixels = image.pixels();
    core_apply_tone_curve(&mut pixels, &lut.inner);
    JsDecodedImage::new(image.width(), image.height(), pixels)
}
```

**Alternative Considered: Combined Pipeline**

```rust
// NOT RECOMMENDED - coupling concerns
pub fn apply_all_adjustments_with_curve(
    pixels: &mut [u8],
    adjustments: &BasicAdjustments,
    curve_lut: Option<&ToneCurveLut>
) { ... }
```

This was rejected because:
- Mixes two different processing models (per-pixel math vs LUT lookup)
- Harder to skip tone curve when it's identity
- Makes testing more complex
- Prevents independent optimization

---

### 4. Performance considerations for real-time preview (target <50ms for preview resolution)

**Performance Analysis:**

For a 600px draft preview (600x400 = 240K pixels):

| Operation | Estimated Time | Notes |
|-----------|----------------|-------|
| LUT generation (once per curve change) | ~10 microseconds | Negligible, cached |
| `apply_adjustments` (existing) | ~5-15ms | Per-pixel math, 10 operations |
| `apply_tone_curve` (LUT) | ~0.5-1ms | Just array lookups |
| Total pipeline | ~6-16ms | Well under 50ms target |

For a 2560px full preview (2560x1440 = 3.7M pixels):

| Operation | Estimated Time | Notes |
|-----------|----------------|-------|
| `apply_adjustments` | ~80-200ms | Per-pixel math scales linearly |
| `apply_tone_curve` | ~10-20ms | LUT lookups scale linearly |
| Total pipeline | ~90-220ms | Under 300ms target |

**Optimization Strategies:**

1. **LUT Caching**: Generate LUT once, reuse until curve points change.

```typescript
// In TypeScript service/composable
let cachedLut: JsToneCurveLut | null = null;
let cachedPoints: string = '';

function getLut(points: CurvePoint[]): JsToneCurveLut {
  const pointsKey = JSON.stringify(points);
  if (cachedPoints !== pointsKey) {
    cachedLut = new JsToneCurveLut(points);
    cachedPoints = pointsKey;
  }
  return cachedLut!;
}
```

2. **Skip Identity Curve**: Check before processing.

```rust
pub fn apply_tone_curve(pixels: &mut [u8], lut: &ToneCurveLut) {
    // Early exit if curve is identity
    if lut.is_identity() {
        return;
    }

    for chunk in pixels.chunks_exact_mut(3) {
        chunk[0] = lut.lut[chunk[0] as usize];
        chunk[1] = lut.lut[chunk[1] as usize];
        chunk[2] = lut.lut[chunk[2] as usize];
    }
}
```

3. **SIMD Potential** (future optimization): LUT lookups can be vectorized.

```rust
// Future: Use SIMD gather instructions
// This requires nightly Rust and wasm-simd target feature
#[cfg(target_feature = "simd128")]
pub fn apply_tone_curve_simd(pixels: &mut [u8], lut: &ToneCurveLut) {
    // Use SIMD gather for parallel lookups
    // Can process 16 bytes at once
}
```

4. **Combined Pass Option** (optional optimization): If profiling shows two passes are expensive, allow combined processing.

```rust
/// Apply both adjustments and tone curve in a single pass.
/// Use when both are needed - avoids memory traffic of two passes.
pub fn apply_combined(
    pixels: &mut [u8],
    adjustments: &BasicAdjustments,
    lut: &ToneCurveLut
) {
    // Skip if both are identity
    if adjustments.is_default() && lut.is_identity() {
        return;
    }

    for chunk in pixels.chunks_exact_mut(3) {
        let mut r = chunk[0] as f32 / 255.0;
        let mut g = chunk[1] as f32 / 255.0;
        let mut b = chunk[2] as f32 / 255.0;

        // Apply adjustments first (same as apply_all_adjustments)
        // ... adjustment code ...

        // Convert back to u8
        let r_out = (r.clamp(0.0, 1.0) * 255.0) as u8;
        let g_out = (g.clamp(0.0, 1.0) * 255.0) as u8;
        let b_out = (b.clamp(0.0, 1.0) * 255.0) as u8;

        // Apply tone curve LUT
        chunk[0] = lut.lut[r_out as usize];
        chunk[1] = lut.lut[g_out as usize];
        chunk[2] = lut.lut[b_out as usize];
    }
}
```

**Recommendation**: Start with separate functions. Only implement combined pass if profiling shows memory bandwidth is the bottleneck.

---

### 5. Should the LUT be generated in Rust or TypeScript? Tradeoffs?

**Recommendation: Generate LUT in RUST**

| Factor | Rust | TypeScript |
|--------|------|------------|
| **Performance** | Faster spline math | Slower but acceptable |
| **Consistency** | Same code as processing | Separate implementation |
| **Numerical precision** | f32/f64 native | Number (f64) |
| **Testing** | Unit tests in Rust | Unit tests in Vitest |
| **Code location** | Single crate | Separate from processing |
| **Serialization overhead** | Just points across boundary | 256 bytes LUT across boundary |

**Tradeoffs Analysis:**

**Option A: Generate LUT in Rust (Recommended)**

Pros:
- Curve interpolation and LUT are co-located
- Single source of truth for curve math
- Easier to ensure consistency
- LUT stays in WASM memory, no JS↔WASM copy of 256 bytes

Cons:
- Need to pass curve points to WASM
- Curve editor preview in JS needs separate implementation

```rust
// Rust generates LUT from points
let lut = JsToneCurveLut::new(points)?; // Points passed as JsValue
let result = apply_tone_curve(&image, &lut);
```

**Option B: Generate LUT in TypeScript**

Pros:
- Can preview curve in JS without WASM call
- Curve editor updates feel more responsive
- Easier debugging in browser

Cons:
- Two implementations of spline interpolation (Rust + TS)
- Risk of inconsistency between preview and actual processing
- Need to pass 256-byte LUT array to WASM

```typescript
// TypeScript generates LUT
const lut = generateLutFromCurve(points); // Returns Uint8Array(256)
const result = applyToneCurveLut(image, lut); // Pass LUT to WASM
```

**Hybrid Approach (Best of Both):**

For the curve editor UI, implement a simple linear interpolation in TypeScript for instant preview. Use the full Rust implementation for actual image processing.

```typescript
// TypeScript - Simple linear interpolation for UI preview curve
function evaluateCurveForDisplay(points: CurvePoint[], x: number): number {
  // Find surrounding points
  const sorted = [...points].sort((a, b) => a.x - b.x);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (x >= sorted[i].x && x <= sorted[i + 1].x) {
      const t = (x - sorted[i].x) / (sorted[i + 1].x - sorted[i].x);
      return sorted[i].y + t * (sorted[i + 1].y - sorted[i].y);
    }
  }
  return x; // Identity fallback
}

// Rust - Full spline interpolation for actual processing
// Used via WASM binding
```

---

## Spline Interpolation Implementation

For the Rust LUT generation, implement Catmull-Rom spline interpolation:

```rust
// In crates/literoom-core/src/tone_curve.rs

use crate::CurvePoint;

/// Catmull-Rom spline for smooth curve interpolation.
pub struct CatmullRomSpline {
    points: Vec<CurvePoint>,
}

impl CatmullRomSpline {
    pub fn from_points(points: &[CurvePoint]) -> Self {
        let mut sorted_points = points.to_vec();
        sorted_points.sort_by(|a, b| a.x.partial_cmp(&b.x).unwrap());

        // Ensure endpoints at 0 and 1
        if sorted_points.first().map(|p| p.x) != Some(0.0) {
            sorted_points.insert(0, CurvePoint::new(0.0, 0.0));
        }
        if sorted_points.last().map(|p| p.x) != Some(1.0) {
            sorted_points.push(CurvePoint::new(1.0, 1.0));
        }

        Self { points: sorted_points }
    }

    /// Evaluate curve at input x (0.0 to 1.0).
    pub fn evaluate(&self, x: f32) -> f32 {
        let x = x.clamp(0.0, 1.0);

        // Find segment containing x
        let n = self.points.len();
        if n < 2 {
            return x; // Identity
        }

        // Find index i such that points[i].x <= x < points[i+1].x
        let mut i = 0;
        for j in 0..n - 1 {
            if self.points[j + 1].x > x {
                i = j;
                break;
            }
            i = j;
        }

        // Get four control points for Catmull-Rom
        let p0 = if i > 0 { self.points[i - 1] } else { self.points[i] };
        let p1 = self.points[i];
        let p2 = self.points[i + 1];
        let p3 = if i + 2 < n { self.points[i + 2] } else { self.points[i + 1] };

        // Parameter t for interpolation
        let t = if (p2.x - p1.x).abs() < f32::EPSILON {
            0.0
        } else {
            (x - p1.x) / (p2.x - p1.x)
        };

        // Catmull-Rom interpolation formula
        let t2 = t * t;
        let t3 = t2 * t;

        let y = 0.5 * (
            (2.0 * p1.y) +
            (-p0.y + p2.y) * t +
            (2.0 * p0.y - 5.0 * p1.y + 4.0 * p2.y - p3.y) * t2 +
            (-p0.y + 3.0 * p1.y - 3.0 * p2.y + p3.y) * t3
        );

        y.clamp(0.0, 1.0)
    }
}

/// Generate a 256-entry LUT from a tone curve.
pub fn generate_lut(curve: &crate::ToneCurve) -> [u8; 256] {
    let mut lut = [0u8; 256];

    // Check for identity curve (fast path)
    if curve.is_linear() {
        for i in 0..256 {
            lut[i] = i as u8;
        }
        return lut;
    }

    let spline = CatmullRomSpline::from_points(&curve.points);

    for i in 0..256 {
        let input = i as f32 / 255.0;
        let output = spline.evaluate(input);
        lut[i] = (output * 255.0).round() as u8;
    }

    lut
}
```

---

## Complete Implementation Specification

### File Structure

```
crates/
  literoom-core/
    src/
      lib.rs           # Add: pub mod tone_curve;
      tone_curve.rs    # NEW: LUT type, spline, generate_lut, apply_tone_curve
  literoom-wasm/
    src/
      lib.rs           # Add: pub use tone_curve::*;
      tone_curve.rs    # NEW: WASM bindings for JsToneCurveLut, apply_tone_curve
```

### Core Module: `crates/literoom-core/src/tone_curve.rs`

```rust
//! Tone curve processing with LUT-based optimization.
//!
//! This module provides efficient tone curve application using
//! pre-computed lookup tables (LUTs) for O(1) per-pixel processing.

use crate::{CurvePoint, ToneCurve};

/// Pre-computed lookup table for tone curve.
#[derive(Debug, Clone)]
pub struct ToneCurveLut {
    /// 256-entry LUT: lut[input] = output
    pub lut: [u8; 256],
}

impl ToneCurveLut {
    /// Create a new LUT from a tone curve.
    pub fn from_curve(curve: &ToneCurve) -> Self {
        Self {
            lut: generate_lut(curve),
        }
    }

    /// Create an identity (no-op) LUT.
    pub fn identity() -> Self {
        let mut lut = [0u8; 256];
        for i in 0..256 {
            lut[i] = i as u8;
        }
        Self { lut }
    }

    /// Check if this LUT is identity (no adjustment).
    pub fn is_identity(&self) -> bool {
        self.lut.iter().enumerate().all(|(i, &v)| v == i as u8)
    }
}

impl Default for ToneCurveLut {
    fn default() -> Self {
        Self::identity()
    }
}

/// Apply tone curve to image pixels using pre-computed LUT.
///
/// # Arguments
/// * `pixels` - RGB pixel data (3 bytes per pixel, modified in place)
/// * `lut` - Pre-computed lookup table
///
/// # Performance
/// O(n) where n is number of pixels. Each pixel requires 3 array lookups.
pub fn apply_tone_curve(pixels: &mut [u8], lut: &ToneCurveLut) {
    // Early exit for identity curve
    if lut.is_identity() {
        return;
    }

    for chunk in pixels.chunks_exact_mut(3) {
        chunk[0] = lut.lut[chunk[0] as usize];
        chunk[1] = lut.lut[chunk[1] as usize];
        chunk[2] = lut.lut[chunk[2] as usize];
    }
}

// ... spline implementation from above ...
```

### WASM Module: `crates/literoom-wasm/src/tone_curve.rs`

```rust
//! WASM bindings for tone curve processing.

use crate::types::JsDecodedImage;
use literoom_core::tone_curve::{apply_tone_curve as core_apply, ToneCurveLut};
use literoom_core::{CurvePoint, ToneCurve};
use wasm_bindgen::prelude::*;

/// JavaScript-accessible tone curve LUT.
#[wasm_bindgen]
pub struct JsToneCurveLut {
    inner: ToneCurveLut,
}

#[wasm_bindgen]
impl JsToneCurveLut {
    /// Create a LUT from curve control points.
    ///
    /// # Arguments
    /// * `points` - Array of {x: number, y: number} objects
    ///
    /// # Example (TypeScript)
    /// ```typescript
    /// const lut = new JsToneCurveLut([
    ///   { x: 0, y: 0 },
    ///   { x: 0.5, y: 0.6 },  // Brighten midtones
    ///   { x: 1, y: 1 }
    /// ]);
    /// ```
    #[wasm_bindgen(constructor)]
    pub fn new(points: JsValue) -> Result<JsToneCurveLut, JsValue> {
        let points: Vec<CurvePoint> = serde_wasm_bindgen::from_value(points)
            .map_err(|e| JsValue::from_str(&format!("Invalid curve points: {}", e)))?;

        let curve = ToneCurve { points };
        let inner = ToneCurveLut::from_curve(&curve);

        Ok(JsToneCurveLut { inner })
    }

    /// Create an identity (no-op) LUT.
    pub fn identity() -> JsToneCurveLut {
        JsToneCurveLut {
            inner: ToneCurveLut::identity(),
        }
    }

    /// Check if this LUT produces no change.
    pub fn is_identity(&self) -> bool {
        self.inner.is_identity()
    }

    /// Get the raw LUT data (256 bytes).
    /// Useful for debugging or visualization.
    pub fn get_lut(&self) -> Vec<u8> {
        self.inner.lut.to_vec()
    }
}

/// Apply tone curve to an image.
///
/// # Arguments
/// * `image` - Source image
/// * `lut` - Pre-computed tone curve LUT
///
/// # Returns
/// New image with tone curve applied.
#[wasm_bindgen]
pub fn apply_tone_curve(image: &JsDecodedImage, lut: &JsToneCurveLut) -> JsDecodedImage {
    let mut pixels = image.pixels();
    core_apply(&mut pixels, &lut.inner);
    JsDecodedImage::new(image.width(), image.height(), pixels)
}
```

---

## TypeScript Integration

### Worker Message Types

```typescript
// packages/core/src/decode/worker-messages.ts

export interface ApplyToneCurveRequest {
  type: 'apply-tone-curve';
  id: string;
  pixels: Uint8Array;
  width: number;
  height: number;
  points: Array<{ x: number; y: number }>;
}

export interface ApplyToneCurveResponse {
  type: 'apply-tone-curve-result';
  id: string;
  pixels: Uint8Array;
  width: number;
  height: number;
}
```

### Decode Service Extension

```typescript
// packages/core/src/decode/decode-service.ts

interface CurvePoint {
  x: number;
  y: number;
}

async applyToneCurve(
  pixels: Uint8Array,
  width: number,
  height: number,
  points: CurvePoint[]
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.pendingRequests.delete(id);
      reject(new Error('Tone curve application timed out'));
    }, 30000);

    this.pendingRequests.set(id, { resolve, reject, timeout });

    this.worker.postMessage({
      type: 'apply-tone-curve',
      id,
      pixels,
      width,
      height,
      points,
    }, [pixels.buffer]);
  });
}
```

---

## Testing Strategy

### Unit Tests (Rust)

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_lut() {
        let lut = ToneCurveLut::identity();
        assert!(lut.is_identity());

        for i in 0..256 {
            assert_eq!(lut.lut[i], i as u8);
        }
    }

    #[test]
    fn test_linear_curve_produces_identity() {
        let curve = ToneCurve::default(); // [(0,0), (1,1)]
        let lut = ToneCurveLut::from_curve(&curve);
        assert!(lut.is_identity());
    }

    #[test]
    fn test_s_curve_increases_contrast() {
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.25, 0.15),  // Darken shadows
                CurvePoint::new(0.75, 0.85),  // Brighten highlights
                CurvePoint::new(1.0, 1.0),
            ],
        };
        let lut = ToneCurveLut::from_curve(&curve);

        // Shadows should be darker
        assert!(lut.lut[64] < 64);
        // Highlights should be brighter
        assert!(lut.lut[192] > 192);
    }

    #[test]
    fn test_apply_tone_curve_preserves_image_size() {
        let mut pixels = vec![128u8; 300]; // 100 pixels
        let lut = ToneCurveLut::identity();

        apply_tone_curve(&mut pixels, &lut);

        assert_eq!(pixels.len(), 300);
    }

    #[test]
    fn test_apply_tone_curve_identity_unchanged() {
        let original = vec![0, 64, 128, 192, 255, 100];
        let mut pixels = original.clone();
        let lut = ToneCurveLut::identity();

        apply_tone_curve(&mut pixels, &lut);

        assert_eq!(pixels, original);
    }
}
```

### Performance Benchmarks

```rust
#[cfg(test)]
mod benchmarks {
    use super::*;
    use std::time::Instant;

    #[test]
    fn bench_lut_generation() {
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.25, 0.2),
                CurvePoint::new(0.5, 0.55),
                CurvePoint::new(0.75, 0.8),
                CurvePoint::new(1.0, 1.0),
            ],
        };

        let start = Instant::now();
        for _ in 0..1000 {
            let _ = ToneCurveLut::from_curve(&curve);
        }
        let elapsed = start.elapsed();

        println!("LUT generation: {:?} per call", elapsed / 1000);
        assert!(elapsed.as_micros() < 100_000); // <100ms for 1000 calls
    }

    #[test]
    fn bench_tone_curve_application() {
        // 2560x1440 image
        let mut pixels = vec![128u8; 2560 * 1440 * 3];
        let lut = ToneCurveLut::from_curve(&ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.5, 0.6),
                CurvePoint::new(1.0, 1.0),
            ],
        });

        let start = Instant::now();
        apply_tone_curve(&mut pixels, &lut);
        let elapsed = start.elapsed();

        println!("Tone curve application (2560x1440): {:?}", elapsed);
        assert!(elapsed.as_millis() < 50); // <50ms for full resolution
    }
}
```

---

## Summary

| Question | Recommendation |
|----------|----------------|
| LUT or direct calculation? | **256-entry LUT** for O(1) lookups |
| Generate LUT where? | **Rust** for consistency and performance |
| Integrate with apply_adjustments? | **Separate function** for cleaner architecture |
| Performance target achievable? | **Yes** - LUT adds ~1ms for draft, ~15ms for full |
| Caching strategy | Cache LUT until curve points change |

### Implementation Order

1. Add `tone_curve.rs` to `literoom-core` with LUT type and spline
2. Add WASM bindings in `literoom-wasm`
3. Extend worker message types
4. Add service method
5. Integrate with edit preview composable

### Key Performance Characteristics

- LUT generation: ~10 microseconds
- Tone curve application: ~0.5ms (600px) to ~15ms (2560px)
- Memory overhead: 256 bytes per LUT
- Total pipeline impact: <5% additional time on top of existing adjustments
