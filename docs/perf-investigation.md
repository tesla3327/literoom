# GPU Pipeline Performance Investigation

**Last Updated**: 2026-01-25

## Summary

Performance research for maximizing FPS in the GPU edit pipeline.

## Research Completed

### 2026-01-25: Initial Investigation

**Goal**: Identify opportunities to achieve 60fps real-time preview

**Key Findings**:

1. **Texture pools are unused** - `TexturePool` and `BufferPool` classes exist but aren't integrated. Per-frame allocation costs 1.5-4ms.

2. **Draft mode is a no-op** - The `quality: 'draft' | 'full'` parameter is passed but never acted on. All renders use full resolution.

3. **Histogram readback stalls** - `mapAsync()` blocks for 2-5ms per update. 500ms debounce hides latency but causes visual lag.

4. **No GPU timestamp queries** - All timing uses CPU `performance.now()`, can't measure actual GPU execution time.

**Quick Wins Identified**:
- Skip clipping detection in draft mode: ~10-15ms saved
- Skip histogram in draft mode: ~5-50ms saved
- Integrate texture pooling: ~1.2-2.4ms saved per frame

**Documents Created**:
- `docs/research/perf/2026-01-25-gpu-pipeline-optimization-plan.md`
- `docs/research/perf/2026-01-25-gpu-pipeline-optimization-synthesis.md`

---

### 2026-01-25: Advanced WebGPU Research

**Goal**: Deep research into WebGPU optimization techniques from online sources

**Research Areas Investigated** (10 parallel research agents):
1. Async readback patterns (triple-buffering, staging pools)
2. Half-precision (f16) processing support and best practices
3. WebGPU subgroup operations for histogram reduction
4. GPU-direct histogram rendering without CPU readback
5. Real-time web image editor architectures (Photopea, Figma, Polarr)
6. Texture and buffer pooling best practices
7. Workgroup size optimization across GPU vendors
8. Single-pass uber-shader patterns for image adjustments
9. GPU timestamp queries for profiling
10. Progressive rendering and LOD techniques

**Key Findings**:

1. **Async Readback**: Use staging buffer pool with 3 buffers, fire-and-forget pattern when busy. Check `buffer.mapState` before operations.

2. **f16 Processing**: Available in Chrome 120+. 25-50% faster for memory-bound ops. Safe for color operations (0-1 range), NOT safe for histogram accumulation.

3. **Subgroups**: Shipped in Chrome 134+. `subgroupAdd` provides 2-4x faster reduction. Need atomics fallback for older browsers.

4. **GPU-Direct Histogram**: Render directly from storage buffer via fragment shader. Zero CPU readback needed. Use double-buffer interpolation for smooth transitions.

5. **Pro Editor Techniques**:
   - Figma: C++ to WASM, pre-allocated typed arrays to avoid GC, custom tile-based renderer
   - Photopea: Pure JS + WASM, WebGL for blend modes
   - DaVinci Resolve: On-the-fly resolution reduction, background render cache

6. **Workgroup Size**: Default to 64 threads (8x8). Safe across Intel, AMD, NVIDIA, Apple. Use overridable constants for runtime tuning.

7. **Single-Pass**: Combine per-pixel color ops (exposure, contrast, saturation). Keep spatial ops (blur, sharpen) separate. Watch register pressure (<64 VGPRs).

8. **Progressive Rendering**: Throttle preview updates (100ms), debounce final render (300ms). Use `requestIdleCallback` for refinement.

**Documents Created**:
- `docs/research/perf/2026-01-25-advanced-gpu-optimization-synthesis.md`
- `docs/research/perf/2026-01-25-implementation-research-plan.md`

---

### 2026-01-25: Draft Mode Implementation Research

**Goal**: Complete implementation research for Research Area 1 (Draft Mode)

**Research Conducted** (8 parallel agents):
1. useEditPreview render flow analysis
2. edit-pipeline GPU code exploration
3. Histogram/clipping detection code analysis
4. Online research on draft mode best practices
5. Progressive rendering and mipmap techniques
6. Debounce/throttle timing optimization
7. Slider component flow analysis
8. TexturePool integration potential

**Key Findings**:

1. **Draft mode trigger point**: `useEditPreview.ts` lines 975-977 already sets 'draft' quality but it's UI-only - doesn't affect rendering

2. **Optimal resolution**: 1/2 (50%) is industry standard, provides ~75% performance gain with acceptable quality

3. **Operations to skip in draft**:
   - Histogram computation: 5-50ms savings
   - Clipping detection: 2-5ms readback stall eliminated
   - Both controllable via `AdaptiveProcessor.enabledOperations`

4. **Timing recommendations**:
   - Reduce throttle from 150ms to 33ms for draft renders
   - Add 400ms debounce for full-quality render after interaction ends
   - Touch requires <25ms latency, mouse tolerates up to 60ms

5. **Progressive refinement**: State machine designed with 4 states (idle → interacting → refining → complete)

6. **Expected gains**: Draft render time reduced from 40-147ms to 8-23ms (~85% improvement, enabling 30-60 FPS)

**Documents Created**:
- `docs/research/perf/2026-01-25-draft-mode-implementation-research.md`

---

### 2026-01-25: Async Histogram & TexturePool Research

**Goal**: Complete implementation research for Research Areas 2-4 (HIGH priority)

**Research Conducted** (10 parallel agents):
1. Triple-buffered staging buffer patterns (online research)
2. GPU-direct histogram rendering techniques (online research)
3. Histogram-pipeline.ts current implementation analysis
4. TexturePool implementation analysis
5. Edit-pipeline.ts texture allocation audit
6. Buffer pooling best practices (online research)
7. Figma/Photopea histogram approaches (online research)
8. Clipping detection implementation analysis
9. WebGPU subgroup operations for histogram (online research)
10. WASM histogram implementation analysis

**Key Findings**:

1. **Triple-Buffered Histogram**:
   - Current: Blocking `mapAsync()` creates 2-5ms stalls per frame
   - Solution: `StagingBufferPool` class with 3 buffers (optimal per Metal/Vulkan best practices)
   - Fire-and-forget pattern: Skip readback when pool exhausted, use previous frame data

2. **GPU-Direct Histogram Rendering**:
   - Fragment shader reads directly from storage buffer (zero CPU readback)
   - Double-buffer interpolation with `smoothstep()` for smooth transitions
   - Enables real-time 60fps histogram updates

3. **TexturePool Integration**:
   - Pool exists but is unused in production (lines 214-308 in texture-utils.ts)
   - Current: 240MB GPU memory allocated per frame (5 textures × 48MB)
   - Solution: Integrate pool in edit-pipeline.ts, reduce to ~48MB with reuse

4. **Clipping Detection**:
   - Currently reads full 4KB histogram to detect 8 bytes of data (512:1 overhead)
   - Could create lightweight clipping-only shader for draft mode

5. **Subgroup Operations**:
   - Chrome 134+ supports `subgroupAdd()` for 2-4x faster histogram reduction
   - Fallback to atomics for older browsers

**Documents Created**:
- `docs/research/perf/2026-01-25-async-histogram-texturepool-research.md`

## Next Steps

### Phase 1: Quick Wins - RESEARCH COMPLETE
1. ✅ Draft mode research complete (skip histogram/clipping during drag)
2. ✅ TexturePool integration strategy documented
3. ✅ Throttle/debounce timing researched (33ms draft, 400ms full)

### Phase 2: Async Architecture - RESEARCH COMPLETE
1. ✅ Triple-buffered histogram design complete (StagingBufferPool class)
2. ✅ GPU-direct histogram rendering (WGSL shaders designed)
3. ✅ Fire-and-forget pattern documented

### Phase 3: Shader Optimizations - NEXT
1. [ ] f16 processing research (Research Area 5)
2. [ ] Subgroup operations research (Research Area 6) - preliminary findings included
3. [ ] Single-pass adjustment uber-shader (Research Area 7)

### Phase 4: Advanced
1. [ ] Progressive rendering research (Research Area 8)
2. [ ] Mipmap-based refinement
3. [ ] GPU timestamp profiling infrastructure
