# Phase 11: Tone Curve - Area 5: Existing Codebase Review

**Date**: 2026-01-21
**Status**: Complete
**Objective**: Map existing code related to tone curves and identify gaps for implementation

---

## Executive Summary

The literoom codebase already has **foundational tone curve types defined in Rust** (`CurvePoint` and `ToneCurve` in `literoom-core`), but these are not yet exposed to WASM or integrated into the edit pipeline. The existing infrastructure for adjustments and histogram provides a clear pattern to follow for implementing tone curve support.

### Key Findings

1. **Rust types exist but are incomplete** - `ToneCurve` and `CurvePoint` are defined but lack:
   - Interpolation algorithm
   - LUT generation
   - WASM bindings
   - Integration with adjustment pipeline

2. **Edit pipeline is well-structured** - Clear patterns for:
   - Worker message passing
   - WASM bindings
   - TypeScript types
   - Vue composables

3. **UI placeholder exists** - `EditControlsPanel.vue` has a "Tone Curve" accordion section ready for the component

4. **Histogram composable provides reference pattern** - `useHistogramDisplay.ts` shows exactly how to build an interactive canvas-based edit tool

---

## 1. Existing Curve-Related Code

### 1.1 Rust Core Types (`crates/literoom-core/src/lib.rs`)

```rust
/// Tone curve control point
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct CurvePoint {
    /// Input value (0.0 to 1.0)
    pub x: f32,
    /// Output value (0.0 to 1.0)
    pub y: f32,
}

/// Tone curve with control points
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct ToneCurve {
    /// Control points for the curve (sorted by x)
    pub points: Vec<CurvePoint>,
}
```

**What exists:**
- Basic data structures for curve points and curves
- `CurvePoint::new()` constructor
- `ToneCurve::default()` creates linear curve (two endpoints)
- `ToneCurve::is_linear()` check for no-op optimization

**What's missing:**
- No interpolation algorithm (spline computation)
- No `evaluate(x) -> y` method
- No LUT generation for efficient pixel processing
- No WASM bindings exposed

### 1.2 WASM Module Structure (`crates/literoom-wasm/src/`)

Current modules:
- `lib.rs` - Entry point with exports
- `adjustments.rs` - BasicAdjustments bindings + apply_adjustments
- `histogram.rs` - JsHistogram + compute_histogram
- `decode.rs` - Image decoding
- `types.rs` - JsDecodedImage wrapper

**No curve.rs module exists yet.**

### 1.3 TypeScript Types (`packages/core/src/catalog/types.ts`)

The `EditState` interface has a comment placeholder:
```typescript
export interface EditState {
  version: typeof EDIT_SCHEMA_VERSION
  adjustments: Adjustments
  // Future additions:
  // toneCurve?: ToneCurve
  // crop?: CropTransform
  // masks?: Mask[]
}
```

**No TypeScript curve types exist yet.**

---

## 2. Current Edit Pipeline Architecture

### 2.1 Data Flow Overview

```
Vue Component (UI)
    |
    v
Pinia Store (edit.ts)
    |
    v
Composable (useEditPreview.ts)
    |
    v
DecodeService (decode-service.ts)
    |
    v [postMessage]
Decode Worker (decode-worker.ts)
    |
    v [WASM call]
literoom-wasm (Rust)
    |
    v
literoom-core (Rust algorithms)
```

### 2.2 Adjustment Application Flow

1. **User moves slider** in `EditAdjustmentSlider.vue`
2. **Store updates** via `editStore.setAdjustment(key, value)`
3. **Watcher triggers** in `useEditPreview.ts`
4. **Debounced render** calls `$decodeService.applyAdjustments()`
5. **Worker handles** `'apply-adjustments'` message type
6. **WASM applies** via `apply_adjustments()` function
7. **Pixels returned** and converted to blob URL

### 2.3 Current Adjustments Structure

**TypeScript (`packages/core/src/decode/types.ts`):**
```typescript
export interface Adjustments {
  temperature: number    // -100 to 100
  tint: number           // -100 to 100
  exposure: number       // -5 to 5 stops
  contrast: number       // -100 to 100
  highlights: number     // -100 to 100
  shadows: number        // -100 to 100
  whites: number         // -100 to 100
  blacks: number         // -100 to 100
  vibrance: number       // -100 to 100
  saturation: number     // -100 to 100
}
```

**Rust (`crates/literoom-core/src/lib.rs`):**
```rust
pub struct BasicAdjustments {
    pub temperature: f32,
    pub tint: f32,
    pub exposure: f32,
    pub contrast: f32,
    pub highlights: f32,
    pub shadows: f32,
    pub whites: f32,
    pub blacks: f32,
    pub vibrance: f32,
    pub saturation: f32,
}
```

### 2.4 Rust Adjustment Pipeline (`crates/literoom-core/src/adjustments.rs`)

Adjustments are applied in order:
1. Exposure
2. Contrast
3. Temperature
4. Tint
5. Highlights
6. Shadows
7. Whites
8. Blacks
9. Saturation
10. Vibrance

**Tone curve should be applied AFTER these adjustments** (similar to Lightroom's processing order).

---

## 3. Reference Pattern: Histogram Implementation

The histogram feature provides the exact pattern to follow:

### 3.1 Rust Core (`crates/literoom-core/src/histogram.rs`)

```rust
pub fn compute_histogram(pixels: &[u8], width: u32, height: u32) -> Histogram
```

- Takes raw pixel data
- Returns structured result
- Single-pass O(n) algorithm

### 3.2 WASM Bindings (`crates/literoom-wasm/src/histogram.rs`)

```rust
#[wasm_bindgen]
pub struct JsHistogram { ... }

#[wasm_bindgen]
pub fn compute_histogram(pixels: &[u8], width: u32, height: u32) -> JsHistogram
```

- Wraps core function
- Provides JS-friendly accessors
- Manages memory (clone data for JS)

### 3.3 Worker Message Types (`packages/core/src/decode/worker-messages.ts`)

```typescript
export interface ComputeHistogramRequest {
  id: string
  type: 'compute-histogram'
  pixels: Uint8Array
  width: number
  height: number
}

export interface HistogramResponse {
  id: string
  type: 'histogram'
  red: Uint32Array
  // ...
}
```

### 3.4 Decode Service Method (`packages/core/src/decode/decode-service.ts`)

```typescript
async computeHistogram(
  pixels: Uint8Array,
  width: number,
  height: number
): Promise<HistogramData>
```

### 3.5 Vue Composable (`apps/web/app/composables/useHistogramDisplay.ts`)

Key patterns:
- Canvas ref for rendering
- Debounced updates (500ms)
- Watch on asset ID changes
- Watch on adjustment changes
- Source pixel caching
- Cleanup on unmount

---

## 4. Types and Interfaces to Create/Extend

### 4.1 New TypeScript Types Needed

**In `packages/core/src/decode/types.ts`:**
```typescript
export interface CurvePoint {
  x: number  // 0 to 1
  y: number  // 0 to 1
}

export interface ToneCurve {
  points: CurvePoint[]
}

export const DEFAULT_TONE_CURVE: ToneCurve = {
  points: [
    { x: 0, y: 0 },
    { x: 1, y: 1 }
  ]
}
```

### 4.2 Extended Adjustments

**Option A: Separate curve from adjustments**
```typescript
// In decode/types.ts
export interface EditParameters {
  adjustments: Adjustments
  toneCurve: ToneCurve
}
```

**Option B: Add to existing Adjustments**
```typescript
// Not recommended - keeps Adjustments as sliders only
```

**Recommendation: Option A** - Keep `Adjustments` for sliders, add parallel `ToneCurve` type.

### 4.3 Worker Message Extensions

```typescript
export interface ApplyToneCurveRequest {
  id: string
  type: 'apply-tone-curve'
  pixels: Uint8Array
  width: number
  height: number
  points: CurvePoint[]
}

// Or extend apply-adjustments to include optional curve
export interface ApplyAdjustmentsRequest {
  // ... existing fields
  toneCurve?: CurvePoint[]
}
```

### 4.4 Edit Store Extensions

**In `apps/web/app/stores/edit.ts`:**
```typescript
const toneCurve = ref<ToneCurve>({ points: [...DEFAULT_TONE_CURVE.points] })
const isCurveModified = computed(() => !isLinearCurve(toneCurve.value))

function setCurvePoint(index: number, point: CurvePoint): void
function addCurvePoint(point: CurvePoint): void
function deleteCurvePoint(index: number): void
function resetCurve(): void
```

---

## 5. Files to Create

| File | Purpose |
|------|---------|
| `crates/literoom-core/src/curve.rs` | Spline interpolation, LUT generation, curve evaluation |
| `crates/literoom-wasm/src/curve.rs` | WASM bindings for curve operations |
| `packages/core/src/decode/curve-types.ts` | TypeScript curve types (or add to types.ts) |
| `apps/web/app/composables/useToneCurve.ts` | Composable for curve state and canvas interaction |
| `apps/web/app/components/edit/ToneCurveEditor.vue` | Interactive curve editor component |

---

## 6. Files to Modify

| File | Changes |
|------|---------|
| `crates/literoom-core/src/lib.rs` | Export curve module, extend ToneCurve with methods |
| `crates/literoom-core/src/adjustments.rs` | Add curve application to pipeline (optional) |
| `crates/literoom-wasm/src/lib.rs` | Export curve bindings |
| `packages/core/src/decode/types.ts` | Add ToneCurve, CurvePoint types |
| `packages/core/src/decode/worker-messages.ts` | Add curve-related message types |
| `packages/core/src/decode/decode-worker.ts` | Handle curve application messages |
| `packages/core/src/decode/decode-service.ts` | Add curve application method |
| `packages/core/src/catalog/types.ts` | Extend EditState with toneCurve field |
| `apps/web/app/stores/edit.ts` | Add curve state and actions |
| `apps/web/app/composables/useEditPreview.ts` | Pass curve to adjustment pipeline |
| `apps/web/app/components/edit/EditControlsPanel.vue` | Replace placeholder with ToneCurveEditor |

---

## 7. Integration Points

### 7.1 Where Curve Applies in Pixel Pipeline

In Lightroom's processing order, tone curve applies AFTER basic adjustments:
1. Lens corrections (not implemented)
2. White balance (temperature, tint)
3. Basic tone (exposure, contrast, highlights, shadows, whites, blacks)
4. **Tone Curve** <-- HERE
5. HSL adjustments (not implemented)
6. Color grading (not implemented)
7. Effects (vibrance, saturation - could move before curve)

**Recommendation:** Apply curve after all current adjustments in `apply_all_adjustments`.

### 7.2 LUT vs Real-time Computation

For a tone curve with N control points:
- **Pre-compute 256-entry LUT** once when curve changes
- Apply LUT with O(1) lookup per channel per pixel
- Much faster than computing spline for each pixel

```rust
// In curve.rs
pub fn generate_lut(curve: &ToneCurve) -> [u8; 256] {
    let mut lut = [0u8; 256];
    for i in 0..256 {
        let x = i as f32 / 255.0;
        let y = curve.evaluate(x);  // Spline interpolation
        lut[i] = (y * 255.0).clamp(0.0, 255.0) as u8;
    }
    lut
}

// In pixel processing
fn apply_curve_lut(r: u8, g: u8, b: u8, lut: &[u8; 256]) -> (u8, u8, u8) {
    (lut[r as usize], lut[g as usize], lut[b as usize])
}
```

---

## 8. Questions Resolved

### Q1: What curve-related code or types already exist?
**A:** `CurvePoint` and `ToneCurve` structs in `literoom-core/src/lib.rs` with basic constructors and `is_linear()` check. No interpolation or WASM bindings.

### Q2: How does the current edit pipeline work?
**A:** Store -> Composable -> DecodeService -> Worker -> WASM -> Core Rust. Well-structured with TypeScript types, worker messages, and async handling.

### Q3: What types and interfaces need to be extended?
**A:**
- TypeScript: Add `CurvePoint`, `ToneCurve` types; extend `EditState`
- Rust: Add interpolation methods, LUT generation to `ToneCurve`
- Worker messages: Add curve-related request/response types

### Q4: How does the histogram composable work?
**A:** `useHistogramDisplay.ts` provides exact pattern:
- Canvas ref for rendering
- Source pixel caching
- Debounced computation
- Watch on asset/adjustment changes
- WASM integration via worker

### Q5: What files need to be created vs modified?
**A:** See sections 5 and 6 above for complete lists.

---

## 9. Recommended Implementation Order

1. **Rust Core** - Implement interpolation and LUT generation
2. **WASM Bindings** - Expose curve functions to JavaScript
3. **TypeScript Types** - Add curve types and worker messages
4. **Worker Integration** - Handle curve in decode-worker
5. **Edit Store** - Add curve state management
6. **Preview Integration** - Pass curve through pipeline
7. **Vue Component** - Build interactive curve editor
8. **Testing** - Unit tests for Rust, integration tests for UI

---

## 10. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Spline math complexity | Start with Catmull-Rom, well-documented algorithm |
| Performance on large images | LUT pre-computation makes application O(n) |
| Canvas interaction complexity | Reference histogram canvas code |
| State synchronization | Follow existing adjustment pattern |
| Memory management | WASM bindings handle allocation/free |

---

## Appendix: File Locations

### Rust Crates
- `/Users/michaelthiessen/Developer/literoom/crates/literoom-core/src/`
- `/Users/michaelthiessen/Developer/literoom/crates/literoom-wasm/src/`

### TypeScript Packages
- `/Users/michaelthiessen/Developer/literoom/packages/core/src/decode/`
- `/Users/michaelthiessen/Developer/literoom/packages/core/src/catalog/`

### Vue Application
- `/Users/michaelthiessen/Developer/literoom/apps/web/app/stores/`
- `/Users/michaelthiessen/Developer/literoom/apps/web/app/composables/`
- `/Users/michaelthiessen/Developer/literoom/apps/web/app/components/edit/`
