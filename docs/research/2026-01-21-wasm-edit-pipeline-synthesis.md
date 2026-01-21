# Phase 9: WASM Edit Pipeline - Research Synthesis

**Date**: 2026-01-21
**Status**: Research Complete
**Research Plan**: [WASM Edit Pipeline Research Plan](./2026-01-21-wasm-edit-pipeline-research-plan.md)

---

## Executive Summary

Phase 9 implements the core `apply_adjustments()` function that enables real-time photo editing. The existing infrastructure provides everything needed - we just need to implement the pixel-level adjustment algorithms in Rust and wire them through the existing worker/service architecture.

**Key Decisions**:
1. Implement custom adjustment algorithms (no external library needed for v1)
2. Use draft/full quality tiers for responsive interactive editing
3. Process all adjustments in a single pass for efficiency
4. Target 600px for draft (<50ms), 2560px for full (<300ms)

---

## 1. Adjustment Algorithms

Each of the 10 adjustments has a well-defined algorithm:

### Exposure (-5 to +5 stops)
```
multiplier = 2^(exposure_value)
output_pixel = input_pixel * multiplier
```

### Contrast (-100 to +100)
```
multiplier = 1.0 + (contrast / 100.0)
output_pixel = (input_pixel - 0.5) * multiplier + 0.5
```

### Temperature (-100 to +100)
```
Negative = warmer (add red, reduce blue)
Positive = cooler (reduce red, add blue)
Apply per-channel multipliers
```

### Tint (-100 to +100)
```
Negative = add green
Positive = add magenta (red + blue)
Apply per-channel multipliers
```

### Highlights (-100 to +100)
```
Calculate luminance
Apply adjustment only to pixels with luminance > 0.75
Use smoothstep for soft transition
```

### Shadows (-100 to +100)
```
Calculate luminance
Apply adjustment only to pixels with luminance < 0.25
Use smoothstep for soft transition
```

### Whites (-100 to +100)
```
Affects brightest pixels (max channel > 0.9)
Hard threshold with multiplier adjustment
```

### Blacks (-100 to +100)
```
Affects darkest pixels (min channel < 0.1)
Hard threshold with multiplier adjustment
```

### Saturation (-100 to +100)
```
Convert RGB → HSV
Multiply S by (1.0 + saturation/100.0)
Convert HSV → RGB
```

### Vibrance (-100 to +100)
```
Like saturation but:
- Protects already-saturated colors
- Protects skin tones (R > G > B)
- More subtle effect
```

### Application Order
1. Exposure
2. Contrast
3. Temperature/Tint
4. Highlights/Shadows
5. Whites/Blacks
6. Saturation
7. Vibrance

---

## 2. Existing Infrastructure

### What Exists (Ready to Use)

| Component | Status | Location |
|-----------|--------|----------|
| `BasicAdjustments` struct | ✅ Complete | `crates/literoom-core/src/lib.rs` |
| WASM bindings for BasicAdjustments | ✅ Complete | `crates/literoom-wasm/src/adjustments.rs` |
| `JsDecodedImage` wrapper | ✅ Complete | `crates/literoom-wasm/src/types.rs` |
| Decode Worker | ✅ Ready for extension | `packages/core/src/decode/decode-worker.ts` |
| Decode Service | ✅ Ready for extension | `packages/core/src/decode/decode-service.ts` |
| Message types | ✅ Ready for extension | `packages/core/src/decode/worker-messages.ts` |
| useEditPreview composable | ⚠️ Has placeholder | `apps/web/app/composables/useEditPreview.ts` |

### What Needs to Be Added

| Component | Description | Location |
|-----------|-------------|----------|
| `apply_adjustments()` Rust function | Core pixel processing | `crates/literoom-core/src/adjustments.rs` (new) |
| WASM binding for apply_adjustments | Expose to JS | `crates/literoom-wasm/src/adjustments.rs` |
| `apply-adjustments` message type | Worker communication | `packages/core/src/decode/worker-messages.ts` |
| Worker handler | Process adjustment requests | `packages/core/src/decode/decode-worker.ts` |
| Service method | `applyAdjustments()` | `packages/core/src/decode/decode-service.ts` |
| Preview integration | Replace TODO | `apps/web/app/composables/useEditPreview.ts` |

---

## 3. Performance Strategy

### Draft vs Full Quality

| Quality | Resolution | Filter | Target Latency | Use Case |
|---------|------------|--------|----------------|----------|
| Draft | 600px max | Bilinear | <50ms | During slider drag |
| Full | 2560px max | Lanczos3 | <300ms | After slider release |

### Rendering Timeline
```
User drags slider
    ↓ (immediate)
Show current preview (no change)
    ↓ (300ms debounce)
Generate draft preview (600px) → display
    ↓ (1000ms after stop)
Generate full preview (2560px) → display
```

### Memory Constraints
- Draft preview: ~0.7 MB RGB buffer
- Full preview: ~13 MB RGB buffer
- Safe WASM memory: <100 MB peak
- Use Transferable for output (already implemented)

---

## 4. Implementation Architecture

```
┌─────────────────────────────────────────────────────────┐
│ useEditPreview.ts                                        │
│ - Watches editStore.adjustments                         │
│ - Debounces render requests (300ms)                     │
│ - Calls decodeService.applyAdjustments()                │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ decode-service.ts                                        │
│ - applyAdjustments(pixels, adjustments, quality)        │
│ - Manages request/response correlation                  │
│ - Handles timeouts                                      │
└────────────────────────┬────────────────────────────────┘
                         │ postMessage
                         ▼
┌─────────────────────────────────────────────────────────┐
│ decode-worker.ts                                         │
│ - Receives apply-adjustments message                    │
│ - Calls WASM apply_adjustments()                        │
│ - Returns pixels via Transferable                       │
└────────────────────────┬────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│ literoom-wasm (WASM)                                     │
│ - apply_adjustments(image, adjustments) -> image        │
│ - Processes all 10 adjustments in single pass           │
│ - Returns modified JsDecodedImage                       │
└─────────────────────────────────────────────────────────┘
```

---

## 5. Rust Implementation Strategy

### Single-Pass Processing
Process all adjustments in one loop over pixels for cache efficiency:

```rust
fn apply_all_adjustments(pixels: &mut [u8], adj: &BasicAdjustments) {
    for chunk in pixels.chunks_exact_mut(3) {
        let mut r = chunk[0] as f32 / 255.0;
        let mut g = chunk[1] as f32 / 255.0;
        let mut b = chunk[2] as f32 / 255.0;

        // Apply each adjustment in order
        (r, g, b) = apply_exposure(r, g, b, adj.exposure);
        (r, g, b) = apply_contrast(r, g, b, adj.contrast);
        (r, g, b) = apply_temperature_tint(r, g, b, adj.temperature, adj.tint);
        (r, g, b) = apply_highlights_shadows(r, g, b, adj.highlights, adj.shadows);
        (r, g, b) = apply_whites_blacks(r, g, b, adj.whites, adj.blacks);
        (r, g, b) = apply_saturation(r, g, b, adj.saturation);
        (r, g, b) = apply_vibrance(r, g, b, adj.vibrance);

        chunk[0] = (r.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[1] = (g.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[2] = (b.clamp(0.0, 1.0) * 255.0) as u8;
    }
}
```

### Early Exit for Default Values
```rust
pub fn apply_adjustments(image: JsDecodedImage, adj: &BasicAdjustments) -> JsDecodedImage {
    // Fast path: if all adjustments are default, return unchanged
    if adj.is_default() {
        return image;
    }

    // Full processing path
    // ...
}
```

---

## 6. Testing Strategy

### Unit Tests (Rust)
1. **Identity test**: Zero adjustments → output equals input
2. **Boundary test**: Extreme values (-100/+100) → valid output range
3. **Isolation test**: Each adjustment tested individually
4. **Order test**: Verify adjustment application order matters

### Integration Tests (TypeScript)
1. **Worker communication**: Send adjustment request, receive pixels
2. **Service timeout**: Verify timeout handling works
3. **Quality modes**: Verify draft vs full paths work

### E2E Tests (Playwright)
1. **Slider interaction**: Move slider → preview updates
2. **Quality indicator**: Draft/Full indicators display correctly
3. **Performance**: Verify responsiveness targets met

---

## 7. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Performance issues with large images | Draft quality with small resolution |
| Algorithm produces unexpected results | Unit tests with known inputs/outputs |
| Memory pressure | Explicit `.free()` calls, limit buffer sizes |
| Worker crashes | Error handling, timeout recovery |

---

## 8. Dependencies

No new dependencies required:
- Rust: Custom algorithms using standard library
- TypeScript: Existing decode infrastructure
- Vue: Existing composable patterns

---

## Summary

Phase 9 is well-scoped with clear implementation path:
1. Create Rust adjustment module with 10 algorithms
2. Add WASM binding for `apply_adjustments()`
3. Extend worker message types
4. Add handler in decode worker
5. Add method in decode service
6. Update useEditPreview composable

Estimated implementation: 5 sub-phases with clear deliverables.
