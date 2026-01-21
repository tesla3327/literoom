# Phase 11: Tone Curve - Research Synthesis

**Date**: 2026-01-21
**Status**: Complete
**Research Plan**: [Tone Curve Research Plan](./2026-01-21-tone-curve-research-plan.md)

---

## Executive Summary

This synthesis combines findings from 5 parallel research areas to provide a comprehensive implementation approach for the tone curve feature in literoom. The tone curve is a fundamental photo editing tool that maps input brightness values to output values, allowing precise control over image contrast and tonality.

### Key Decisions

| Aspect | Decision | Rationale |
|--------|----------|-----------|
| **Interpolation Algorithm** | Monotonic Cubic Hermite (Fritsch-Carlson) | Guarantees monotonicity, prevents artifacts |
| **Pixel Processing** | 256-entry LUT with O(1) lookup | Essential for real-time preview (<50ms target) |
| **LUT Generation Location** | Rust (WASM) | Single source of truth, consistency with processing |
| **Pipeline Integration** | Separate function after `apply_adjustments` | Cleaner architecture, independent caching |
| **State Storage** | Extend `Adjustments` interface with `toneCurve` field | Leverages existing store patterns |
| **Canvas UI** | Pointer Events + Catmull-Rom rendering | Unified input, smooth curves |
| **Debouncing** | 16ms during drag, 300ms for preview | Responsive feel, efficient rendering |

---

## 1. Curve Mathematics (Area 1)

### Interpolation Algorithm: Monotonic Cubic Hermite Splines

The **Fritsch-Carlson algorithm** is recommended for tone curve interpolation because:

1. **Mathematically guaranteed monotonicity** - Prevents curve "crossing" that causes solarization artifacts
2. **Control points lie on the curve** - Intuitive for users (unlike Bezier)
3. **C1 continuity** - Smooth first derivative for natural-looking transitions
4. **Well-documented** - 1980 SIAM paper, used in darktable, SciPy PCHIP

**Algorithm steps:**
1. Compute secants (slopes between adjacent points)
2. Initialize tangents using weighted harmonic mean
3. Adjust tangents that violate monotonicity (alpha/beta <= 3)
4. Evaluate using cubic Hermite basis functions

**Alternative considered:** Catmull-Rom splines are simpler but don't guarantee strict monotonicity.

### Data Structure

```typescript
interface CurvePoint {
  x: number  // 0-1, input value (shadows to highlights)
  y: number  // 0-1, output value (black to white)
}

interface ToneCurve {
  points: CurvePoint[]  // Sorted by x, minimum 2 points
}
```

---

## 2. WASM/Rust Implementation (Area 2)

### LUT-Based Processing

Pre-computing a 256-entry lookup table is essential for performance:

| Approach | Per-Pixel Cost | 2560x1440 Image |
|----------|----------------|-----------------|
| Direct spline | ~50-100 cycles | ~120ms |
| LUT lookup | ~3 cycles | ~4ms |

**LUT Generation:**
- Sample curve at 256 x-values (0-255)
- Store output values in array
- Cache LUT until curve points change

### Pipeline Integration

**Recommended: Separate function after basic adjustments**

```
Input Pixels
    |
    v
apply_adjustments()  <-- Exposure, Contrast, etc. (per-pixel math)
    |
    v
apply_tone_curve()   <-- Uses pre-computed LUT (O(1) lookup)
    |
    v
Output Pixels
```

**Why separate:**
- Different application order (curve after adjustments, like Lightroom)
- Different update frequency (curve changes less often)
- Separate LUT caching lifecycle
- Cleaner testing

### Performance Targets

| Operation | Draft (600px) | Full (2560px) | Target |
|-----------|---------------|---------------|--------|
| `apply_adjustments` | ~5-15ms | ~80-200ms | - |
| `apply_tone_curve` | ~0.5-1ms | ~10-20ms | - |
| **Total** | **~6-16ms** | **~90-220ms** | <50ms / <300ms |

---

## 3. Canvas UI (Area 3)

### Rendering Architecture

Layered rendering (back to front):
1. Background fill (dark)
2. Histogram (semi-transparent, 15-25% alpha)
3. Grid lines (4x4 divisions)
4. Diagonal reference (dashed line showing identity)
5. Curve (white, 2px stroke)
6. Control points (circles, 6px radius)

### Catmull-Rom for Canvas Drawing

Convert control points to cubic Bezier for native canvas API:

```typescript
// Each segment uses Catmull-Rom tension (0.5 centripetal)
// Converted to bezierCurveTo() control points
ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, end.x, end.y)
```

### User Interaction

**Adding points:**
- Click on curve line (not empty space)
- Point placed at curve's y-value for clicked x

**Deleting points:**
- Double-click on point
- Cannot delete anchor points (x=0 or x=1)

**Dragging:**
- Pointer Events API (unified mouse/touch/pen)
- Pointer capture for reliable tracking
- Constrain x-movement to prevent crossing neighbors
- Lock anchor point x-positions

**Reset:**
- Button to restore linear curve (two endpoints)

### Hit Detection

| Element | Visual Radius | Hit Radius |
|---------|---------------|------------|
| Control point | 6px | 12-14px |
| Curve line | 2px | 8-10px |
| Touch devices | - | +6px to hit radius |

---

## 4. Vue/Composable Architecture (Area 4)

### State Storage

Extend `Adjustments` interface in existing store:

```typescript
interface Adjustments {
  // ... existing numeric adjustments ...
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

  // New field
  toneCurve: ToneCurve
}

const DEFAULT_ADJUSTMENTS: Adjustments = {
  // ... existing defaults ...
  toneCurve: {
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 }
    ]
  }
}
```

**Why this approach:**
- Leverages existing store patterns (`isDirty`, `reset()`, persistence)
- Automatic JSON serialization
- Schema versioning for migration

### Composable Pattern

The `useToneCurve` composable manages:
- `canvasRef` - Template binding for canvas element
- `localCurve` - Immediate state for smooth dragging
- Coordinate conversion (normalized <-> canvas)
- Event handlers (pointer down/move/up)
- Debounced store updates (16ms during drag)

**Timing strategy:**
- Canvas redraw: Immediate (no debounce)
- Store update during drag: 16ms debounce
- Preview render: 300ms debounce (existing)
- Histogram update: 500ms debounce (existing)

### Undo/Reset

**v1 approach:**
- `resetToneCurve()` - Reset only curve to linear
- `reset()` - Reset all adjustments (already works)

**Future:** Add full undo/redo with command pattern or snapshot history.

---

## 5. Existing Codebase (Area 5)

### What Already Exists

**Rust types (`literoom-core/src/lib.rs`):**
- `CurvePoint` struct with x, y fields
- `ToneCurve` struct with points vector
- `is_linear()` method for identity check
- **Missing:** Interpolation, LUT generation, WASM bindings

**UI placeholder:**
- "Tone Curve" accordion in `EditControlsPanel.vue` (ready for component)

**Reference patterns:**
- `useHistogramDisplay.ts` - Canvas rendering, debouncing, WASM integration
- `useEditPreview.ts` - Adjustment application flow

### Integration Points

1. **Store (`edit.ts`):** Add curve state and actions
2. **Types (`types.ts`):** Add TypeScript curve types
3. **Worker messages:** Add curve-related message types
4. **Decode service:** Add curve application method
5. **Preview composable:** Pass curve through pipeline

---

## 6. Implementation Plan Summary

### Files to Create

| File | Purpose |
|------|---------|
| `crates/literoom-core/src/curve.rs` | Spline interpolation, LUT generation |
| `crates/literoom-wasm/src/curve.rs` | WASM bindings |
| `apps/web/app/composables/useToneCurve.ts` | Interactive curve state |
| `apps/web/app/components/edit/ToneCurveEditor.vue` | Curve editor component |

### Files to Modify

| File | Changes |
|------|---------|
| `crates/literoom-core/src/lib.rs` | Export curve module |
| `crates/literoom-wasm/src/lib.rs` | Export WASM bindings |
| `packages/core/src/decode/types.ts` | Add curve types |
| `packages/core/src/decode/worker-messages.ts` | Add message types |
| `packages/core/src/decode/decode-worker.ts` | Handle curve messages |
| `packages/core/src/decode/decode-service.ts` | Add curve method |
| `packages/core/src/catalog/types.ts` | Extend EditState |
| `apps/web/app/stores/edit.ts` | Add curve actions |
| `apps/web/app/composables/useEditPreview.ts` | Pass curve to WASM |
| `apps/web/app/components/edit/EditControlsPanel.vue` | Integrate component |

### Implementation Order

1. **Phase 11.1:** Rust curve module (interpolation, LUT generation)
2. **Phase 11.2:** WASM bindings (JsToneCurveLut, apply_tone_curve)
3. **Phase 11.3:** TypeScript types and worker messages
4. **Phase 11.4:** Worker handler and service method
5. **Phase 11.5:** Edit store extensions
6. **Phase 11.6:** useToneCurve composable
7. **Phase 11.7:** ToneCurveEditor component
8. **Phase 11.8:** Preview integration

---

## 7. Testing Strategy

### Rust Unit Tests

- Monotonicity validation (curve never crosses)
- Endpoint preservation (0,0 -> 0,0 and 1,1 -> 1,1)
- LUT identity for linear curve
- LUT correctness for known S-curve
- Performance benchmarks

### TypeScript Unit Tests

- Curve point sorting
- Constraint validation
- Canvas coordinate conversion

### E2E Tests (Playwright)

- Add control point
- Drag point to new position
- Delete control point
- Reset curve
- Verify preview updates

---

## 8. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Spline math complexity | Fritsch-Carlson is well-documented, reference implementations available |
| Performance on large images | LUT approach is O(n), proven efficient |
| Canvas interaction bugs | Follow histogram composable patterns |
| State sync issues | Use existing store patterns |
| Memory leaks | Follow WASM memory management patterns from histogram |

---

## 9. References

### Research Documents
- [Area 1: Mathematics](./2026-01-21-tone-curve-area-1-mathematics.md)
- [Area 2: WASM Implementation](./2026-01-21-tone-curve-area-2-wasm-implementation.md)
- [Area 3: Canvas UI](./2026-01-21-tone-curve-area-3-canvas-ui.md)
- [Area 4: Vue Architecture](./2026-01-21-tone-curve-area-4-vue-architecture.md)
- [Area 5: Codebase Review](./2026-01-21-tone-curve-area-5-codebase-review.md)

### External References
- Fritsch & Carlson (1980) - Monotone Piecewise Cubic Interpolation
- darktable monotonic splines documentation
- Adobe DNG SDK tone curve handling
- RawTherapee curve implementation
