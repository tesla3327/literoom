# GPU Pipeline Integration Research Synthesis

**Date**: 2026-01-23
**Phase**: GPU Acceleration Phase 7

## Executive Summary

This research investigates how to create a unified GPU edit pipeline that chains all operations (rotation, adjustments, tone curve, masks) to achieve 60fps preview updates with minimal GPU↔CPU transfers.

## Key Findings

### 1. Current Pipeline State

**useEditPreview.ts Pipeline Order** (lines 534-634):
1. **Rotation** (534-553) - GPU adaptive via `applyRotationAdaptive()`
2. **Crop** (555-568) - WASM only via `$decodeService.applyCrop()`
3. **Adjustments** (570-581) - WASM only via `$decodeService.applyAdjustments()`
4. **Tone Curve** (583-594) - WASM only via `$decodeService.applyToneCurve()`
5. **Masks** (596-634) - GPU adaptive via `applyMaskedAdjustmentsAdaptive()`
6. **Clipping Detection** (636-642) - CPU
7. **Display Conversion** (645) - `pixelsToUrl()` RGB→RGBA→Canvas→Blob

**Critical Discovery**: Despite having GPU implementations for adjustments and tone curve, they are NOT being used in the preview pipeline! Only rotation and masks use GPU adaptively.

### 2. GPU↔CPU Transfer Points

**Current Transfers (per render)**:
1. Rotation: CPU→GPU (upload) → GPU→CPU (readback)
2. Crop: CPU only (WASM)
3. Adjustments: CPU only (WASM)
4. Tone Curve: CPU only (WASM)
5. Masks: CPU→GPU (upload) → GPU→CPU (readback)
6. Display: CPU→Canvas

**Problem**: Even for the GPU operations, we're doing full round-trips instead of keeping data on GPU.

### 3. Texture Chaining Capabilities

All GPU pipelines support texture-to-texture chaining:

| Pipeline | Method | Dimensions | Chaining |
|----------|--------|-----------|----------|
| Adjustments | `applyToTextures()` | Fixed | ✅ YES |
| ToneCurve | `applyToTextures()` | Fixed | ✅ YES |
| Masks | `applyToTextures()` | Fixed | ✅ YES |
| Rotation | `applyToTextures()` | Variable | ✅ YES |
| Histogram | `compute()` | N/A | ❌ Output is data |

**Key Insight**: All transformation pipelines return `GPUCommandEncoder` for chaining. This allows batching all operations into a single GPU submission.

### 4. Texture Management Infrastructure

**Existing but Unused**:
- `DoubleBufferedTextures` class (texture-utils.ts:321-379)
- `TexturePool` class (texture-utils.ts:159-253)
- `BufferPool` class (texture-utils.ts:258-316)

**Current Waste**:
- Each pipeline creates/destroys textures per operation
- Staging buffers recreated every readback
- No reuse between operations

### 5. Data Format Consistency

- **DecodedImage**: Always RGB (3 bytes/pixel)
- **GPU Textures**: Always `rgba8unorm` (4 bytes/pixel)
- **Conversions**: RGB↔RGBA at GPU boundaries

All pipelines use consistent `rgba8unorm` format, enabling seamless chaining.

### 6. Service Architecture

All GPU services follow singleton pattern with:
- Lazy initialization
- Shared `GPUDevice` via `GPUCapabilityService`
- Adaptive fallback functions
- `isReady` checks

## Optimization Opportunities

### Opportunity 1: Enable GPU Adjustments and Tone Curve

The GPU services exist but aren't used in the preview:
- `applyAdjustmentsAdaptive()` - exists in gpu-adjustments-service.ts
- `applyToneCurveAdaptive()` - exists in gpu-tone-curve-service.ts

**Quick win**: Replace WASM calls with adaptive GPU calls.

### Opportunity 2: Unified GPU Pipeline

Create `GPUEditPipeline` that:
1. Uploads pixels to GPU texture once
2. Chains all operations using `applyToTextures()` methods
3. Reads back pixels once for display/histogram
4. Keeps crop in WASM (fast enough, simple pixel copy)

**Expected flow**:
```
CPU Pixels → GPU Upload (1x)
  → Rotation (texture→texture)
  → Adjustments (texture→texture)
  → ToneCurve (texture→texture)
  → Masks (texture→texture)
  → GPU Readback (1x) → CPU Pixels
```

### Opportunity 3: Texture Pool Usage

Use existing `TexturePool` and `BufferPool` to:
- Reuse textures between renders
- Avoid allocation/deallocation overhead
- Handle dimension changes (rotation)

### Opportunity 4: Single Command Buffer Submission

Chain all operations with shared `GPUCommandEncoder`:
```typescript
const encoder = device.createCommandEncoder()
rotationPipeline.applyToTextures(..., encoder)
adjustmentsPipeline.applyToTextures(..., encoder)
toneCurvePipeline.applyToTextures(..., encoder)
maskPipeline.applyToTextures(..., encoder)
device.queue.submit([encoder.finish()])
```

## Architecture Decision

### Approach A: Incremental (Recommended)

1. First enable individual GPU operations in useEditPreview.ts
2. Then create unified pipeline coordinator
3. Then add texture pooling

**Pros**: Lower risk, incremental verification
**Cons**: Slower to full optimization

### Approach B: Full Pipeline Rewrite

1. Create GPUEditPipeline with all operations
2. Replace entire processPreview() function
3. Add fallback to current implementation

**Pros**: Maximum optimization
**Cons**: Higher risk, harder to debug

### Recommendation: Approach A

Start by enabling GPU adjustments and tone curve in the existing pipeline structure, then build the unified pipeline coordinator.

## Performance Targets

| Metric | Current | Target | Improvement |
|--------|---------|--------|-------------|
| Full render | ~500ms | <16ms | 30x+ |
| Adjustments | ~180ms (WASM) | ~8ms (GPU) | 22x |
| Tone Curve | ~15ms (WASM) | ~1ms (GPU) | 15x |
| GPU transfers | 4 round-trips | 1 round-trip | 4x reduction |

## Implementation Phases

### Phase 7.1: Enable GPU Adjustments
- Replace `$decodeService.applyAdjustments()` with `applyAdjustmentsAdaptive()`
- Verify output matches WASM

### Phase 7.2: Enable GPU Tone Curve
- Replace `$decodeService.applyToneCurve()` with `applyToneCurveAdaptive()`
- Verify output matches WASM

### Phase 7.3: Create GPUEditPipeline Coordinator
- Implement texture ping-pong
- Chain all operations
- Single upload/readback

### Phase 7.4: Add Texture Pooling
- Integrate TexturePool
- Reuse across renders

### Phase 7.5: Optimize for 60fps
- Profile and tune
- Consider async readback
- Add real-time mode during drag

## Files to Modify

1. `apps/web/app/composables/useEditPreview.ts` - Enable GPU ops
2. `packages/core/src/gpu/pipelines/edit-pipeline.ts` - New unified pipeline
3. `packages/core/src/gpu/index.ts` - Export new pipeline

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Visual differences | Medium | A/B compare GPU vs WASM output |
| Memory pressure | Low | Use texture pooling |
| GPU errors | Low | Existing fallback mechanism |
| Dimension handling | Medium | Test rotation edge cases |

## Conclusion

The infrastructure for a unified GPU pipeline is already in place. The immediate opportunity is enabling GPU adjustments and tone curve, which are implemented but not used. The unified pipeline coordinator can then be built on top of the proven individual operations.
