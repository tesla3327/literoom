# GPU Pipeline Performance Optimization Research Plan

**Date**: 2026-01-25
**Goal**: Maximize FPS in the GPU edit pipeline to achieve 60fps real-time preview

---

## Executive Summary

This research plan investigates performance optimizations for Literoom's WebGPU edit pipeline. Based on initial research, the current unified GPU pipeline processes images with single upload/readback, but there are significant opportunities for improvement in several areas.

### Current State

- **Unified GPU Pipeline**: Chains rotation → adjustments → tone curve → masks with single GPU round-trip
- **Texture Infrastructure**: TexturePool, BufferPool, DoubleBufferedTextures exist but underutilized
- **Histogram**: Uses workgroup privatization pattern
- **Adaptive Processor**: Routes between GPU and WASM based on capabilities

### Performance Targets

| Metric | Current (est.) | Target | Improvement Needed |
|--------|----------------|--------|-------------------|
| Full render | ~50-100ms | <16ms | 3-6x |
| Slider interaction | 150ms throttle | <16ms (60fps) | 10x |
| Histogram update | ~10ms | <2ms | 5x |
| GPU↔CPU transfers | 1 per render | 0 (async) | Eliminate stalls |

---

## Research Areas

### Area 1: Texture Pool Integration (Priority: HIGH)

**Objective**: Reduce texture allocation overhead by reusing textures across renders

**Investigation Tasks**:
1. Profile current texture allocation patterns in edit-pipeline.ts
2. Measure texture creation/destruction overhead per render
3. Implement texture pool integration for ping-pong textures
4. Benchmark before/after performance

**Expected Outcome**: 10-20% improvement in render time by eliminating per-render allocation

---

### Area 2: Async Readback Pattern (Priority: HIGH)

**Objective**: Eliminate GPU stalls by implementing async readback with ring buffers

**Investigation Tasks**:
1. Research WebGPU fence/timeline patterns
2. Implement double/triple buffer staging strategy
3. Process previous frame's histogram while current frame renders
4. Measure latency vs throughput tradeoffs

**Key Patterns to Implement**:
- Ring buffer with N=2-3 frames
- `mapAsync()` with deferred processing
- Frame overlap for CPU-GPU parallelism

**Expected Outcome**: Eliminate readback stalls, trading 1-2 frame latency for consistent 60fps

---

### Area 3: Half-Precision (f16) Processing (Priority: MEDIUM)

**Objective**: Reduce memory bandwidth by using f16 for intermediate operations

**Investigation Tasks**:
1. Check WebGPU f16 support status (`shader-f16` feature)
2. Identify operations that don't require f32 precision
3. Implement f16 variants of adjustment shaders
4. Validate visual quality vs original
5. Benchmark memory bandwidth improvement

**Expected Outcome**: 30-50% memory bandwidth reduction, potential 2x shader throughput

---

### Area 4: Subgroup Operations (Priority: MEDIUM)

**Objective**: Use hardware-level parallelism for reduction operations

**Investigation Tasks**:
1. Check Chrome 125+ subgroup support availability
2. Implement subgroup-based histogram reduction
3. Test subgroup shuffle for tone curve LUT generation
4. Fallback strategy for unsupported browsers

**Expected Outcome**: 2-4x faster histogram computation, reduced workgroup overhead

---

### Area 5: Workgroup Size Tuning (Priority: LOW)

**Objective**: Optimize workgroup dimensions for target hardware

**Investigation Tasks**:
1. Profile current 16x16 workgroup on different GPUs
2. Test 8x8 (256 threads) configuration
3. Use overridable constants for runtime tuning
4. Test on integrated vs discrete GPUs

**Expected Outcome**: 5-15% improvement on specific hardware

---

### Area 6: Single-Pass Multi-Operation (Priority: LOW)

**Objective**: Combine multiple shader passes into single pass where possible

**Investigation Tasks**:
1. Profile current multi-pass overhead
2. Evaluate combining adjustments + tone curve into single shader
3. Measure instruction cache vs memory bandwidth tradeoff
4. Test uber-shader approach

**Expected Outcome**: Reduce dispatch overhead for simple operations

---

### Area 7: GPU-Direct Histogram Display (Priority: MEDIUM)

**Objective**: Render histogram directly on GPU without CPU readback

**Investigation Tasks**:
1. Design vertex shader for histogram bar rendering
2. Store histogram bins in GPU buffer (no readback)
3. Render histogram overlay in same pass as preview
4. Implement smooth animated transitions

**Expected Outcome**: Zero-latency histogram updates, eliminate 10ms+ readback

---

### Area 8: Draft Quality Mode Optimization (Priority: MEDIUM)

**Objective**: Optimize draft render during slider drag

**Investigation Tasks**:
1. Implement downsampled processing (1/4 resolution) during drag
2. Skip non-essential operations (clipping detection, histogram)
3. Use simpler interpolation for rotation
4. Progressive refinement on mouse up

**Expected Outcome**: 4-16x faster draft renders, sub-5ms slider response

---

## Implementation Phases

### Phase 1: Low-Hanging Fruit (Week 1)
- Area 1: Texture Pool Integration
- Area 8: Draft Quality Mode

### Phase 2: Async Architecture (Week 2)
- Area 2: Async Readback Pattern
- Area 7: GPU-Direct Histogram

### Phase 3: Shader Optimizations (Week 3)
- Area 3: Half-Precision Processing
- Area 4: Subgroup Operations (if supported)

### Phase 4: Fine Tuning (Week 4)
- Area 5: Workgroup Size Tuning
- Area 6: Single-Pass Multi-Operation

---

## Success Metrics

1. **60fps Slider Interaction**: Preview updates within 16ms during drag
2. **Histogram Latency**: <2ms from render completion to display
3. **Memory Efficiency**: <50MB GPU memory for typical session
4. **Browser Compatibility**: Maintain WASM fallback with no regressions

---

## Research Sources

### Core References
- [WebGPU Speed and Optimization](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)
- [WebGPU Compute Shaders - Histogram](https://webgpufundamentals.org/webgpu/lessons/webgpu-compute-shaders-histogram.html)
- [Chrome WebGPU 2.0 Performance](https://markaicode.com/webgpu-2-chrome-performance-2025/)
- [Toji.dev WebGPU Best Practices](https://toji.dev/webgpu-best-practices/)

### Library References
- [LYGIA Shader Library](https://github.com/patriciogonzalezvivo/lygia)
- [glfx.js Image Effects](https://evanw.github.io/glfx.js/)
- [Photopea Architecture](https://blog.photopea.com/)

### Advanced Techniques
- [Subgroup Operations Proposal](https://github.com/gpuweb/webgpu/blob/main/proposals/subgroups.md)
- [Timeline Fences Design](https://github.com/gpuweb/gpuweb/blob/main/design/TimelineFences.md)
- [Halide GPU Scheduling](https://halide-lang.org/)

---

## Next Steps

1. **Immediate**: Begin Area 1 (Texture Pool Integration) research
2. **Profile**: Instrument current pipeline with GPU timestamp queries
3. **Benchmark**: Establish baseline metrics for all target operations
