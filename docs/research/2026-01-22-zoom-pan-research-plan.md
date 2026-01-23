# Zoom/Pan Feature Research Plan

**Date**: 2026-01-22
**Objective**: Research patterns and techniques for implementing zoom and pan functionality in the edit view preview canvas.

## Background

The spec (section 3.5) requires:
- Base display uses preview 1x (2560px) and 2x (5120px) only
- Zooming and panning should be immediate using UI transforms
- After a short delay, app swaps to higher detail if available
- If zoom level exceeds what 1x can support and 2x exists, switch source

## Research Areas

### Area 1: Codebase Review - EditPreviewCanvas
- Current canvas architecture
- How crop overlay handles transforms
- Existing composables for canvas interaction
- Preview 1x/2x generation and caching

### Area 2: Transform Techniques
- CSS transforms vs Canvas API transforms
- Performance considerations for large images
- Coordinate system management (screen vs image)
- Integration with existing crop overlay

### Area 3: Interaction Patterns
- Mouse wheel zoom (with center-on-cursor)
- Click-and-drag pan
- Touch gestures (pinch-to-zoom, two-finger pan)
- Keyboard shortcuts (Z for zoom, spacebar for pan mode)

### Area 4: Zoom Level Management
- Preset zoom levels (Fit, Fill, 100%, 200%)
- Min/max zoom constraints
- Zoom UI controls (buttons, slider, double-click to fit)
- Zoom indicator display

### Area 5: Preview Quality Switching
- When to switch from 1x to 2x preview
- Debounce/delay before quality upgrade
- Handling missing 2x preview gracefully
- Memory considerations for large previews

## Expected Outputs

1. Recommended transform approach (CSS vs Canvas)
2. Interaction pattern specifications
3. Zoom level presets and constraints
4. Quality switching thresholds
5. Integration points with existing code
