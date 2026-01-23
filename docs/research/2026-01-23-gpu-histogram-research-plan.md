# GPU Histogram Computation Research Plan

**Date**: 2026-01-23
**Objective**: Research GPU-accelerated histogram computation for real-time preview updates

## Background

The histogram is computed on every edit preview update. Currently computed in the WASM worker, moving this to GPU would:
- Enable real-time histogram updates during slider drag
- Reduce CPU load during editing
- Complete the GPU edit pipeline

## Research Areas

### Area 1: Current Histogram Implementation
- Analyze `crates/literoom-core/src/histogram.rs` implementation
- Understand data structures (HistogramData, per-channel bins)
- Document current performance characteristics
- Identify clipping detection logic

### Area 2: GPU Histogram Patterns
- Research parallel histogram computation techniques
- Study atomic increment patterns in GPU computing
- Investigate workgroup privatization for reducing contention
- Benchmark different approaches (scatter vs privatization)

### Area 3: WGSL Compute Shader Capabilities
- Document atomic operations available in WGSL
- Understand workgroup shared memory usage
- Research storage buffer vs uniform buffer for histogram bins
- Investigate memory barriers and synchronization

### Area 4: Integration Points
- Analyze `useHistogramDisplay.ts` and `useHistogramDisplaySVG.ts`
- Understand data flow from decode service to histogram components
- Document `DecodeService.computeHistogram()` interface
- Plan GPU service integration pattern

### Area 5: Performance Optimization
- Research parallel reduction algorithms
- Study two-pass histogram techniques (local privatization + global merge)
- Investigate subgroup operations (if available)
- Plan memory layout for optimal access patterns

## Expected Deliverables

1. Research synthesis document (`2026-01-23-gpu-histogram-synthesis.md`)
2. Updated GPU acceleration plan with Phase 5 details
3. Performance comparison table (WASM vs GPU expected)

## Success Criteria

- Clear understanding of GPU histogram algorithms
- Identified optimal WGSL pattern for histogram computation
- Integration plan that matches existing service patterns
- Target: 12ms -> 1ms performance improvement
