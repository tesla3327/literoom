# Research Plan: Crop Overlay on Preview Canvas

## Overview

Research how to implement crop controls overlaid on the main preview canvas, allowing users to interact with crop region directly on the full-size preview image.

## Research Areas

### Area 1: Current Crop Editor Implementation
- Review `useCropEditor.ts` composable
- Understand current crop state management in `edit.ts` store
- Document the existing coordinate system (normalized 0-1 values)
- Identify what can be reused vs what needs to change

### Area 2: Preview Canvas Architecture
- Review `EditPreviewCanvas.vue` component structure
- Understand how preview image is sized and positioned
- Identify existing overlay patterns (clipping overlay)
- Document canvas element hierarchy

### Area 3: Coordinate System Mapping
- How preview image is scaled to fit container
- Relationship between image coordinates and screen coordinates
- How existing overlays handle coordinate transformation
- CSS transforms vs canvas coordinate transforms

### Area 4: Mouse Event Handling
- Existing mouse event patterns in the codebase
- How tone curve editor handles drag interactions
- How clipping overlay positions itself
- Touch event considerations

### Area 5: Similar Implementations Review
- How clipping overlay was integrated
- How tone curve editor handles mouse drag
- Patterns from EditCropEditor's canvas rendering

## Expected Outputs

1. Understanding of current architecture
2. Coordinate transformation strategy
3. Component integration approach
4. Event handling design
5. Performance considerations

## Success Criteria

- Clear understanding of how to position overlay on preview
- Strategy for coordinate conversion between preview and normalized crop values
- Plan for handling resize/zoom of preview
- Reuse strategy for existing crop editor logic
