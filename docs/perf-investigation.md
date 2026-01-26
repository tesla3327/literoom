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

## Next Steps

1. Implement draft mode optimizations (skip clipping/histogram)
2. Integrate TexturePool in edit-pipeline.ts
3. Add downsampled processing for draft renders
4. Implement async histogram with triple-buffering
