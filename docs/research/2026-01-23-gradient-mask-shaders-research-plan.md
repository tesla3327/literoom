# GPU Gradient Mask Shaders Research Plan

**Created**: 2026-01-23 08:56 EST
**Phase**: V1.1 GPU Acceleration Phase 4

## Context

Phase 3 of GPU acceleration (Tone Curve Shader) is complete. Phase 4 will move the linear and radial gradient mask computations to the GPU using WGSL compute shaders. This can provide significant performance improvements since mask evaluation is highly parallel (each pixel computes independently).

### Current State
- **WASM implementation exists**: `crates/literoom-core/src/mask/` contains working linear and radial mask evaluation algorithms
- **GPU infrastructure ready**: `packages/core/src/gpu/` has established patterns for compute pipelines
- **Target performance**: 100ms → 4ms for 2 masks (25x speedup)

## Research Objectives

1. Understand the existing Rust mask implementation algorithms in detail
2. Analyze the existing GPU shader patterns and pipeline architecture
3. Design WGSL shaders that match the Rust implementation output
4. Determine optimal GPU memory layout for mask parameters
5. Plan for multiple mask blending strategies

## Research Areas

### Area 1: Existing Mask Algorithms (Rust Implementation)
**Files to examine**:
- `crates/literoom-core/src/mask/linear.rs` - Linear gradient mask evaluation
- `crates/literoom-core/src/mask/radial.rs` - Radial gradient mask evaluation
- `crates/literoom-core/src/mask/apply.rs` - Mask application with adjustments
- `crates/literoom-core/src/mask/mod.rs` - Module organization

**Questions to answer**:
1. What are the exact mathematical formulas used for linear gradient masks?
2. What are the exact mathematical formulas used for radial gradient masks?
3. How is feathering implemented (smootherstep function details)?
4. How does the invert flag work for radial masks?
5. How are multiple masks combined (blending)?
6. What coordinate system is used (normalized 0-1)?

### Area 2: GPU Pipeline Architecture Analysis
**Files to examine**:
- `packages/core/src/gpu/shaders/adjustments.wgsl` - Reference WGSL shader
- `packages/core/src/gpu/shaders/tone-curve.wgsl` - Reference WGSL shader
- `packages/core/src/gpu/pipelines/adjustments-pipeline.ts` - Pipeline pattern
- `packages/core/src/gpu/pipelines/tone-curve-pipeline.ts` - Pipeline pattern
- `packages/core/src/gpu/texture-utils.ts` - Texture management utilities
- `packages/core/src/gpu/types.ts` - Type definitions

**Questions to answer**:
1. What's the standard pipeline structure (bind groups, uniforms, dispatch)?
2. How are uniform buffers used for passing parameters?
3. What texture formats are used for input/output?
4. How is the workgroup size determined (16×16)?
5. What's the pattern for chaining operations (applyToTextures)?
6. How are complex data structures passed to shaders (uniform arrays)?

### Area 3: WGSL Shader Design Patterns
**External research needed**:
1. WGSL array handling in uniform buffers
2. WebGPU limits on uniform buffer sizes
3. Best practices for dynamic array lengths in compute shaders
4. Storage buffer vs uniform buffer tradeoffs
5. WGSL smoothstep/smootherstep implementation

**Questions to answer**:
1. How to pass variable-length mask arrays to the shader?
2. What's the maximum number of masks we can support in one pass?
3. How to handle per-mask adjustments efficiently?
4. Should we use storage buffers for mask data?
5. How to implement smootherstep in WGSL?

### Area 4: Integration with Existing Edit Pipeline
**Files to examine**:
- `apps/web/app/composables/useEditPreview.ts` - Current pipeline integration
- `packages/core/src/decode/worker-messages.ts` - Current mask message types
- `packages/core/src/decode/decode-worker.ts` - Worker handling of masks

**Questions to answer**:
1. Where in the pipeline are masks currently applied (after tone curve)?
2. How does the GPU pipeline integration need to chain with adjustments/tone curve?
3. What's the current interface for mask data passed to WASM?
4. How should we structure the GPU mask service interface?

### Area 5: Performance Considerations
**Questions to answer**:
1. What's the expected memory bandwidth for mask processing?
2. Should mask evaluation be combined with adjustments in one pass?
3. What's the overhead of multiple shader dispatches vs single combined shader?
4. How to minimize GPU→CPU transfers for chained operations?

## Parallel Research Tasks

Launch 4 sub-agents to research in parallel:

1. **Rust Mask Algorithm Agent**: Deep-dive into Area 1
2. **GPU Pipeline Agent**: Deep-dive into Area 2
3. **WGSL Patterns Agent**: Deep-dive into Area 3 (external + internal)
4. **Integration Agent**: Deep-dive into Area 4

## Expected Outputs

Each research area should produce:
1. Summary of findings
2. Key code snippets or patterns discovered
3. Recommendations for implementation
4. Potential challenges or risks identified

## Success Criteria

Research is complete when we can answer:
1. Exactly how the WGSL shader should implement linear/radial mask evaluation
2. How to pass mask parameters and adjustments to the GPU efficiently
3. How the mask pipeline should integrate with existing GPU services
4. What the TypeScript interface should look like
5. Estimated effort for implementation

## Timeline

- Research plan creation: Iteration 164
- Parallel research execution: Iteration 164 (continued)
- Synthesis document: After research agents complete
- Implementation plan: Next iteration
