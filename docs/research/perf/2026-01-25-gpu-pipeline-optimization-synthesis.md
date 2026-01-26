# GPU Pipeline Performance Optimization - Research Synthesis

**Date**: 2026-01-25
**Phase**: Initial Performance Investigation

---

## Executive Summary

This synthesis consolidates research into four key areas for GPU pipeline optimization. The investigation revealed several significant opportunities:

| Finding | Current Impact | Potential Gain |
|---------|---------------|----------------|
| Texture pools unused | 1.5-4ms per frame | 1.2-2.4ms saved |
| Draft mode is no-op | Full resolution always | 3-5x faster drafts |
| Histogram readback stalls | 2-5ms blocking | Zero-stall async |
| No GPU timestamp queries | CPU timing only | Hardware-level profiling |

**Key Discovery**: Existing infrastructure (TexturePool, BufferPool, draft quality parameter) is implemented but completely unused in production code.

---

## Area 1: Texture Pool Integration

### Current State

- **TexturePool class**: Fully implemented at `texture-utils.ts:214-308`
- **BufferPool class**: Fully implemented at `texture-utils.ts:313-371`
- **Status**: Both are **production-ready but NEVER USED**

### Bottleneck Analysis

Per-render texture allocation in `edit-pipeline.ts:process()`:

| Location | Type | Per-Frame Cost |
|----------|------|----------------|
| Lines 190-197 | Input texture upload | 0.3-0.8ms |
| Lines 220-226 | Rotation output | 0.3-0.8ms |
| Lines 254-260 | Adjustments output | 0.3-0.8ms |
| Lines 289-295 | Tone curve output | 0.3-0.8ms |
| Lines 320-326 | Masks output | 0.3-0.8ms |
| Lines 359-362 | Destruction | 0.25-0.75ms |

**Total per frame**: 1.5-4.0ms (14-37% of 11ms budget for 90fps)

### Recommended Fix

1. Add `TexturePool` as instance field in `GPUEditPipeline`
2. Replace `createOutputTexture()` calls with `pool.acquire()`
3. Replace `.destroy()` calls with `pool.release()`

**Expected Improvement**: 1.2-2.4ms per frame (12-22% reduction)

---

## Area 2: Draft Quality Mode

### Current State

- **Draft parameter exists**: `useEditPreview.ts:592` accepts `quality: 'draft' | 'full'`
- **Throttled render**: 150ms between updates during drag
- **Status**: Quality parameter is **ACCEPTED BUT NEVER USED**

### What's Missing

The draft mode should but doesn't:
1. Downsample to 1/4 resolution (2x factor)
2. Skip clipping detection
3. Skip histogram computation
4. Use simpler interpolation

### Current Costs (Full Resolution Every Render)

| Operation | Time | Skip in Draft? |
|-----------|------|----------------|
| Full GPU pipeline | ~50-100ms | Downsample |
| Clipping detection | ~10-15ms | YES |
| Histogram | ~5-50ms | YES |

### Recommended Fix

```typescript
// In renderPreview(), add:
if (quality === 'draft') {
  // 1. Downsample pixels to 1/4 resolution
  // 2. Skip clipping detection entirely
  // 3. Skip histogram computation
}
```

**Expected Improvement**: 3-5x faster draft renders (~15-30ms vs 65-165ms)

---

## Area 3: Async Histogram Pattern

### Current State

- **GPU histogram**: `histogram-pipeline.ts` uses workgroup privatization
- **Readback stall**: Lines 206-209 block on `mapAsync()`
- **Debounce**: 500ms delay in `useHistogramDisplay.ts:38`

### Primary Bottleneck

```typescript
// histogram-pipeline.ts:207 - BLOCKS HERE
await stagingBuffer.mapAsync(GPUMapMode.READ)
```

This synchronous readback blocks JavaScript for 2-5ms per histogram update.

### Recommended Architecture

**Phase 1: Triple-Buffered Readback**
- Use 3 staging buffers rotating
- Read previous frame's data while current frame computes
- Eliminate blocking with frame overlap

**Phase 2: GPU-Direct Histogram Rendering**
- Render histogram bars directly from GPU storage buffer
- No CPU readback needed for display
- Smooth bin values in GPU shader (11-tap Gaussian)

**Expected Improvement**:
- Phase 1: Reduce stall from 2-5ms to ~500µs
- Phase 2: Zero stall, 60fps histogram updates

---

## Area 4: GPU Timing Infrastructure

### Current State

- **Timing source**: CPU-side `performance.now()` only
- **Granularity**: ~1ms, measures total operation time
- **Breakdown**: 7 stages tracked (upload, rotation, adjustments, toneCurve, masks, readback, total)

### Limitations

1. Cannot distinguish GPU compute from readback time
2. No per-shader timing visibility
3. No hardware-level GPU profiling
4. Timing includes driver overhead

### Recommended Improvements

**Immediate (Low Effort)**:
- Add breakdown of readback time into sync vs. transfer
- Measure CPU overhead for texture/buffer creation
- Log detailed timing in console for debugging

**Medium Term (WebGPU Timestamp Queries)**:
```typescript
const querySet = device.createQuerySet({ type: 'timestamp', count: 2 })
encoder.writeTimestamp(querySet, 0) // Before compute
dispatchWorkgroups(...)
encoder.writeTimestamp(querySet, 1) // After compute
```

---

## Implementation Priority

### Phase 1: Quick Wins (Immediate)

| Task | Effort | Impact | Files |
|------|--------|--------|-------|
| Skip clipping in draft | 1 hour | 10-15ms saved | useEditPreview.ts |
| Skip histogram in draft | 1 hour | 5-50ms saved | useHistogramDisplay.ts |
| Add TexturePool to edit-pipeline | 2 hours | 1.2-2.4ms saved | edit-pipeline.ts |

### Phase 2: Draft Mode (Short-term)

| Task | Effort | Impact | Files |
|------|--------|--------|-------|
| Implement downsampling | 4 hours | 4x fewer pixels | texture-utils.ts, useEditPreview.ts |
| Progressive refinement | 2 hours | Better UX | useEditPreview.ts |

### Phase 3: Async Pipeline (Medium-term)

| Task | Effort | Impact | Files |
|------|--------|--------|-------|
| Triple-buffered histogram | 4 hours | Zero stall | histogram-pipeline.ts |
| GPU-direct histogram render | 8 hours | 60fps histogram | New shader, composable |

---

## Key Code Locations

### Texture Pool Integration
- Pool classes: `packages/core/src/gpu/texture-utils.ts:214-371`
- Integration target: `packages/core/src/gpu/pipelines/edit-pipeline.ts:190-362`

### Draft Mode Implementation
- Quality parameter: `apps/web/app/composables/useEditPreview.ts:592`
- Throttle: `apps/web/app/composables/useEditPreview.ts:975-977`
- Clipping: `apps/web/app/composables/useEditPreview.ts:926-927`
- Histogram skip: `apps/web/app/composables/useHistogramDisplay.ts:641-651`

### Async Histogram
- Readback stall: `packages/core/src/gpu/pipelines/histogram-pipeline.ts:207`
- Debounce: `apps/web/app/composables/useHistogramDisplay.ts:38`

### GPU Timing
- Timing collection: `packages/core/src/gpu/pipelines/edit-pipeline.ts:160-375`
- Store: `apps/web/app/stores/gpuStatus.ts`
- UI: `apps/web/app/components/gpu/GPUPerformanceBadge.vue`

---

## Success Metrics

1. **Slider Responsiveness**: <16ms draft renders (60fps)
2. **Histogram Latency**: <2ms from render to display
3. **Memory Efficiency**: Reduce per-frame allocation by 80%
4. **Full Render**: <50ms total pipeline time

---

## References

### External Research
- [WebGPU Speed and Optimization](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)
- [Subgroup Operations Proposal](https://github.com/gpuweb/webgpu/blob/main/proposals/subgroups.md)
- [Timeline Fences Design](https://github.com/gpuweb/gpuweb/blob/main/design/TimelineFences.md)
- [LYGIA Shader Library](https://github.com/patriciogonzalezvivo/lygia)

### Internal Documentation
- [GPU Acceleration Research](../2026-01-22-gpu-acceleration-research.md)
- [GPU Pipeline Integration Synthesis](../2026-01-23-gpu-pipeline-integration-synthesis.md)
