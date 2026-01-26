# GPU Pipeline Implementation Research Plan

**Date**: 2026-01-25
**Goal**: Research implementation details for high-priority optimizations

---

## Overview

Based on the advanced GPU optimization synthesis, this plan focuses on researching implementation details for the most impactful optimizations that can be applied to Literoom's codebase.

---

## Research Area 1: Draft Mode Implementation ✅ COMPLETE

**Priority**: HIGH
**Expected Impact**: 4-16x faster draft renders
**Status**: Research complete - see `2026-01-25-draft-mode-implementation-research.md`

### Questions Answered

1. **Where to trigger draft mode?** → `useEditPreview.ts` lines 975-977 (throttledRender already sets 'draft')
2. **Optimal downsampling factor?** → **1/2 resolution** (industry standard, 75% perf gain)
3. **Progressive refinement?** → **400ms debounce** after interaction ends, state machine designed
4. **GPU vs WASM?** → Both - GPU gets resolution reduction, WASM gets skip flags via AdaptiveProcessor

### Tasks

- [x] Analyze current render flow in useEditPreview.ts
- [x] Identify all operations that can be skipped in draft mode
- [x] Research optimal debounce/throttle timing
- [x] Design progressive refinement state machine

---

## Research Area 2: Triple-Buffered Histogram

**Priority**: HIGH
**Expected Impact**: Eliminate 2-5ms readback stalls

### Questions to Answer

1. How to integrate staging buffer pool with existing histogram-pipeline.ts?
2. What is the optimal pool size (2, 3, 4 buffers)?
3. How to handle fire-and-forget pattern when pool is exhausted?
4. Should histogram update be decoupled from render loop?

### Tasks

- [ ] Profile current mapAsync timing in histogram-pipeline.ts
- [ ] Design buffer pool integration
- [ ] Implement non-blocking readback pattern
- [ ] Test latency vs throughput tradeoffs

---

## Research Area 3: GPU-Direct Histogram Rendering

**Priority**: HIGH
**Expected Impact**: Zero-latency histogram updates

### Questions to Answer

1. How to render histogram overlay without CPU readback?
2. What WebGPU patterns work best for this use case?
3. How to implement smooth animated transitions?
4. How to integrate with existing Vue histogram component?

### Tasks

- [ ] Design histogram render pipeline (storage buffer → render)
- [ ] Create WGSL fragment shader for histogram visualization
- [ ] Implement GPU-side Gaussian smoothing
- [ ] Design double-buffer interpolation system

---

## Research Area 4: TexturePool Integration

**Priority**: HIGH
**Expected Impact**: 1.2-2.4ms saved per frame

### Questions to Answer

1. How to integrate existing TexturePool with edit-pipeline.ts?
2. What pool configuration is optimal (size, eviction policy)?
3. How to handle texture format/size variations?
4. When should textures be destroyed vs pooled?

### Tasks

- [ ] Audit current texture allocation in edit-pipeline.ts
- [ ] Design pool integration strategy
- [ ] Implement pool lifecycle management
- [ ] Benchmark before/after allocation timing

---

## Research Area 5: f16 Processing

**Priority**: MEDIUM
**Expected Impact**: 25-50% faster, 50% less memory

### Questions to Answer

1. Which shaders can safely use f16?
2. How to implement f32 fallback for unsupported devices?
3. What precision issues might arise with tone curves?
4. How to detect and handle f16 support at runtime?

### Tasks

- [ ] Audit all WGSL shaders for f16 compatibility
- [ ] Identify operations requiring f32 precision
- [ ] Design feature detection and fallback strategy
- [ ] Test visual quality on f16 vs f32

---

## Research Area 6: Subgroup Operations

**Priority**: MEDIUM
**Expected Impact**: 2-4x faster histogram reduction

### Questions to Answer

1. How to use subgroupAdd for histogram computation?
2. What fallback is needed for unsupported browsers?
3. How variable subgroup sizes affect the algorithm?
4. Is Chrome 134+ adoption sufficient for production?

### Tasks

- [ ] Research Chrome subgroups implementation status
- [ ] Design histogram kernel with subgroup reduction
- [ ] Implement atomics-based fallback
- [ ] Benchmark subgroup vs atomic performance

---

## Research Area 7: Single-Pass Adjustments

**Priority**: MEDIUM
**Expected Impact**: Reduce memory bandwidth, fewer passes

### Questions to Answer

1. Which adjustment operations can be combined?
2. What is the register pressure of combined shader?
3. How to maintain code modularity with uber-shader?
4. Does single-pass improve or hurt cache performance?

### Tasks

- [ ] Audit current adjustment shader passes
- [ ] Design combined adjustment shader
- [ ] Measure register usage and occupancy
- [ ] Benchmark single-pass vs multi-pass

---

## Research Area 8: Progressive Rendering

**Priority**: MEDIUM
**Expected Impact**: Responsive UI during editing

### Questions to Answer

1. How to implement mipmap-based progressive refinement?
2. What idle detection strategy works best?
3. How to prioritize visible region rendering?
4. How do Lightroom/Capture One handle this?

### Tasks

- [ ] Design mipmap generation strategy
- [ ] Implement requestIdleCallback-based refinement
- [ ] Design priority queue for tile rendering
- [ ] Test perceived responsiveness

---

## Next Steps

1. ~~**Immediate**: Begin Research Area 1 (Draft Mode)~~ ✅ COMPLETE
2. **Immediate**: Research Areas 2-4 (Async patterns, pooling) - Triple-buffered histogram, GPU-direct histogram, TexturePool integration
3. **Short-term**: Research Areas 5-7 (Shader optimizations)
4. **Medium-term**: Research Area 8 (Progressive rendering)

---

## Success Criteria

Each research area is complete when:
1. All questions have been answered with code references
2. Implementation approach is documented
3. Expected performance gains are validated
4. Integration strategy is defined
