# Shader Optimization Research Plan

**Date**: 2026-01-26
**Goal**: Complete implementation research for Phase 3 shader optimizations (f16, subgroups, single-pass)

---

## Overview

This plan covers three interconnected shader optimization research areas:
1. **f16 Processing** - Half-precision math for 25-50% speedup
2. **Subgroup Operations** - Hardware-accelerated reductions for histogram
3. **Single-Pass Adjustments** - Combine operations to reduce memory bandwidth

---

## Research Area 5: f16 Processing

**Priority**: MEDIUM
**Expected Impact**: 25-50% faster, 50% less memory bandwidth

### Current State Analysis Required
- Audit all 5 WGSL shaders for f16 compatibility
- Identify which operations need f32 precision (histogram accumulation, tone curves)
- Check current uniform buffer layouts

### Online Research Topics
1. WebGPU f16 extension status (shader-f16 feature)
2. f16 precision limits and color accuracy
3. Runtime feature detection patterns
4. Fallback strategies for unsupported devices

### Key Questions
1. Which shaders can safely use f16? (color ops: yes, accumulation: no)
2. How to implement f32 fallback for unsupported devices?
3. What precision issues might arise with tone curves?
4. How to detect and handle f16 support at runtime?

### Deliverables
- Shader compatibility audit (per-shader, per-operation)
- Feature detection code pattern
- f16 vs f32 quality comparison guidelines
- Migration strategy document

---

## Research Area 6: Subgroup Operations

**Priority**: MEDIUM
**Expected Impact**: 2-4x faster histogram reduction

### Current State Analysis Required
- Review histogram.wgsl for current reduction strategy
- Understand current atomic-based approach
- Check workgroup size configuration

### Online Research Topics
1. Chrome 134+ subgroup operations status
2. subgroupAdd() for histogram reduction
3. Variable subgroup size handling (32 Intel, 64 AMD/NVIDIA)
4. Fallback patterns for older browsers
5. Browser adoption rates for subgroups feature

### Key Questions
1. How to use subgroupAdd for histogram computation?
2. What fallback is needed for unsupported browsers?
3. How do variable subgroup sizes affect the algorithm?
4. Is Chrome 134+ adoption sufficient for production?

### Deliverables
- Subgroup histogram kernel design
- Atomics-based fallback implementation
- Feature detection pattern
- Performance comparison methodology

---

## Research Area 7: Single-Pass Adjustments

**Priority**: MEDIUM
**Expected Impact**: Reduce memory bandwidth, fewer passes

### Current State Analysis Required
- Audit adjustments.wgsl for current structure
- Understand tone-curve.wgsl integration
- Map current multi-pass pipeline flow
- Measure number of texture reads/writes

### Online Research Topics
1. Uber-shader design patterns in WebGPU/WGSL
2. Register pressure optimization techniques
3. WGSL shader variants and specialization constants
4. Cache-friendly image processing patterns
5. Professional image editor shader architectures

### Key Questions
1. Which adjustment operations can be combined?
2. What is the register pressure of combined shader?
3. How to maintain code modularity with uber-shader?
4. Does single-pass improve or hurt cache performance?

### Deliverables
- Combined adjustment shader design
- Register usage analysis
- Code modularity strategy (specialization constants)
- Cache analysis and optimization recommendations

---

## Research Agents to Launch

### Codebase Analysis Agents (6)
1. **adjustments.wgsl Analysis** - f16 compatibility, operation structure
2. **tone-curve.wgsl Analysis** - Precision requirements, integration points
3. **histogram.wgsl Analysis** - Current reduction, subgroup opportunities
4. **masks.wgsl Analysis** - f16 compatibility, combine potential
5. **rotation.wgsl Analysis** - f16 compatibility, sampling precision
6. **Edit Pipeline Flow** - Multi-pass structure, texture usage

### Online Research Agents (10)
7. **WebGPU f16 Extension Status** - Browser support, feature detection
8. **f16 Precision for Color Processing** - Quality/accuracy research
9. **Chrome Subgroups Implementation** - Status, examples, adoption
10. **Subgroup Histogram Algorithms** - Academic papers, best practices
11. **Uber-Shader Design Patterns** - Game/graphics industry techniques
12. **Register Pressure Analysis** - WGSL/WebGPU specific guidance
13. **Figma/Canva Shader Architecture** - Professional web editor techniques
14. **GPU Cache Optimization** - Texture cache behavior, bandwidth
15. **WGSL Specialization Constants** - Override constants, shader variants
16. **Image Processing Pipeline Patterns** - Single vs multi-pass tradeoffs

---

## Success Criteria

Each research area complete when:
1. All codebase files audited with specific line references
2. All questions answered with evidence
3. Implementation approach documented
4. Expected performance gains quantified
5. Integration strategy defined

---

## Timeline

- Create plan: ✓
- Launch parallel research agents: Now
- Synthesize findings: After agent completion
- Update perf-investigation.md: After synthesis
