# Crop/Rotate/Straighten Research Plan

## Overview

Research the implementation approach for non-destructive crop, rotate, and straighten functionality in the Literoom photo editor. This is a core v1 feature per spec section 3.5.

## Research Areas

### Area 1: Mathematics & Algorithms
**Questions to answer:**
- What are the mathematical foundations for 2D rotation transforms?
- How do crop rectangles interact with rotation angles?
- What's the best approach for aspect ratio constraint calculations?
- How should straighten angle be calculated from a user-drawn line?
- How do we calculate the minimum bounding box after rotation to avoid black borders?

### Area 2: Existing Codebase Review
**Questions to answer:**
- What is the current edit state structure and where does crop/transform data fit?
- How are adjustments currently stored and applied in the pipeline?
- What WASM worker patterns exist that we can follow?
- How does the preview canvas currently work and how will crop/rotate affect it?
- What are the existing UI patterns for tool panels?

### Area 3: Canvas Rendering & UI
**Questions to answer:**
- How to render crop overlay with drag handles on HTML5 canvas?
- How to show rotation preview with live transform feedback?
- What's the UX pattern for straighten tool (draw line, show angle)?
- How to implement aspect ratio presets and lock toggle?
- What Nuxt UI components can we leverage?

### Area 4: Export Pipeline Integration
**Questions to answer:**
- How will crop/rotate parameters be applied at export time?
- What order should transforms be applied (rotate then crop, or crop then rotate)?
- How does this integrate with the existing WASM export pipeline?
- Should we apply transforms in Rust/WASM or JavaScript?

### Area 5: State Management
**Questions to answer:**
- What TypeScript types are needed for crop/transform state?
- How should default values work (no crop = full image, no rotation = 0)?
- How do we handle aspect ratio lock state?
- What's the copy/paste behavior for crop/transform settings?

## Research Approach

1. First, review existing codebase patterns (Area 2) to understand how we should integrate
2. Research mathematical foundations (Area 1) to ensure correct implementation
3. Research UI/canvas patterns (Area 3) for overlay rendering
4. Investigate export integration (Area 4) for end-to-end correctness
5. Define state management approach (Area 5) aligned with existing patterns

## Expected Outputs

- Synthesis document with recommended approach
- Type definitions for crop/transform state
- Architectural decision on where transforms are applied
- UI component structure proposal
