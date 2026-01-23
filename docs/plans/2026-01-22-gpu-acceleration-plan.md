# GPU Acceleration Implementation Plan

**Date**: 2026-01-22
**Based on**: `docs/research/2026-01-22-gpu-acceleration-research.md`
**Target Version**: v1.1

## Overview

This plan implements WebGPU-based GPU acceleration as an optional enhancement layer for Literoom. The current WASM pipeline remains the primary/fallback path, with GPU acceleration providing 10-160x performance improvements when available.

## Goals

1. Enable real-time 60fps preview updates during slider interaction
2. Speed up batch thumbnail processing by 100x+
3. Maintain full compatibility with non-WebGPU browsers via WASM fallback
4. Lay groundwork for future ML-based masks (v2.0)

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Vue.js UI Component (Main Thread)                      │
│  - Edit Panel (sliders)                                 │
│  - Preview Canvas                                       │
│  - Histogram Display                                    │
└─────────────────────┬───────────────────────────────────┘
                      │
┌─────────────────────┴───────────────────────────────────┐
│  AdaptiveProcessor (Main Thread)                        │
│  - Detects WebGPU availability                          │
│  - Routes operations to GPU or WASM                     │
│  - Handles errors and fallback                          │
├─────────────────────┬───────────────────────────────────┤
│                     │                                   │
│   GPU Path          │      WASM Path (Existing)         │
│   ┌─────────────┐   │      ┌─────────────────────┐      │
│   │ GPUService  │   │      │ DecodeWorker        │      │
│   │ - wgpu init │   │      │ - decode/encode     │      │
│   │ - shaders   │   │      │ - adjustments       │      │
│   │ - pipelines │   │      │ - tone curve        │      │
│   └─────────────┘   │      │ - masks             │      │
│                     │      └─────────────────────┘      │
└─────────────────────┴───────────────────────────────────┘
```

## Phases

### Phase 1: Infrastructure & Detection (Foundation) ✅ COMPLETE

**Objective**: Set up wgpu infrastructure and capability detection

**Tasks**:
1. ~~Add wgpu dependency to `crates/literoom-wasm/Cargo.toml`~~ (Deferred - using browser WebGPU API)
2. ✅ Create `GPUCapabilities` detection service in TypeScript
3. ✅ Create `AdaptiveProcessor` routing layer
4. ✅ Add feature flag for GPU acceleration opt-in
5. ✅ Implement graceful fallback to WASM

**Files Created**:
- ✅ `packages/core/src/gpu/types.ts` - GPU types and error handling
- ✅ `packages/core/src/gpu/capabilities.ts` - WebGPU detection
- ✅ `packages/core/src/gpu/adaptive-processor.ts` - Operation routing
- ✅ `packages/core/src/gpu/index.ts` - Exports

**Files Modified**:
- ✅ `packages/core/src/index.ts` - Export GPU module
- ✅ `packages/core/package.json` - Add GPU subpath export and @webgpu/types
- ✅ `packages/core/tsconfig.json` - Add @webgpu/types reference
- ✅ `apps/web/app/plugins/catalog.client.ts` - Initialize GPU on startup

**Acceptance Criteria**:
- [x] WebGPU availability detected correctly
- [x] Fallback to WASM works when WebGPU unavailable
- [x] Feature flag controls GPU usage (forceDisabled option)
- [x] No regressions in existing functionality (646 tests pass, build succeeds)

### Phase 2: Basic Adjustments Shader ✅ COMPLETE

**Objective**: Move basic adjustments (exposure, contrast, saturation, etc.) to GPU

**Tasks**:
1. ✅ Create WGSL shader for all 10 basic adjustments
2. ✅ Create TypeScript GPU pipeline wrapper
3. ✅ Implement texture upload/download
4. ✅ Wire into AdaptiveProcessor
5. ⏳ Add performance benchmarking (Next iteration)

**Files Created**:
- ✅ `packages/core/src/gpu/shaders/adjustments.wgsl` - WGSL shader code
- ✅ `packages/core/src/gpu/shaders/index.ts` - Shader source exports
- ✅ `packages/core/src/gpu/pipelines/adjustments-pipeline.ts` - Pipeline wrapper
- ✅ `packages/core/src/gpu/pipelines/index.ts` - Pipeline exports
- ✅ `packages/core/src/gpu/texture-utils.ts` - Texture utilities
- ✅ `packages/core/src/gpu/gpu-adjustments-service.ts` - High-level service

**Files Modified**:
- ✅ `packages/core/src/gpu/index.ts` - Export new modules
- ✅ `packages/core/src/gpu/capabilities.ts` - Fix adapter type casting

**Performance Target**: 180ms → 8ms for 2560×1440 preview (22x speedup)

**Acceptance Criteria**:
- [x] All 10 adjustments shader implemented matching Rust algorithms
- [x] GPU pipeline wrapper with texture upload/download
- [ ] Performance meets or exceeds target (pending integration testing)
- [ ] Works in Chrome, Edge, Firefox (where supported)

### Phase 3: Tone Curve Shader ✅ COMPLETE

**Objective**: Move LUT-based tone curve application to GPU

**Tasks**:
1. ✅ Create WGSL shader for 1D LUT sampling
2. ✅ Upload tone curve LUT as 1D texture
3. ✅ Chain after adjustments shader (applyToTextures method)
4. ⏳ Benchmark combined pipeline (pending integration testing)

**Files Created**:
- ✅ `packages/core/src/gpu/shaders/tone-curve.wgsl` - WGSL shader code
- ✅ `packages/core/src/gpu/pipelines/tone-curve-pipeline.ts` - Pipeline wrapper
- ✅ `packages/core/src/gpu/gpu-tone-curve-service.ts` - High-level service

**Files Modified**:
- ✅ `packages/core/src/gpu/shaders/index.ts` - Export shader source
- ✅ `packages/core/src/gpu/pipelines/index.ts` - Export pipeline
- ✅ `packages/core/src/gpu/index.ts` - Export service

**Performance Target**: 15ms → 1ms (15x speedup)

**Acceptance Criteria**:
- [x] WGSL shader implemented with 1D LUT texture sampling
- [x] LUT caching to avoid redundant uploads
- [x] Identity LUT fast-path (skip processing)
- [ ] Tone curve output matches WASM implementation (pending integration testing)
- [ ] LUT interpolation is smooth (hardware linear filtering)

### Phase 4: Gradient Mask Shaders

**Objective**: Move linear and radial gradient masks to GPU

**Tasks**:
1. Create WGSL shader for linear gradient evaluation
2. Create WGSL shader for radial gradient evaluation
3. Implement mask blending pipeline
4. Support multiple masks
5. Benchmark mask processing

**Files to Create**:
- `crates/literoom-wasm/src/shaders/linear_mask.wgsl`
- `crates/literoom-wasm/src/shaders/radial_mask.wgsl`
- `packages/core/src/gpu/pipelines/mask-pipeline.ts`

**Performance Target**: 100ms → 4ms for 2 masks (25x speedup)

**Acceptance Criteria**:
- [ ] Linear mask matches WASM implementation
- [ ] Radial mask matches WASM implementation
- [ ] Feathering is smooth
- [ ] Multiple masks composite correctly

### Phase 5: Histogram Computation

**Objective**: Move histogram computation to GPU

**Tasks**:
1. Create WGSL compute shader with atomic histogram bins
2. Implement workgroup privatization for performance
3. Read back histogram data to CPU
4. Update histogram display component

**Files to Create**:
- `crates/literoom-wasm/src/shaders/histogram.wgsl`
- `packages/core/src/gpu/pipelines/histogram-pipeline.ts`

**Performance Target**: 12ms → 1ms (12x speedup)

**Acceptance Criteria**:
- [ ] Histogram values match WASM implementation
- [ ] Per-channel (RGB) histograms correct
- [ ] Luminance histogram correct

### Phase 6: Transform Operations

**Objective**: Move rotation and resize to GPU

**Tasks**:
1. Create WGSL shader for bilinear resize
2. Create WGSL shader for rotation with interpolation
3. Implement double-buffered texture pattern
4. Benchmark transform operations

**Files to Create**:
- `crates/literoom-wasm/src/shaders/resize.wgsl`
- `crates/literoom-wasm/src/shaders/rotation.wgsl`
- `packages/core/src/gpu/pipelines/transform-pipeline.ts`

**Performance Target**:
- Resize: 420ms → 12ms (35x speedup)
- Rotation: 850ms → 8ms (106x speedup)

**Acceptance Criteria**:
- [ ] Resize quality matches Lanczos3 (or acceptable bilinear)
- [ ] Rotation handles arbitrary angles
- [ ] Edge handling (transparent/repeat) works correctly

### Phase 7: Pipeline Integration

**Objective**: Connect all GPU operations into cohesive edit preview pipeline

**Tasks**:
1. Create `GPUEditPipeline` that chains all operations
2. Implement texture ping-pong for multi-stage processing
3. Minimize GPU→CPU transfers (only for display/histogram)
4. Add real-time preview mode during slider drag

**Files to Create**:
- `packages/core/src/gpu/pipelines/edit-pipeline.ts`

**Files to Modify**:
- `apps/web/app/composables/useEditPreview.ts` - Use GPU pipeline

**Performance Target**: Full pipeline under 16ms for 60fps preview

**Acceptance Criteria**:
- [ ] Slider drag shows real-time updates
- [ ] No visual artifacts or flickering
- [ ] Memory usage stays bounded

### Phase 8: UI Integration & Polish

**Objective**: Complete integration with UI components

**Tasks**:
1. Add GPU status indicator to UI
2. Add settings toggle for GPU acceleration
3. Implement error recovery UI
4. Add performance metrics display (dev mode)
5. Update help modal with GPU info

**Files to Modify**:
- `apps/web/app/components/edit/EditControlsPanel.vue` - Add GPU indicator
- Settings component (if exists)
- Help modal

**Acceptance Criteria**:
- [ ] User can enable/disable GPU acceleration
- [ ] GPU status is visible
- [ ] Errors show helpful messages

### Phase 9: Testing & Documentation

**Objective**: Ensure reliability and document the feature

**Tasks**:
1. Add unit tests for GPU capability detection
2. Add integration tests for GPU pipelines
3. Add E2E tests with GPU enabled/disabled
4. Document GPU acceleration feature
5. Update README with GPU requirements

**Files to Create**:
- `packages/core/src/gpu/capabilities.test.ts`
- `packages/core/src/gpu/pipelines/*.test.ts`
- `apps/web/e2e/gpu-acceleration.spec.ts` (optional)

**Acceptance Criteria**:
- [ ] All GPU code has test coverage
- [ ] E2E tests pass with both GPU and WASM paths
- [ ] Documentation is complete

## Dependencies

### Rust/WASM
```toml
[dependencies]
wgpu = "0.28"
```

### TypeScript
```json
{
  "dependencies": {
    "@webgpu/types": "^0.1.40"
  }
}
```

## Fallback Strategy

```
Tier 1: WebGPU (best performance)
   ↓ (if unavailable or fails)
Tier 2: WASM (guaranteed to work)
```

At each operation:
1. Check if GPU pipeline is available and healthy
2. Try GPU path
3. On error, log and fall back to WASM
4. Continue with WASM for rest of session

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WebGPU not available | Low (23%) | Low | WASM fallback |
| GPU driver issues | Low | Medium | Error handling, fallback |
| wgpu API changes | Medium | Low | Version pinning |
| Performance regression | Low | Medium | Benchmarking, A/B testing |
| Memory issues | Medium | Medium | Resolution limits |

## Success Metrics

| Metric | Current (WASM) | Target (GPU) | Improvement |
|--------|----------------|--------------|-------------|
| Preview update | 307ms | <16ms | 19x+ |
| Histogram update | 12ms | <2ms | 6x+ |
| Transform operations | ~1s | <20ms | 50x+ |
| Slider interaction | Throttled | Real-time 60fps | Qualitative |

## Timeline Estimate

| Phase | Estimated Effort |
|-------|-----------------|
| Phase 1: Infrastructure | 1 iteration |
| Phase 2: Adjustments | 1 iteration |
| Phase 3: Tone Curve | 1 iteration |
| Phase 4: Masks | 1-2 iterations |
| Phase 5: Histogram | 1 iteration |
| Phase 6: Transforms | 1 iteration |
| Phase 7: Integration | 1-2 iterations |
| Phase 8: UI | 1 iteration |
| Phase 9: Testing | 1 iteration |
| **Total** | **9-11 iterations** |

## Open Questions

1. Should wgpu be compiled to WASM or use browser's native WebGPU API directly?
   - **Recommendation**: Use browser's native WebGPU API via web-sys for simpler integration and smaller bundle size

2. Should we support WebGL2 as intermediate tier between WebGPU and WASM?
   - **Recommendation**: Skip for v1.1, evaluate based on user feedback

3. What resolution limits should we set for GPU processing?
   - **Recommendation**: 8192×8192 max (covers 60MP images)

## Notes

- Start with Phase 1 infrastructure - this sets up the routing and fallback mechanisms
- Each subsequent phase can be developed and shipped independently
- Performance should be measured on real hardware, not just development machines
- Consider adding telemetry to track GPU usage and errors in production
