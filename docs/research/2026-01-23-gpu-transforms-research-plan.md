# GPU Transform Operations Research Plan

**Date**: 2026-01-23
**Goal**: Research GPU-accelerated rotation and resize for the Literoom edit preview pipeline

## Overview

Phase 6 of GPU acceleration implements transform operations (rotation and resize) on the GPU. Currently these use WASM and are the slowest operations in the pipeline:
- Resize: ~420ms for 2560×1440
- Rotation: ~850ms for 2560×1440 with arbitrary angle

## Research Areas

### Area 1: Current WASM Transform Implementation
**Questions**:
- How is rotation implemented in Rust? (bilinear vs Lanczos3 interpolation)
- How is resize implemented? (filter types)
- What are the input/output formats?
- What parameters control transform behavior?
- How is crop handled with rotation?

**Files to Examine**:
- `crates/literoom-core/src/transform.rs`
- `crates/literoom-wasm/src/lib.rs` (WASM bindings)
- Any transform-related types

### Area 2: GPU Resize Shader Patterns
**Questions**:
- What interpolation methods work well on GPU?
- How does bilinear vs bicubic quality compare to Lanczos?
- What is the typical shader structure for resize?
- How to handle aspect ratio changes?
- What are common performance optimizations?

**Sources**:
- WebGPU samples and tutorials
- OpenGL/WebGL resize shader patterns
- GPU.js examples

### Area 3: GPU Rotation Shader Patterns
**Questions**:
- How to compute rotation matrix in WGSL?
- How to handle coordinate transformation?
- What interpolation method for rotated pixel sampling?
- How to handle edges/bounds checking?
- How to determine output dimensions for rotated image?

**Sources**:
- WGSL rotation shader examples
- Image rotation algorithm references
- GPU texture sampling patterns

### Area 4: WebGPU Texture Handling for Transforms
**Questions**:
- How to handle render-to-texture for transforms?
- What texture format to use for intermediate results?
- How to implement double-buffered texture pattern?
- How to chain resize → rotation efficiently?
- What are memory considerations for large images?

**Sources**:
- Existing GPU code in packages/core/src/gpu/
- WebGPU render-to-texture patterns
- Texture ping-pong patterns

### Area 5: Integration Points
**Questions**:
- Where is resize called in the preview pipeline?
- Where is rotation called?
- What is the order of operations (rotate → crop → adjust)?
- How to integrate GPU transforms with existing GPU shaders?
- What fallback strategy to use?

**Files to Examine**:
- `apps/web/app/composables/useEditPreview.ts`
- `packages/core/src/decode/decode-worker.ts`
- Existing GPU services

## Expected Outputs

Each research area should produce:
1. Summary of findings
2. Recommended implementation approach
3. Code examples or pseudocode where applicable
4. Potential challenges and mitigations

## Synthesis Document

After all research is complete, synthesize findings into:
- `docs/research/2026-01-23-gpu-transforms-synthesis.md`

Then create implementation plan:
- `docs/plans/2026-01-23-gpu-transforms-plan.md`
