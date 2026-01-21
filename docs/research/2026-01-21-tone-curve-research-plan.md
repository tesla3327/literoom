# Phase 11: Tone Curve - Research Plan

**Date**: 2026-01-21
**Status**: In Progress
**Objective**: Research implementation approach for tone curve editing feature

---

## Overview

The tone curve is a fundamental photo editing tool that allows precise control over brightness and contrast by mapping input luminance values to output values. Users can add control points and drag them to reshape the curve, affecting the tonal range of the image.

Per the spec (section 3.5):
- Tone curve editor UI: add control point, drag points, delete point, reset curve
- Curve is smooth (spline-like) and produces natural transitions
- v1 supports a composite curve; per-channel can be later
- Must integrate with preview pipeline and histogram/clipping behavior

---

## Research Areas

### Area 1: Curve Mathematics & Interpolation
**Questions:**
- What interpolation algorithm works best for tone curves? (Catmull-Rom, cubic Bezier, monotonic cubic)
- How do professional tools like Lightroom/Photoshop implement their curves?
- How to ensure monotonicity (avoiding "crossing" curves)?
- What data structure represents the curve efficiently?

### Area 2: WASM/Rust Implementation
**Questions:**
- How to apply a tone curve LUT to pixels efficiently in Rust?
- Should we generate a 256-entry LUT from the curve?
- How to integrate with existing `apply_adjustments` pipeline?
- Performance considerations for real-time preview

### Area 3: Canvas UI for Curve Editor
**Questions:**
- How to render an interactive curve editor in HTML Canvas?
- How to handle point dragging with smooth updates?
- What's the best UX for adding/deleting control points?
- How to display histogram behind the curve (like Lightroom)?

### Area 4: Vue/Composable Architecture
**Questions:**
- How should curve state be stored in the edit store?
- What composable pattern works for interactive curve editing?
- How to coordinate curve changes with preview updates?
- How to handle undo/reset functionality?

### Area 5: Existing Codebase Review
**Questions:**
- What curve-related code already exists in the codebase?
- How does the current edit pipeline work?
- What types and interfaces need to be extended?
- How does the histogram composable work (for reference)?

---

## Deliverables

1. Research synthesis document combining findings from all areas
2. Implementation plan with specific files and code patterns
3. Performance targets and testing strategy
