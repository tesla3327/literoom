# GPU Pipeline Performance Investigation

**Last Updated**: 2026-01-26

## Summary

Performance research for maximizing FPS in the GPU edit pipeline.

## Current Status: Research Analysis Required

All four research phases are complete. **Next step**: Analyze all research findings across the synthesis documents and determine the highest-priority optimizations to implement.

### Analysis Tasks

1. [ ] Review all synthesis documents and extract prioritized optimization list
2. [ ] Estimate implementation effort vs. performance impact for each optimization
3. [ ] Identify dependencies between optimizations
4. [ ] Create implementation roadmap with quick wins first
5. [ ] Define success metrics and benchmarking approach

### Research Documents to Analyze

| Document | Focus Area |
|----------|------------|
| `2026-01-25-gpu-pipeline-optimization-synthesis.md` | Initial findings, quick wins |
| `2026-01-25-advanced-gpu-optimization-synthesis.md` | WebGPU techniques |
| `2026-01-25-draft-mode-implementation-research.md` | Draft mode details |
| `2026-01-25-async-histogram-texturepool-research.md` | Async patterns, pooling |
| `2026-01-26-shader-optimization-synthesis.md` | f16, subgroups, uber-shader |
| `2026-01-26-phase4-advanced-research-synthesis.md` | Progressive rendering, profiling |

### Priority Criteria

- **Impact**: How much FPS improvement?
- **Effort**: How many days to implement?
- **Risk**: Could it break existing functionality?
- **Dependencies**: What else needs to be done first?

---

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

---

### 2026-01-26: Phase 3 Shader Optimizations Research

**Goal**: Complete research for f16 processing, subgroup operations, and single-pass uber-shader

**Research Conducted** (16 parallel agents):
1. adjustments.wgsl f16 compatibility analysis
2. tone-curve.wgsl precision requirements
3. histogram.wgsl subgroup optimization opportunities
4. masks.wgsl f16 and single-pass potential
5. rotation.wgsl precision analysis
6. Edit pipeline multi-pass flow analysis
7. WebGPU f16 extension browser support
8. f16 color processing accuracy research
9. Chrome subgroups implementation status
10. Subgroup histogram algorithms
11. Uber-shader design patterns
12. GPU register pressure optimization
13. Figma/Canva/Photopea architecture research
14. GPU texture cache optimization
15. WGSL override constants for shader variants
16. Single-pass vs multi-pass tradeoffs

**Key Findings**:

1. **f16 Processing**:
   - Chrome 120+, Safari 26+, Firefox 141+ support `shader-f16`
   - **NOT supported on Qualcomm/Adreno** (hardware limitation)
   - Safe for: exposure, contrast, temperature, tint, saturation (0-1 range)
   - Unsafe for: histogram accumulation, tone curve LUT sampling, feathering smoothstep
   - Expected gains: 25-50% faster, 50% memory bandwidth reduction

2. **Subgroup Operations**:
   - Chrome 134+ stable with `"subgroups"` feature
   - Subgroup sizes: Intel 32, AMD 32/64, NVIDIA 32, Apple 32
   - `subgroupAdd()` enables 2-4x faster histogram reduction
   - Must maintain atomics fallback for older browsers
   - Histogram compute: 2.3ms → 0.8-1.1ms expected

3. **Single-Pass Uber-Shader**:
   - Current: 4 passes, 128 MB bandwidth, 78.8 MB intermediate textures
   - Single-pass: 1 pass, 32 MB bandwidth (75% reduction)
   - Register pressure: ~30-35 VGPRs combined (safe, under 64 limit)
   - Use `@override` constants for compile-time feature flags
   - Rotation MUST remain separate (changes dimensions)
   - Adjustments + Tone Curve + Masks CAN be combined

4. **Professional Editor Patterns**:
   - Figma: Uniform buffer batching, bind group caching, compute shaders
   - Photopea: 15x speedup with WebGL (850ms → 55ms for 10 layers)
   - Common: 300-500MB VRAM budget, LRU texture eviction, separable filters

**Documents Created**:
- `docs/research/perf/2026-01-26-shader-optimization-research-plan.md`
- `docs/research/perf/2026-01-26-shader-optimization-synthesis.md`

---

### 2026-01-26: Phase 4 Advanced Research

**Goal**: Complete research for progressive rendering, mipmap refinement, and GPU profiling

**Research Conducted** (18 parallel agents):
1. Lightroom progressive rendering techniques
2. Capture One rendering architecture
3. DaVinci Resolve proxy/progressive quality
4. WebGPU mipmap generation best practices
5. requestIdleCallback and idle detection patterns
6. Progressive image loading (LQIP, BlurHash, ThumbHash)
7. Texture streaming from game development
8. WebGPU timestamp queries API
9. Chrome DevTools GPU profiling
10. WebGPU profiling libraries (stats-gl, webgpu-utils)
11. Image editor interaction patterns and latency
12. Smooth quality transition techniques
13. GPU memory management and LRU caching
14. Visible region prioritization (quadtree, R-tree)
15. Codebase: preview generation flow analysis
16. Codebase: interaction handling analysis
17. Figma/Canva WebGPU architecture
18. scheduler.postTask() API for priority scheduling

**Key Findings**:

1. **Professional Editor Approaches**:
   - Lightroom: Tiered previews (Minimal → Standard → 1:1), Smart Previews at 2540px
   - Capture One: Draft rendering during drag (temporary 0.5s blur)
   - DaVinci Resolve: Timeline Proxy Mode (on-the-fly 1/2, 1/4, 1/8 res)
   - Figma: Tile-based rendering, batched GPU ops, local edit prioritization

2. **Mipmap Generation**:
   - WebGPU has NO built-in generateMipmap() - must implement manually
   - Memory overhead: exactly 33% extra
   - Compute shader 29-50% faster than render pipeline for 4K+ textures
   - Use explicit LOD selection based on zoom level

3. **GPU Timestamp Profiling**:
   - Use timestampWrites in pass descriptor (writeTimestamp deprecated)
   - Results in nanoseconds via BigUint64Array
   - Default 100μs quantization for security
   - Tools: stats-gl, WebGPU Inspector, PIX (Windows)

4. **Interaction-Aware Rendering**:
   - Current throttle (150ms) = ~6-7 FPS - too slow
   - Research recommends: 33ms for mouse, <25ms for touch
   - Draft mode is UI-only - no actual quality reduction
   - State machine: idle → interacting → refining → complete

5. **Latency Requirements**:
   - Dragging: <33ms perceivable
   - Tapping: <82ms perceivable
   - Touch: <25ms required for responsiveness
   - Animation: <16ms (60fps target)

6. **Memory Management**:
   - WebGPU doesn't expose memory queries directly
   - Use error scopes for OOM detection
   - LRU cache with explicit texture.destroy()
   - Device tier detection via @pmndrs/detect-gpu

7. **Idle Detection**:
   - requestIdleCallback: 50ms max deadline, no Safari support
   - scheduler.postTask(): 3 priority levels, ~82% browser support
   - Dynamic priority via TaskController.setPriority()

**Documents Created**:
- `docs/research/perf/2026-01-26-phase4-advanced-research-plan.md`
- `docs/research/perf/2026-01-26-phase4-advanced-research-synthesis.md`

## Next Steps

### Phase 1: Quick Wins - RESEARCH COMPLETE
1. ✅ Draft mode research complete (skip histogram/clipping during drag)
2. ✅ TexturePool integration strategy documented
3. ✅ Throttle/debounce timing researched (33ms draft, 400ms full)

### Phase 2: Async Architecture - RESEARCH COMPLETE
1. ✅ Triple-buffered histogram design complete (StagingBufferPool class)
2. ✅ GPU-direct histogram rendering (WGSL shaders designed)
3. ✅ Fire-and-forget pattern documented

### Phase 3: Shader Optimizations - RESEARCH COMPLETE
1. ✅ f16 processing research (25-50% faster, fallback needed for Qualcomm)
2. ✅ Subgroup operations research (2-4x faster histogram, Chrome 134+)
3. ✅ Single-pass uber-shader (75% bandwidth reduction, 30-35 VGPRs)

### Phase 4: Advanced - RESEARCH COMPLETE
1. ✅ Progressive rendering (Lightroom/Resolve/Figma patterns documented)
2. ✅ Mipmap-based refinement (compute shader generation, LOD selection)
3. ✅ GPU timestamp profiling (timestampWrites API, stats-gl library)
4. ✅ Interaction-aware rendering (33ms throttle, state machine design)
5. ✅ Memory management (LRU cache, device tier detection)

### Phase 5: Implementation - NEXT
All research phases complete. Ready for implementation:
1. [ ] Implement draft mode (33ms throttle + 1/2 resolution)
2. [ ] Integrate TexturePool
3. [ ] Add GPU timestamp profiling
4. [ ] Implement progressive refinement state machine
5. [ ] Add interaction-aware quality switching
