# Phase 11: Tone Curve - Implementation Plan

**Date**: 2026-01-21
**Status**: Ready for Implementation
**Research**: [Tone Curve Synthesis](../research/2026-01-21-tone-curve-synthesis.md)

---

## Overview

Phase 11 implements the tone curve feature for the photo editing view. The tone curve allows users to create custom brightness/contrast mappings by placing and dragging control points on a curve.

**Goal**: Users can add control points to a tone curve, drag them to reshape the curve, and see real-time preview updates as the curve modifies the image tonality.

---

## Implementation Phases

### Phase 11.1: Rust Curve Module

**Goal**: Implement curve interpolation and LUT generation in Rust.

#### 11.1.1 Create `crates/literoom-core/src/curve.rs`

```rust
//! Tone curve interpolation and LUT generation using monotonic cubic hermite splines.

use crate::{CurvePoint, ToneCurve};

// ============================================================================
// LUT Type
// ============================================================================

/// Pre-computed 256-entry lookup table for efficient curve application.
#[derive(Debug, Clone)]
pub struct ToneCurveLut {
    /// LUT values: lut[input] = output
    pub lut: [u8; 256],
}

impl ToneCurveLut {
    /// Generate LUT from a tone curve.
    pub fn from_curve(curve: &ToneCurve) -> Self {
        // Fast path for linear curve
        if curve.is_linear() {
            return Self::identity();
        }

        let tangents = compute_monotonic_tangents(&curve.points);
        let mut lut = [0u8; 256];

        for i in 0..256 {
            let x = i as f32 / 255.0;
            let y = evaluate_with_tangents(&curve.points, &tangents, x);
            lut[i] = (y * 255.0).clamp(0.0, 255.0).round() as u8;
        }

        Self { lut }
    }

    /// Create identity LUT (no change).
    pub fn identity() -> Self {
        let mut lut = [0u8; 256];
        for i in 0..256 {
            lut[i] = i as u8;
        }
        Self { lut }
    }

    /// Check if this LUT is identity.
    pub fn is_identity(&self) -> bool {
        self.lut.iter().enumerate().all(|(i, &v)| v == i as u8)
    }
}

impl Default for ToneCurveLut {
    fn default() -> Self {
        Self::identity()
    }
}

// ============================================================================
// Curve Application
// ============================================================================

/// Apply tone curve LUT to RGB pixels in place.
///
/// # Arguments
/// * `pixels` - RGB pixel data (3 bytes per pixel)
/// * `lut` - Pre-computed lookup table
pub fn apply_tone_curve(pixels: &mut [u8], lut: &ToneCurveLut) {
    // Early exit for identity
    if lut.is_identity() {
        return;
    }

    for chunk in pixels.chunks_exact_mut(3) {
        chunk[0] = lut.lut[chunk[0] as usize];
        chunk[1] = lut.lut[chunk[1] as usize];
        chunk[2] = lut.lut[chunk[2] as usize];
    }
}

// ============================================================================
// Monotonic Cubic Hermite Spline (Fritsch-Carlson)
// ============================================================================

/// Compute monotonic tangents using Fritsch-Carlson algorithm.
fn compute_monotonic_tangents(points: &[CurvePoint]) -> Vec<f32> {
    let n = points.len();
    if n < 2 {
        return vec![0.0; n];
    }

    // Compute secants
    let mut h: Vec<f32> = Vec::with_capacity(n - 1);
    let mut delta: Vec<f32> = Vec::with_capacity(n - 1);

    for i in 0..n - 1 {
        h.push(points[i + 1].x - points[i].x);
        delta.push(if h[i].abs() < f32::EPSILON {
            0.0
        } else {
            (points[i + 1].y - points[i].y) / h[i]
        });
    }

    // Initialize tangents
    let mut m: Vec<f32> = vec![0.0; n];

    // Interior points: weighted harmonic mean
    for i in 1..n - 1 {
        if delta[i - 1].signum() != delta[i].signum()
            || delta[i - 1].abs() < f32::EPSILON
            || delta[i].abs() < f32::EPSILON
        {
            m[i] = 0.0;
        } else {
            let w1 = 2.0 * h[i] + h[i - 1];
            let w2 = h[i] + 2.0 * h[i - 1];
            m[i] = (w1 + w2) / (w1 / delta[i - 1] + w2 / delta[i]);
        }
    }

    // Endpoint tangents
    m[0] = delta[0];
    m[n - 1] = delta[n - 2];

    // Enforce monotonicity constraints
    for i in 0..n - 1 {
        if delta[i].abs() < f32::EPSILON {
            m[i] = 0.0;
            m[i + 1] = 0.0;
        } else {
            let alpha = m[i] / delta[i];
            let beta = m[i + 1] / delta[i];

            if alpha > 3.0 {
                m[i] = 3.0 * delta[i];
            }
            if beta > 3.0 {
                m[i + 1] = 3.0 * delta[i];
            }
            if alpha < -3.0 {
                m[i] = -3.0 * delta[i].abs();
            }
            if beta < -3.0 {
                m[i + 1] = -3.0 * delta[i].abs();
            }
        }
    }

    m
}

/// Evaluate curve at x with pre-computed tangents.
fn evaluate_with_tangents(points: &[CurvePoint], tangents: &[f32], x: f32) -> f32 {
    let n = points.len();

    if n == 0 {
        return x;
    }
    if n == 1 {
        return points[0].y;
    }

    // Clamp to valid range
    let x = x.clamp(points[0].x, points[n - 1].x);

    // Find interval
    let i = find_interval(points, x);

    let p0 = &points[i];
    let p1 = &points[i + 1];

    let h = p1.x - p0.x;
    if h.abs() < f32::EPSILON {
        return p0.y;
    }

    let t = (x - p0.x) / h;
    let t2 = t * t;
    let t3 = t2 * t;

    // Hermite basis functions
    let h00 = 2.0 * t3 - 3.0 * t2 + 1.0;
    let h10 = t3 - 2.0 * t2 + t;
    let h01 = -2.0 * t3 + 3.0 * t2;
    let h11 = t3 - t2;

    let y = h00 * p0.y + h10 * h * tangents[i] + h01 * p1.y + h11 * h * tangents[i + 1];

    y.clamp(0.0, 1.0)
}

/// Binary search for interval containing x.
fn find_interval(points: &[CurvePoint], x: f32) -> usize {
    let n = points.len();
    if n <= 2 {
        return 0;
    }

    let mut low = 0;
    let mut high = n - 2;

    while low < high {
        let mid = (low + high + 1) / 2;
        if points[mid].x <= x {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    low
}

// ============================================================================
// Public Curve Evaluation (for UI preview)
// ============================================================================

/// Evaluate tone curve at a given x value.
/// Used for drawing the curve in the UI.
pub fn evaluate_curve(curve: &ToneCurve, x: f32) -> f32 {
    let tangents = compute_monotonic_tangents(&curve.points);
    evaluate_with_tangents(&curve.points, &tangents, x)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    fn linear_curve() -> ToneCurve {
        ToneCurve::default()
    }

    fn s_curve() -> ToneCurve {
        ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.25, 0.15),
                CurvePoint::new(0.75, 0.85),
                CurvePoint::new(1.0, 1.0),
            ],
        }
    }

    #[test]
    fn test_identity_lut() {
        let lut = ToneCurveLut::identity();
        assert!(lut.is_identity());
        for i in 0..256 {
            assert_eq!(lut.lut[i], i as u8);
        }
    }

    #[test]
    fn test_linear_curve_produces_identity_lut() {
        let curve = linear_curve();
        let lut = ToneCurveLut::from_curve(&curve);
        // Should be very close to identity (allow +/- 1 for rounding)
        for i in 0..256 {
            assert!(
                (lut.lut[i] as i32 - i as i32).abs() <= 1,
                "LUT mismatch at {}: got {}",
                i,
                lut.lut[i]
            );
        }
    }

    #[test]
    fn test_s_curve_increases_contrast() {
        let curve = s_curve();
        let lut = ToneCurveLut::from_curve(&curve);

        // Shadows should be darker
        assert!(lut.lut[64] < 64, "Shadows not darkened");
        // Highlights should be brighter
        assert!(lut.lut[192] > 192, "Highlights not brightened");
    }

    #[test]
    fn test_monotonicity() {
        let curve = s_curve();

        // Verify curve never decreases
        let mut prev_y = -1.0;
        for i in 0..=100 {
            let x = i as f32 / 100.0;
            let y = evaluate_curve(&curve, x);
            assert!(
                y >= prev_y - f32::EPSILON,
                "Monotonicity violated at x={}: y={} < prev_y={}",
                x,
                y,
                prev_y
            );
            prev_y = y;
        }
    }

    #[test]
    fn test_endpoints_preserved() {
        let curve = s_curve();
        let y_0 = evaluate_curve(&curve, 0.0);
        let y_1 = evaluate_curve(&curve, 1.0);

        assert!((y_0 - 0.0).abs() < 0.01, "Start point not preserved");
        assert!((y_1 - 1.0).abs() < 0.01, "End point not preserved");
    }

    #[test]
    fn test_apply_tone_curve_identity() {
        let original = vec![0, 64, 128, 192, 255, 100];
        let mut pixels = original.clone();
        let lut = ToneCurveLut::identity();

        apply_tone_curve(&mut pixels, &lut);

        assert_eq!(pixels, original);
    }

    #[test]
    fn test_apply_tone_curve_modifies() {
        let mut pixels = vec![64, 64, 64, 192, 192, 192];
        let curve = s_curve();
        let lut = ToneCurveLut::from_curve(&curve);

        apply_tone_curve(&mut pixels, &lut);

        // Verify pixels were modified
        assert!(pixels[0] < 64, "Dark pixel not darkened");
        assert!(pixels[3] > 192, "Bright pixel not brightened");
    }

    #[test]
    fn test_steep_curve_no_overshoot() {
        let curve = ToneCurve {
            points: vec![
                CurvePoint::new(0.0, 0.0),
                CurvePoint::new(0.1, 0.9),
                CurvePoint::new(1.0, 1.0),
            ],
        };

        for i in 0..=100 {
            let x = i as f32 / 100.0;
            let y = evaluate_curve(&curve, x);
            assert!(
                y >= 0.0 && y <= 1.0,
                "Overshoot at x={}: y={}",
                x,
                y
            );
        }
    }
}
```

#### 11.1.2 Update `crates/literoom-core/src/lib.rs`

Add module export:

```rust
pub mod curve;
pub use curve::{apply_tone_curve, evaluate_curve, ToneCurveLut};
```

#### 11.1.3 Verification

- [ ] `cargo test -p literoom-core` passes (new curve tests)
- [ ] `cargo clippy -p literoom-core` has no warnings
- [ ] `cargo fmt --check` passes

---

### Phase 11.2: WASM Bindings

**Goal**: Expose curve functions to JavaScript via WASM.

#### 11.2.1 Create `crates/literoom-wasm/src/curve.rs`

```rust
//! WASM bindings for tone curve processing.

use crate::types::JsDecodedImage;
use literoom_core::curve::{apply_tone_curve as core_apply, ToneCurveLut};
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
    #[wasm_bindgen(constructor)]
    pub fn new(points: JsValue) -> Result<JsToneCurveLut, JsValue> {
        let points: Vec<CurvePointJs> = serde_wasm_bindgen::from_value(points)
            .map_err(|e| JsValue::from_str(&format!("Invalid curve points: {}", e)))?;

        let core_points: Vec<CurvePoint> = points
            .into_iter()
            .map(|p| CurvePoint::new(p.x, p.y))
            .collect();

        let curve = ToneCurve { points: core_points };
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

    /// Get raw LUT data (256 bytes) for debugging.
    pub fn get_lut(&self) -> Vec<u8> {
        self.inner.lut.to_vec()
    }
}

/// Apply tone curve to an image.
#[wasm_bindgen]
pub fn apply_tone_curve(image: &JsDecodedImage, lut: &JsToneCurveLut) -> JsDecodedImage {
    let mut pixels = image.pixels();
    core_apply(&mut pixels, &lut.inner);
    JsDecodedImage::new(image.width(), image.height(), pixels)
}

// Helper struct for deserializing JS curve points
#[derive(serde::Deserialize)]
struct CurvePointJs {
    x: f32,
    y: f32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_identity_lut() {
        let lut = JsToneCurveLut::identity();
        assert!(lut.is_identity());
    }

    #[test]
    fn test_lut_data_length() {
        let lut = JsToneCurveLut::identity();
        assert_eq!(lut.get_lut().len(), 256);
    }
}
```

#### 11.2.2 Update `crates/literoom-wasm/src/lib.rs`

Add module and exports:

```rust
mod curve;

pub use curve::{apply_tone_curve, JsToneCurveLut};
```

#### 11.2.3 Build WASM

```bash
pnpm wasm:build
```

#### 11.2.4 Verification

- [ ] WASM builds without errors
- [ ] TypeScript types include `JsToneCurveLut` class
- [ ] TypeScript types include `apply_tone_curve` function
- [ ] `cargo test -p literoom-wasm` passes

---

### Phase 11.3: TypeScript Types and Worker Messages

**Goal**: Add curve types and worker message definitions.

#### 11.3.1 Update `packages/core/src/decode/types.ts`

Add curve types:

```typescript
/**
 * A control point on the tone curve.
 */
export interface CurvePoint {
  /** Input value (0-1): 0 = shadows, 1 = highlights */
  x: number
  /** Output value (0-1): 0 = black, 1 = white */
  y: number
}

/**
 * Tone curve with control points.
 */
export interface ToneCurve {
  /** Control points, sorted by x coordinate */
  points: CurvePoint[]
}

/**
 * Default tone curve (linear, no adjustment).
 */
export const DEFAULT_TONE_CURVE: Readonly<ToneCurve> = Object.freeze({
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 },
  ],
})
```

#### 11.3.2 Update `packages/core/src/decode/worker-messages.ts`

Add message types:

```typescript
/**
 * Request to apply tone curve to pixels.
 */
export interface ApplyToneCurveRequest {
  type: 'apply-tone-curve'
  id: string
  pixels: Uint8Array
  width: number
  height: number
  points: Array<{ x: number; y: number }>
}

/**
 * Tone curve application result.
 */
export interface ToneCurveResponse {
  type: 'tone-curve-result'
  id: string
  pixels: Uint8Array
  width: number
  height: number
}

// Update DecodeRequest union
export type DecodeRequest =
  | DecodeJpegRequest
  | DecodeRawThumbnailRequest
  | GenerateThumbnailRequest
  | GeneratePreviewRequest
  | DetectFileTypeRequest
  | ApplyAdjustmentsRequest
  | ComputeHistogramRequest
  | ApplyToneCurveRequest  // ADD

// Update DecodeResponse union
export type DecodeResponse =
  | DecodeSuccessResponse
  | FileTypeResponse
  | HistogramResponse
  | ToneCurveResponse  // ADD
  | DecodeErrorResponse
```

#### 11.3.3 Update `packages/core/src/decode/index.ts`

Export new types:

```typescript
export type { CurvePoint, ToneCurve } from './types'
export { DEFAULT_TONE_CURVE } from './types'
export type { ApplyToneCurveRequest, ToneCurveResponse } from './worker-messages'
```

#### 11.3.4 Verification

- [ ] TypeScript compiles without errors
- [ ] New types are exported from package

---

### Phase 11.4: Worker Handler and Service Method

**Goal**: Implement worker message handling and service method.

#### 11.4.1 Update `packages/core/src/decode/decode-worker.ts`

Add handler case:

```typescript
case 'apply-tone-curve': {
  const { pixels, width, height, points } = request

  // Create LUT from points
  const lut = new wasm.JsToneCurveLut(points)

  // Create image wrapper
  const image = new wasm.JsDecodedImage(width, height, pixels)

  // Apply curve
  const result = wasm.apply_tone_curve(image, lut)

  // Extract result
  const outputPixels = result.pixels()
  const outputWidth = result.width()
  const outputHeight = result.height()

  // Free WASM memory
  lut.free()
  image.free()
  result.free()

  const response: ToneCurveResponse = {
    id: request.id,
    type: 'tone-curve-result',
    pixels: outputPixels,
    width: outputWidth,
    height: outputHeight,
  }

  self.postMessage(response, [outputPixels.buffer])
  break
}
```

#### 11.4.2 Update `packages/core/src/decode/decode-service.ts`

Add interface method:

```typescript
// In IDecodeService interface
applyToneCurve(
  pixels: Uint8Array,
  width: number,
  height: number,
  points: Array<{ x: number; y: number }>,
): Promise<{ pixels: Uint8Array; width: number; height: number }>

// In DecodeService class
async applyToneCurve(
  pixels: Uint8Array,
  width: number,
  height: number,
  points: Array<{ x: number; y: number }>,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const request: ApplyToneCurveRequest = {
    id: crypto.randomUUID(),
    type: 'apply-tone-curve',
    pixels,
    width,
    height,
    points,
  }
  return this.sendRequest(request)
}
```

#### 11.4.3 Update `packages/core/src/decode/mock-decode-service.ts`

Add mock implementation:

```typescript
async applyToneCurve(
  pixels: Uint8Array,
  width: number,
  height: number,
  points: Array<{ x: number; y: number }>,
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  await this.delay(this.options.thumbnailDelay ?? 10)

  // For mock, just return the pixels unchanged
  // Real implementation applies LUT
  return {
    pixels: new Uint8Array(pixels),
    width,
    height,
  }
}
```

#### 11.4.4 Verification

- [ ] Worker handles apply-tone-curve messages
- [ ] Service method compiles
- [ ] Mock service provides reasonable mock data

---

### Phase 11.5: Edit Store Extensions

**Goal**: Add curve state management to the edit store.

#### 11.5.1 Update `packages/core/src/catalog/types.ts`

Extend Adjustments interface and bump schema version:

```typescript
export const EDIT_SCHEMA_VERSION = 2

export interface Adjustments {
  // ... existing fields ...
  temperature: number
  tint: number
  exposure: number
  contrast: number
  highlights: number
  shadows: number
  whites: number
  blacks: number
  vibrance: number
  saturation: number

  /** Tone curve control points */
  toneCurve: ToneCurve
}

export const DEFAULT_ADJUSTMENTS: Readonly<Adjustments> = Object.freeze({
  // ... existing defaults ...
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
  toneCurve: DEFAULT_TONE_CURVE,
})
```

#### 11.5.2 Update `apps/web/app/stores/edit.ts`

Add curve methods:

```typescript
/**
 * Set the complete tone curve.
 */
function setToneCurve(curve: ToneCurve): void {
  adjustments.value = {
    ...adjustments.value,
    toneCurve: { points: [...curve.points] },
  }
  isDirty.value = true
  error.value = null
}

/**
 * Add a control point to the curve.
 */
function addCurvePoint(point: CurvePoint): void {
  const newPoints = [...adjustments.value.toneCurve.points, point]
    .sort((a, b) => a.x - b.x)
  setToneCurve({ points: newPoints })
}

/**
 * Update a control point by index.
 */
function updateCurvePoint(index: number, point: CurvePoint): void {
  const newPoints = [...adjustments.value.toneCurve.points]
  newPoints[index] = point
  newPoints.sort((a, b) => a.x - b.x)
  setToneCurve({ points: newPoints })
}

/**
 * Delete a control point by index.
 * Cannot delete anchor points (first and last).
 */
function deleteCurvePoint(index: number): void {
  const points = adjustments.value.toneCurve.points
  if (index === 0 || index === points.length - 1) return
  if (points.length <= 2) return

  const newPoints = points.filter((_, i) => i !== index)
  setToneCurve({ points: newPoints })
}

/**
 * Reset only the tone curve to linear.
 */
function resetToneCurve(): void {
  setToneCurve(DEFAULT_TONE_CURVE)
}

// Export in return statement
return {
  // ... existing exports ...
  setToneCurve,
  addCurvePoint,
  updateCurvePoint,
  deleteCurvePoint,
  resetToneCurve,
}
```

#### 11.5.3 Verification

- [ ] Store compiles
- [ ] Curve methods work correctly
- [ ] Default adjustments include toneCurve

---

### Phase 11.6: useToneCurve Composable

**Goal**: Create composable for interactive curve editing.

#### 11.6.1 Create `apps/web/app/composables/useToneCurve.ts`

```typescript
/**
 * useToneCurve Composable
 *
 * Manages tone curve interaction and rendering:
 * - Canvas rendering with curve visualization
 * - Control point drag interactions
 * - Point add/delete operations
 * - Coordinate conversions
 * - Debounced store updates
 */

import type { Ref } from 'vue'
import type { ToneCurve, CurvePoint, HistogramData } from '@literoom/core/decode'

// Constants
const CANVAS_SIZE = 256
const POINT_RADIUS = 6
const POINT_HIT_RADIUS = 14

const COLORS = {
  background: '#1a1a1a',
  grid: '#2a2a2a',
  gridMajor: '#333',
  diagonal: '#404040',
  curve: '#ffffff',
  point: '#ffffff',
  pointHover: '#3b82f6',
  pointDrag: '#60a5fa',
}

export interface UseToneCurveOptions {
  histogram?: Ref<HistogramData | null>
}

export function useToneCurve(options: UseToneCurveOptions = {}) {
  const editStore = useEditStore()
  const { histogram } = options

  // State
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const localCurve = ref<ToneCurve>({
    points: [...editStore.adjustments.toneCurve.points],
  })
  const draggedPointIndex = ref<number | null>(null)
  const hoveredPointIndex = ref<number | null>(null)

  const isDragging = computed(() => draggedPointIndex.value !== null)

  // Coordinate conversion
  function toCanvas(point: CurvePoint): { x: number; y: number } {
    return {
      x: point.x * CANVAS_SIZE,
      y: (1 - point.y) * CANVAS_SIZE,
    }
  }

  function toNormalized(canvasX: number, canvasY: number): CurvePoint {
    return {
      x: Math.max(0, Math.min(1, canvasX / CANVAS_SIZE)),
      y: Math.max(0, Math.min(1, 1 - canvasY / CANVAS_SIZE)),
    }
  }

  function findPointAt(canvasX: number, canvasY: number): number | null {
    for (let i = 0; i < localCurve.value.points.length; i++) {
      const p = toCanvas(localCurve.value.points[i])
      const dist = Math.sqrt((canvasX - p.x) ** 2 + (canvasY - p.y) ** 2)
      if (dist <= POINT_HIT_RADIUS) return i
    }
    return null
  }

  // Rendering
  function render(): void {
    const canvas = canvasRef.value
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Clear
    ctx.fillStyle = COLORS.background
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE)

    // Histogram background
    if (histogram?.value) {
      drawHistogram(ctx, histogram.value)
    }

    // Grid
    drawGrid(ctx)

    // Diagonal reference
    drawDiagonal(ctx)

    // Curve
    drawCurve(ctx)

    // Points
    drawPoints(ctx)
  }

  function drawHistogram(ctx: CanvasRenderingContext2D, hist: HistogramData): void {
    const max = hist.maxValue || 1
    if (max === 0) return

    ctx.globalAlpha = 0.15
    ctx.fillStyle = '#666'

    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * CANVAS_SIZE
      const avg = (hist.red[i] + hist.green[i] + hist.blue[i]) / 3
      const h = (avg / max) * CANVAS_SIZE
      ctx.fillRect(x, CANVAS_SIZE - h, 2, h)
    }

    ctx.globalAlpha = 1
  }

  function drawGrid(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1

    for (let i = 1; i < 4; i++) {
      const pos = (i / 4) * CANVAS_SIZE
      ctx.beginPath()
      ctx.moveTo(pos, 0)
      ctx.lineTo(pos, CANVAS_SIZE)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, pos)
      ctx.lineTo(CANVAS_SIZE, pos)
      ctx.stroke()
    }

    // Center lines
    ctx.strokeStyle = COLORS.gridMajor
    const mid = CANVAS_SIZE / 2
    ctx.beginPath()
    ctx.moveTo(mid, 0)
    ctx.lineTo(mid, CANVAS_SIZE)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(0, mid)
    ctx.lineTo(CANVAS_SIZE, mid)
    ctx.stroke()
  }

  function drawDiagonal(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLORS.diagonal
    ctx.lineWidth = 1
    ctx.setLineDash([4, 4])
    ctx.beginPath()
    ctx.moveTo(0, CANVAS_SIZE)
    ctx.lineTo(CANVAS_SIZE, 0)
    ctx.stroke()
    ctx.setLineDash([])
  }

  function drawCurve(ctx: CanvasRenderingContext2D): void {
    ctx.strokeStyle = COLORS.curve
    ctx.lineWidth = 2
    ctx.beginPath()

    // Sample curve at 256 points
    for (let i = 0; i <= 256; i++) {
      const x = i / 256
      const y = evaluateCurve(x)
      const canvasX = x * CANVAS_SIZE
      const canvasY = (1 - y) * CANVAS_SIZE

      if (i === 0) ctx.moveTo(canvasX, canvasY)
      else ctx.lineTo(canvasX, canvasY)
    }

    ctx.stroke()
  }

  function drawPoints(ctx: CanvasRenderingContext2D): void {
    localCurve.value.points.forEach((point, i) => {
      const p = toCanvas(point)

      let color = COLORS.point
      if (draggedPointIndex.value === i) color = COLORS.pointDrag
      else if (hoveredPointIndex.value === i) color = COLORS.pointHover

      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(p.x, p.y, POINT_RADIUS, 0, Math.PI * 2)
      ctx.fill()

      ctx.strokeStyle = '#000'
      ctx.lineWidth = 1
      ctx.stroke()
    })
  }

  // Curve interpolation (simplified for UI)
  function evaluateCurve(x: number): number {
    const points = localCurve.value.points
    if (points.length < 2) return x

    // Find segment
    let i = 0
    while (i < points.length - 1 && points[i + 1].x < x) i++

    const p0 = points[i]
    const p1 = points[i + 1] || points[i]

    if (p1.x === p0.x) return p0.y

    const t = (x - p0.x) / (p1.x - p0.x)
    return p0.y + t * (p1.y - p0.y) // Linear interpolation for UI
  }

  // Debounce utility
  function debounce<T extends (...args: any[]) => void>(fn: T, delay: number) {
    let timer: ReturnType<typeof setTimeout> | null = null
    const debounced = (...args: Parameters<T>) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => fn(...args), delay)
    }
    debounced.cancel = () => {
      if (timer) clearTimeout(timer)
    }
    return debounced
  }

  const debouncedStoreUpdate = debounce(() => {
    editStore.setToneCurve(localCurve.value)
  }, 16)

  // Event handlers
  function getCanvasCoords(e: MouseEvent): { x: number; y: number } | null {
    const canvas = canvasRef.value
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    }
  }

  function handleMouseDown(e: MouseEvent): void {
    const coords = getCanvasCoords(e)
    if (!coords) return

    const pointIndex = findPointAt(coords.x, coords.y)
    if (pointIndex !== null) {
      draggedPointIndex.value = pointIndex
    } else {
      // Add new point
      const normalized = toNormalized(coords.x, coords.y)
      const newPoints = [...localCurve.value.points, normalized].sort(
        (a, b) => a.x - b.x,
      )
      localCurve.value = { points: newPoints }
      editStore.setToneCurve(localCurve.value)
      render()
    }
  }

  function handleMouseMove(e: MouseEvent): void {
    const coords = getCanvasCoords(e)
    if (!coords) return

    if (draggedPointIndex.value !== null) {
      const normalized = toNormalized(coords.x, coords.y)
      const points = [...localCurve.value.points]
      const i = draggedPointIndex.value

      // Constrain x for non-anchor points
      if (i > 0 && i < points.length - 1) {
        normalized.x = Math.max(
          points[i - 1].x + 0.01,
          Math.min(points[i + 1].x - 0.01, normalized.x),
        )
      } else {
        normalized.x = points[i].x // Lock anchor x
      }

      points[i] = normalized
      localCurve.value = { points }
      debouncedStoreUpdate()
      render()
    } else {
      const newHover = findPointAt(coords.x, coords.y)
      if (newHover !== hoveredPointIndex.value) {
        hoveredPointIndex.value = newHover
        render()
      }
    }
  }

  function handleMouseUp(): void {
    if (draggedPointIndex.value !== null) {
      debouncedStoreUpdate.cancel()
      editStore.setToneCurve(localCurve.value)
      draggedPointIndex.value = null
      render()
    }
  }

  function handleMouseLeave(): void {
    hoveredPointIndex.value = null
    if (draggedPointIndex.value !== null) {
      handleMouseUp()
    }
    render()
  }

  function handleDoubleClick(e: MouseEvent): void {
    const coords = getCanvasCoords(e)
    if (!coords) return

    const pointIndex = findPointAt(coords.x, coords.y)
    if (pointIndex !== null) {
      deletePoint(pointIndex)
    }
  }

  // Actions
  function deletePoint(index: number): void {
    const points = localCurve.value.points
    if (index === 0 || index === points.length - 1) return
    if (points.length <= 2) return

    const newPoints = points.filter((_, i) => i !== index)
    localCurve.value = { points: newPoints }
    editStore.setToneCurve(localCurve.value)
    render()
  }

  function resetCurve(): void {
    editStore.resetToneCurve()
    localCurve.value = { points: [...editStore.adjustments.toneCurve.points] }
    render()
  }

  // Setup/teardown
  function setupEvents(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('mousedown', handleMouseDown)
    canvas.addEventListener('mousemove', handleMouseMove)
    canvas.addEventListener('mouseup', handleMouseUp)
    canvas.addEventListener('mouseleave', handleMouseLeave)
    canvas.addEventListener('dblclick', handleDoubleClick)
  }

  function teardownEvents(canvas: HTMLCanvasElement): void {
    canvas.removeEventListener('mousedown', handleMouseDown)
    canvas.removeEventListener('mousemove', handleMouseMove)
    canvas.removeEventListener('mouseup', handleMouseUp)
    canvas.removeEventListener('mouseleave', handleMouseLeave)
    canvas.removeEventListener('dblclick', handleDoubleClick)
  }

  // Watchers
  watch(
    () => editStore.adjustments.toneCurve,
    (storeCurve) => {
      if (!isDragging.value) {
        localCurve.value = { points: [...storeCurve.points] }
        render()
      }
    },
    { deep: true },
  )

  if (histogram) {
    watch(histogram, () => render())
  }

  watch(canvasRef, (newCanvas, oldCanvas) => {
    if (oldCanvas) teardownEvents(oldCanvas)
    if (newCanvas) {
      setupEvents(newCanvas)
      render()
    }
  })

  onMounted(() => {
    if (canvasRef.value) {
      setupEvents(canvasRef.value)
      render()
    }
  })

  onUnmounted(() => {
    debouncedStoreUpdate.cancel()
    if (canvasRef.value) {
      teardownEvents(canvasRef.value)
    }
  })

  return {
    canvasRef,
    localCurve,
    draggedPointIndex,
    hoveredPointIndex,
    isDragging,
    deletePoint,
    resetCurve,
    render,
  }
}
```

#### 11.6.2 Verification

- [ ] Composable compiles
- [ ] Canvas renders correctly
- [ ] Point interactions work

---

### Phase 11.7: ToneCurveEditor Component

**Goal**: Create the Vue component for the curve editor UI.

#### 11.7.1 Create `apps/web/app/components/edit/ToneCurveEditor.vue`

```vue
<script setup lang="ts">
/**
 * ToneCurveEditor Component
 *
 * Interactive tone curve editor with canvas visualization.
 */
import type { HistogramData } from '@literoom/core/decode'
import { DEFAULT_TONE_CURVE } from '@literoom/core/decode'

const props = defineProps<{
  assetId: string
  histogram?: HistogramData | null
}>()

const {
  canvasRef,
  localCurve,
  isDragging,
  resetCurve,
} = useToneCurve({
  histogram: toRef(props, 'histogram'),
})

const hasModifications = computed(() => {
  const points = localCurve.value.points
  const defaultPoints = DEFAULT_TONE_CURVE.points

  if (points.length !== defaultPoints.length) return true

  for (let i = 0; i < points.length; i++) {
    if (
      Math.abs(points[i].x - defaultPoints[i].x) > 0.001 ||
      Math.abs(points[i].y - defaultPoints[i].y) > 0.001
    ) {
      return true
    }
  }

  return false
})
</script>

<template>
  <div class="space-y-3" data-testid="tone-curve-editor">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-medium text-gray-400">
        Tone Curve
      </h3>
      <div class="flex items-center gap-2">
        <span
          v-if="isDragging"
          class="text-xs text-blue-400"
          data-testid="curve-dragging"
        >
          Adjusting...
        </span>
        <button
          v-if="hasModifications"
          class="text-xs text-gray-500 hover:text-gray-300 transition-colors"
          data-testid="curve-reset"
          @click="resetCurve"
        >
          Reset
        </button>
      </div>
    </div>

    <!-- Canvas -->
    <div
      class="relative aspect-square bg-gray-900 rounded overflow-hidden"
      data-testid="curve-canvas-container"
    >
      <canvas
        ref="canvasRef"
        width="256"
        height="256"
        class="w-full h-full"
        :class="{
          'cursor-grab': !isDragging,
          'cursor-grabbing': isDragging,
        }"
        style="touch-action: none;"
        data-testid="curve-canvas"
      />
    </div>

    <!-- Instructions -->
    <p class="text-xs text-gray-600">
      Click to add point | Drag to adjust | Double-click to delete
    </p>
  </div>
</template>
```

#### 11.7.2 Update `apps/web/app/components/edit/EditControlsPanel.vue`

Replace the placeholder in the Tone Curve accordion with the component:

```vue
<template #tonecurve-body>
  <ToneCurveEditor
    :asset-id="assetId"
    :histogram="histogramData"
  />
</template>
```

#### 11.7.3 Verification

- [ ] Component renders in edit view
- [ ] Canvas displays curve
- [ ] Interactions work (add, drag, delete, reset)

---

### Phase 11.8: Preview Integration

**Goal**: Wire tone curve into the preview rendering pipeline.

#### 11.8.1 Update `apps/web/app/composables/useEditPreview.ts`

After applying basic adjustments, apply tone curve:

```typescript
// In the render function, after applyAdjustments:

// Apply tone curve if not linear
const toneCurve = editStore.adjustments.toneCurve
const isLinear =
  toneCurve.points.length === 2 &&
  toneCurve.points[0].x === 0 &&
  toneCurve.points[0].y === 0 &&
  toneCurve.points[1].x === 1 &&
  toneCurve.points[1].y === 1

if (!isLinear) {
  const curveResult = await $decodeService.applyToneCurve(
    adjustedPixels,
    adjustedWidth,
    adjustedHeight,
    toneCurve.points,
  )
  adjustedPixels = curveResult.pixels
}

// Continue with pixelsToUrl...
```

#### 11.8.2 Verification

- [ ] Preview updates when curve changes
- [ ] Linear curve doesn't affect preview
- [ ] Non-linear curve modifies tonality

---

## File Summary

```
crates/
├── literoom-core/src/
│   ├── lib.rs              # 11.1.2 - Export curve module
│   └── curve.rs            # 11.1.1 - NEW: Interpolation + LUT
└── literoom-wasm/src/
    ├── lib.rs              # 11.2.2 - Export curve bindings
    └── curve.rs            # 11.2.1 - NEW: WASM bindings

packages/core/src/
├── decode/
│   ├── types.ts            # 11.3.1 - Add curve types
│   ├── worker-messages.ts  # 11.3.2 - Add message types
│   ├── decode-worker.ts    # 11.4.1 - Add handler
│   ├── decode-service.ts   # 11.4.2 - Add method
│   ├── mock-decode-service.ts # 11.4.3 - Add mock
│   └── index.ts            # 11.3.3 - Export types
└── catalog/
    └── types.ts            # 11.5.1 - Extend Adjustments

apps/web/app/
├── stores/
│   └── edit.ts             # 11.5.2 - Add curve actions
├── composables/
│   ├── useToneCurve.ts     # 11.6.1 - NEW: Curve composable
│   └── useEditPreview.ts   # 11.8.1 - Apply curve
├── components/edit/
│   ├── ToneCurveEditor.vue # 11.7.1 - NEW: Curve component
│   └── EditControlsPanel.vue # 11.7.2 - Integrate component
└── pages/edit/[id].vue     # Pass histogram to curve editor
```

---

## Verification Checklist

After all phases complete:

**Rust (Phase 11.1):**
- [ ] Interpolation algorithm works correctly
- [ ] Monotonicity guaranteed (no curve crossing)
- [ ] LUT generation produces expected values
- [ ] Identity curve produces identity LUT
- [ ] Unit tests pass

**WASM (Phase 11.2):**
- [ ] WASM builds successfully
- [ ] `JsToneCurveLut` accessible from TypeScript
- [ ] `apply_tone_curve` function works

**Types & Messages (Phase 11.3):**
- [ ] TypeScript types compile
- [ ] Exports available from package

**Worker/Service (Phase 11.4):**
- [ ] Worker handles messages
- [ ] Service method works
- [ ] Mock returns valid data

**Store (Phase 11.5):**
- [ ] Curve state stored correctly
- [ ] Actions work (add, update, delete, reset)

**Composable (Phase 11.6):**
- [ ] Canvas renders correctly
- [ ] Point interactions work
- [ ] Store updates properly

**Component (Phase 11.7):**
- [ ] Displays in edit view
- [ ] Reset button works
- [ ] Visual feedback during drag

**Preview (Phase 11.8):**
- [ ] Preview updates with curve changes
- [ ] Performance acceptable (<300ms)

---

## Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| LUT generation | <1ms | Cached until curve changes |
| Curve application (600px) | <5ms | LUT lookup is O(1) |
| Curve application (2560px) | <20ms | Linear with pixel count |
| Total preview with curve | <300ms | Within existing target |

---

## Future Enhancements (Post Phase 11)

1. **Per-channel curves**: Separate R/G/B curves
2. **Preset curves**: Common curves (S-curve, Film look, etc.)
3. **Point value display**: Show x/y coordinates while dragging
4. **Curve history**: Undo/redo for curve edits
5. **Copy/paste curves**: Between photos
