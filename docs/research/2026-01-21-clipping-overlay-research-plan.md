# Clipping Overlay Research Plan

## Context

The histogram component has toggle buttons for showing highlight and shadow clipping, but no visual overlay actually appears on the preview canvas. The spec requires:

> "Show toggles:
> - show/hide highlight clipping overlay on the preview
> - show/hide shadow clipping overlay on the preview"

Currently:
- `useHistogramDisplay.ts` manages `showHighlightClipping` and `showShadowClipping` refs
- These refs only affect button opacity in `EditHistogramDisplay.vue`
- `useEditPreview.ts` does NOT consume the clipping states
- No code exists to render clipped pixels as colored overlay

## Research Areas

### Area 1: Current Histogram/Clipping State Management
Investigate how clipping states are managed and how they could be shared with the preview:
- Review `useHistogramDisplay.ts` clipping state management
- Review `useHistogramDisplaySVG.ts` if different
- Determine how to expose clipping states to preview composable
- Consider using shared store vs. composable injection

### Area 2: Preview Pipeline Architecture
Understand the current preview rendering pipeline:
- Review `useEditPreview.ts` rendering flow
- Review `EditPreviewCanvas.vue` canvas setup
- Identify where clipping overlay should be applied
- Determine if overlay should be computed in WASM or JavaScript

### Area 3: Clipping Detection Algorithm
Research how to detect clipped pixels:
- Define clipping thresholds (what constitutes "clipped")
- Consider highlight clipping: any channel >= 255
- Consider shadow clipping: any channel <= 0
- Research performance considerations for pixel iteration

### Area 4: Overlay Rendering Approaches
Explore different ways to render the clipping overlay:
- Option A: Render directly on same canvas (composite)
- Option B: Separate overlay canvas layer (z-indexed)
- Option C: Compute in WASM and return modified image
- Consider performance of each approach

### Area 5: Existing Codebase Patterns
Review similar patterns in the codebase:
- How crop overlay is rendered (if at all)
- How other canvas overlays work
- Review existing canvas compositing code

## Expected Outputs

1. Research synthesis document
2. Recommended approach for clipping overlay
3. Implementation plan with specific file changes
