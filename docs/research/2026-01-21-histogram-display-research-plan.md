# Phase 10: Histogram Display - Research Plan

**Date**: 2026-01-21
**Status**: In Progress
**Phase**: Research

---

## Objective

Research patterns and best practices for implementing a histogram display component for the photo editing view. The histogram should show RGB channel distribution with highlight/shadow clipping indicators and update in real-time as adjustments are applied.

---

## Research Areas

### Area 1: Histogram Computation (Rust/WASM)

**Questions**:
1. What's the most efficient algorithm for computing RGB histograms from pixel data?
2. How should the existing `Histogram` struct be extended or used?
3. How can we compute histograms efficiently during adjustment preview updates?
4. Should histogram computation happen alongside adjustment application, or separately?
5. What's the optimal approach for handling large images (e.g., compute from preview, not full resolution)?

**Research Tasks**:
- Review existing `Histogram` struct in `crates/literoom-core/src/lib.rs`
- Research SIMD-friendly histogram algorithms
- Investigate combining histogram computation with adjustment application
- Check existing WASM bindings for patterns to follow

---

### Area 2: Canvas Rendering (TypeScript/Vue)

**Questions**:
1. How should the histogram be rendered - Canvas 2D, SVG, or WebGL?
2. What's the best approach for smooth, performant histogram updates?
3. How should RGB channels be layered/displayed (overlapping, stacked, side-by-side)?
4. What's the ideal histogram resolution (256 bins shown as 256 pixels wide, or scaled)?

**Research Tasks**:
- Research Canvas 2D vs SVG performance for real-time updates
- Review common histogram UI patterns in photo editing software
- Investigate alpha blending approaches for overlapping RGB channels
- Research smoothing/anti-aliasing techniques

---

### Area 3: Clipping Indicators

**Questions**:
1. How should highlight clipping (values at 255) be visualized in the histogram?
2. How should shadow clipping (values at 0) be visualized in the histogram?
3. What's the best approach for the preview overlay showing clipped pixels?
4. Should clipping overlays be computed in WASM or in the canvas composable?

**Research Tasks**:
- Review how Lightroom/Capture One visualize clipping in histograms
- Research overlay rendering techniques for clipping visualization
- Investigate threshold values for "significant" clipping

---

### Area 4: Worker/Service Integration

**Questions**:
1. Should histogram computation be a separate worker message or combined with adjustments?
2. How should histogram data be transferred from worker to main thread efficiently?
3. What debouncing strategy should be used for histogram updates?
4. Should histogram updates be lower priority than preview updates?

**Research Tasks**:
- Review existing decode-worker.ts patterns
- Research efficient typed array transfer between worker and main
- Check existing debouncing patterns in useEditPreview.ts

---

### Area 5: Existing Codebase Review

**Questions**:
1. What's the current state of histogram-related code?
2. Where does the histogram UI placeholder exist?
3. What patterns are used for similar real-time preview features?
4. What tests exist for the Histogram struct?

**Research Tasks**:
- Review `crates/literoom-core/src/lib.rs` Histogram implementation
- Review `apps/web/app/pages/edit/[id].vue` histogram placeholder
- Review `apps/web/app/composables/useEditPreview.ts` for patterns
- Check if any WASM bindings for Histogram already exist

---

## Expected Outputs

1. **Histogram Computation Strategy**: Algorithm choice, performance considerations
2. **Rendering Approach**: Canvas 2D vs SVG, layer composition
3. **Clipping Visualization Design**: Histogram bars + preview overlay
4. **Integration Architecture**: Worker messages, debouncing, data flow
5. **Component Design**: Vue component API, composables needed

---

## Timeline

- Area 1-5 research: Parallel (immediate)
- Synthesis: After all areas complete
- Plan creation: After synthesis
