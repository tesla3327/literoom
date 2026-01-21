# Phase 9: WASM Edit Pipeline - Research Plan

**Date**: 2026-01-21
**Status**: In Progress
**Objective**: Research and plan the implementation of `apply_adjustments()` function to enable real-time photo editing.

---

## Research Areas

### Area 1: Image Adjustment Algorithms
**Goal**: Research color space theory and algorithms for implementing each adjustment.

Questions:
- What color space transformations are needed for temperature/tint?
- What are standard formulas for exposure, contrast, highlights/shadows?
- How does vibrance differ from saturation algorithmically?
- What are whites/blacks adjustments mathematically?

Deliverable: Algorithm pseudocode for each of the 10 adjustments.

### Area 2: Existing Rust Image Processing Libraries
**Goal**: Determine whether to use existing crates or implement from scratch.

Questions:
- Does the `image` crate provide adjustment operations?
- Are there specialized crates for color grading/adjustments?
- What are performance characteristics of different approaches?
- What's already used in the codebase?

Deliverable: Recommendation for library usage vs custom implementation.

### Area 3: Memory and Performance Constraints
**Goal**: Understand constraints for processing large images in WASM.

Questions:
- What's the maximum pixel buffer size we need to handle?
- How fast do adjustments need to be for interactive editing?
- Should we process at reduced resolution during drag?
- What's the memory model for WASM pixel buffers?

Deliverable: Performance requirements and optimization strategies.

### Area 4: Existing Decode Pipeline Integration
**Goal**: Understand how to integrate with the existing worker/service architecture.

Questions:
- How should apply_adjustments integrate with decode-worker.ts?
- What message types are needed?
- How do we handle caching/memoization?
- Should adjustments be applied as a separate step or part of decode?

Deliverable: Integration design document.

### Area 5: Codebase Review - Current State
**Goal**: Review existing adjustment types and bindings.

Files to review:
- `crates/literoom-core/src/lib.rs` - BasicAdjustments struct
- `crates/literoom-wasm/src/adjustments.rs` - WASM bindings
- `packages/core/src/decode/decode-worker.ts` - Worker architecture
- `apps/web/app/composables/useEditPreview.ts` - Preview composable

Deliverable: Integration points and required changes.

---

## Expected Outputs

1. `docs/research/2026-01-21-wasm-edit-pipeline-area-{n}.md` - Individual research findings
2. `docs/research/2026-01-21-wasm-edit-pipeline-synthesis.md` - Combined synthesis
3. `docs/plans/2026-01-21-wasm-edit-pipeline-plan.md` - Implementation plan

---

## Timeline

- Research: Parallel sub-agent execution
- Synthesis: Combine findings
- Plan: Create implementation phases
- Implementation: Execute plan
