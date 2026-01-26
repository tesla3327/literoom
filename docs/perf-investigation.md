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

## Next Steps

### Phase 1: Quick Wins (1-2 days)
1. Implement draft mode (skip histogram/clipping during drag)
2. Integrate existing TexturePool in edit-pipeline.ts
3. Add throttle/debounce to slider interactions

### Phase 2: Async Architecture (3-5 days)
1. Triple-buffered histogram readback
2. GPU-direct histogram rendering
3. Fire-and-forget pattern for non-critical readbacks

### Phase 3: Shader Optimizations (1 week)
1. f16 processing with fallback
2. Subgroup operations with fallback
3. Single-pass adjustment uber-shader

### Phase 4: Advanced (2 weeks)
1. Mipmap-based progressive refinement
2. Tile-based rendering with priority
3. GPU timestamp profiling infrastructure
