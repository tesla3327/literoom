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

## Research Area 2: Triple-Buffered Histogram ✅ COMPLETE

**Priority**: HIGH
**Expected Impact**: Eliminate 2-5ms readback stalls
**Status**: Research complete - see `2026-01-25-async-histogram-texturepool-research.md`

### Questions Answered

1. **How to integrate staging buffer pool?** → `StagingBufferPool` class with acquire/release pattern
2. **Optimal pool size?** → **3 buffers** (triple-buffering) - best tradeoff per Metal/Vulkan best practices
3. **Fire-and-forget when exhausted?** → Skip readback, use previous frame's data (Vello pattern)
4. **Decouple from render loop?** → Yes, use async callbacks with `computeAsync()` method

### Tasks

- [x] Profile current mapAsync timing in histogram-pipeline.ts
- [x] Design buffer pool integration
- [x] Implement non-blocking readback pattern
- [x] Test latency vs throughput tradeoffs

---

## Research Area 3: GPU-Direct Histogram Rendering ✅ COMPLETE

**Priority**: HIGH
**Expected Impact**: Zero-latency histogram updates
**Status**: Research complete - see `2026-01-25-async-histogram-texturepool-research.md`

### Questions Answered

1. **Render without readback?** → Fragment shader reads directly from storage buffer
2. **Best WebGPU patterns?** → Bind compute output as fragment input, fullscreen quad rendering
3. **Smooth transitions?** → Double-buffer interpolation with `smoothstep()` easing in shader
4. **Vue integration?** → `GPUHistogramRenderer` class sharing buffer with compute pipeline

### Tasks

- [x] Design histogram render pipeline (storage buffer → render)
- [x] Create WGSL fragment shader for histogram visualization
- [x] Implement GPU-side Gaussian smoothing
- [x] Design double-buffer interpolation system

---

## Research Area 4: TexturePool Integration ✅ COMPLETE

**Priority**: HIGH
**Expected Impact**: 1.2-2.4ms saved per frame
**Status**: Research complete - see `2026-01-25-async-histogram-texturepool-research.md`

### Questions Answered

1. **How to integrate?** → Replace `createTextureFromPixels()` with `pool.acquire()` + `writeTexture()`
2. **Optimal configuration?** → Size 8, FIFO eviction (existing implementation)
3. **Format/size variations?** → Pool keys by `${width}x${height}:${usage}` automatically
4. **When to destroy vs pool?** → Pool during edit session, `clear()` on pipeline destroy

### Tasks

- [x] Audit current texture allocation in edit-pipeline.ts
- [x] Design pool integration strategy
- [x] Implement pool lifecycle management
- [x] Benchmark before/after allocation timing

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
2. ~~**Immediate**: Research Areas 2-4 (Async patterns, pooling)~~ ✅ COMPLETE
3. **Next**: Research Areas 5-7 (Shader optimizations) - f16 processing, subgroups, single-pass uber-shader
4. **Medium-term**: Research Area 8 (Progressive rendering)

---

## Success Criteria

Each research area is complete when:
1. All questions have been answered with code references
2. Implementation approach is documented
3. Expected performance gains are validated
4. Integration strategy is defined
