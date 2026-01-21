# Crop Overlay on Preview Canvas - Research Synthesis

## Overview

This document synthesizes research findings on implementing crop controls overlaid on the main preview canvas, enabling users to interact with the crop region directly on the full-size preview image.

## Current Architecture Summary

### 1. Crop Editor Implementation (useCropEditor.ts)

**State Structure:**
- Crop stored as `CropRectangle` with normalized (0-1) coordinates: `{ left, top, width, height }`
- Stored within `CropTransform` which also includes `RotationParameters`
- `null` crop represents full image (no crop applied)

**Rendering Logic (fully reusable):**
- `drawOverlay()` - Dark mask outside crop region (rgba(0,0,0,0.6))
- `drawBorder()` - White border with blue highlight when dragging
- `drawGrid()` - Rule of thirds grid lines
- `drawHandles()` - 8 resize handles (corners + midpoints, 12px squares)

**Coordinate Conversion (fully reusable):**
- `toNormalized(canvasX, canvasY)` - Canvas to 0-1 space with clamping
- `toCanvas(normX, normY)` - Normalized to canvas coordinates
- `getCanvasCoords(event)` - Mouse event to canvas coords with DPI scaling

**Hit Detection:**
- `findHandleAt()` - Radius-based detection (20px hit radius)
- `isInsideCrop()` - Point-in-rect test for move detection

**Interaction:**
- Handle drag for resize with aspect ratio constraints
- Interior drag for move
- Debounced store updates (32ms)
- Local state during drag, synced on completion

### 2. Preview Canvas Architecture (EditPreviewCanvas.vue)

**DOM Structure:**
```
<div class="absolute inset-0 flex items-center justify-center bg-gray-900">
  <div class="relative max-w-full max-h-full">
    <img class="max-w-full max-h-full object-contain" />
    <canvas class="absolute top-0 left-0 pointer-events-none" />  <!-- clipping -->
  </div>
</div>
```

**Key Properties:**
- Image uses `object-contain` - automatically handles letterboxing
- Canvas positioned absolutely at `top-0 left-0` relative to container
- `pointer-events-none` allows clicks through (for non-interactive overlays)
- ResizeObserver tracks actual rendered dimensions

**Dimension Tracking:**
- `renderedDimensions` ref tracks `img.clientWidth/clientHeight`
- Updated via ResizeObserver and `@load` event
- Canvas sized to match rendered image exactly

### 3. Clipping Overlay Pattern (useClippingOverlay.ts)

**Pattern to Follow:**
- Composable accepts canvas ref and dimension refs
- Watches state changes (clipping map, toggle states, dimensions)
- Renders pixel-by-pixel using 2D canvas context
- Efficient scaling from map coordinates to display coordinates

### 4. Mouse Event Handling Patterns

**Established Pattern:**
1. Element-level event attachment (not document-level)
2. DPI-aware coordinate conversion via `getBoundingClientRect()` + scale
3. Radius-based hit detection for better UX
4. Local state during drag with debounced store updates
5. Cancel debounce + commit on mouseup
6. Cleanup in `onUnmounted` (cancel debounce, remove listeners)

### 5. UI State Management

**editUI Store** (extends for crop activation):
- Currently manages: `showHighlightClipping`, `showShadowClipping`
- Should add: `isCropToolActive` or similar

**Accordion State:**
- `EditControlsPanel` uses local `expandedSections` ref
- Controls which sections (basic, tonecurve, crop) are visible

## Design Decisions

### D1: When to Show Crop Overlay

**Recommendation:** Show crop overlay when the "Crop & Transform" accordion section is expanded.

**Rationale:**
- Consistent with professional photo editors (Lightroom shows crop only in crop mode)
- Reduces visual clutter when not cropping
- Clear user intent when section is expanded
- Can sync accordion state to editUI store for cross-component access

### D2: Interactive vs Display-Only Overlay

**Recommendation:** Make the overlay fully interactive (not just display).

**Rationale:**
- Primary user need is precise crop positioning on full preview
- Interaction code already exists in useCropEditor
- Small panel is insufficient for detailed work
- Non-interactive overlay would be confusing (visual but not functional)

### D3: Where to Manage Overlay Interaction

**Option A:** Extend useCropEditor to support multiple canvases
**Option B:** Create new useCropOverlay composable that reuses useCropEditor logic
**Option C:** Create shared utilities, separate composables for panel and preview

**Recommendation:** Option B - Create `useCropOverlay` that wraps useCropEditor's core logic.

**Rationale:**
- Panel canvas and preview canvas have different dimension requirements
- Preview overlay needs additional positioning logic
- Keeps existing panel crop editor working unchanged
- Can share coordinate conversion and rendering utilities

### D4: Pointer Events Handling

**Challenge:** Clipping overlay uses `pointer-events-none`. Crop overlay needs interaction.

**Solution:**
- When crop tool is active: crop overlay canvas has `pointer-events-auto`
- When crop tool is inactive: no crop overlay canvas rendered
- Clipping overlay always uses `pointer-events-none`

### D5: Overlay Stacking Order

**Recommendation:**
1. Preview image (base)
2. Clipping overlay canvas (pointer-events-none, z-10)
3. Crop overlay canvas (when active, pointer-events-auto, z-20)

### D6: Coordinate System Strategy

The preview image may not fill its container completely due to:
- Different aspect ratios (letterboxing)
- CSS `object-contain` behavior

**Solution:**
- Track actual image rendered dimensions via ResizeObserver
- Use `img.clientWidth/clientHeight` as canvas dimensions
- Position canvas absolutely at top-left of the `relative` container
- Normalized coordinates (0-1) remain valid since they're relative to image content

## Implementation Strategy

### Phase 1: State Management
1. Add `isCropToolActive` to editUI store
2. Add method to toggle crop tool activation
3. Sync with accordion expansion in EditControlsPanel

### Phase 2: Create useCropOverlay Composable
1. Extract shared utilities from useCropEditor (coordinate conversion, rendering)
2. Create composable that accepts:
   - Canvas ref
   - Display dimension refs
   - Image dimension refs (for aspect ratio calculations)
3. Implement mouse event handlers (reuse pattern from useCropEditor)
4. Implement rendering (reuse draw functions from useCropEditor)
5. Add cleanup in onUnmounted

### Phase 3: Update EditPreviewCanvas
1. Add crop overlay canvas element (conditionally rendered)
2. Import editUI store and useCropOverlay composable
3. Pass dimension refs to composable
4. Set pointer-events based on activation state
5. Position canvas absolutely within preview container

### Phase 4: Connect Accordion State
1. Update EditControlsPanel to emit/sync expansion state
2. Watch for crop section expansion to toggle editUI.isCropToolActive
3. Ensure deactivation when navigating away or collapsing section

### Phase 5: Polish and Testing
1. Ensure smooth interaction during drag
2. Verify coordinate accuracy with various image aspect ratios
3. Test with rotation applied
4. Verify cleanup on navigation

## Technical Considerations

### Performance
- Use `requestAnimationFrame` for smooth rendering during drag
- Debounce store updates (32ms as established pattern)
- Avoid re-rendering when not needed (check dirty state)

### Edge Cases
- Image not yet loaded (no dimensions)
- Rotation applied (crop coordinates still in original image space)
- Very small or very large images
- Window/container resize during crop

### Accessibility
- Keyboard support not required for v1 (mouse/trackpad only per spec)
- Cursor feedback (grab/grabbing) for drag state

## Files to Create/Modify

**Create:**
- `apps/web/app/composables/useCropOverlay.ts` - New composable for preview overlay

**Modify:**
- `apps/web/app/stores/editUI.ts` - Add crop tool activation state
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - Add crop overlay canvas
- `apps/web/app/components/edit/EditControlsPanel.vue` - Sync accordion state

**Potentially Refactor:**
- `apps/web/app/composables/useCropEditor.ts` - Extract shared utilities to separate file

## Success Criteria

1. Crop overlay visible on main preview when crop section expanded
2. Can drag corners to resize crop region on preview
3. Can drag inside to move crop region on preview
4. Rule of thirds grid visible within crop area
5. Dark mask outside crop region
6. Overlay accurately reflects store state
7. Edits from panel and preview are synchronized
8. Overlay hidden when crop section collapsed
9. No memory leaks on navigation
10. Smooth performance during drag
