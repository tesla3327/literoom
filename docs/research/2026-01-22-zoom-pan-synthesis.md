# Zoom/Pan Feature Research Synthesis

**Date**: 2026-01-22
**Status**: Complete

## Executive Summary

This research synthesizes findings from five parallel research efforts to define the optimal approach for implementing zoom and pan functionality in Literoom's edit view.

## Key Decisions

### 1. Transform Approach: CSS Transforms on Container

**Decision**: Use CSS transforms on a container element that wraps the preview image and all overlay canvases.

**Rationale**:
- GPU acceleration via compositor thread
- Automatic layer promotion with `transform`
- Single transform affects all children (image + overlays)
- Smooth 60fps without pixel recalculation
- Matches existing crop/mask overlay patterns

**Implementation**:
```vue
<div
  class="relative"
  :style="{
    transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
    transformOrigin: '0 0',
    willChange: isInteracting ? 'transform' : 'auto'
  }"
>
  <img :src="previewUrl" />
  <canvas ref="clippingCanvasRef" />
  <canvas ref="cropCanvasRef" />
  <canvas ref="maskCanvasRef" />
</div>
```

### 2. Zoom/Pan State Management

**Decision**: Store zoom/pan state in `editUI.ts` store with per-image caching (LRU).

**State Structure**:
```typescript
interface ZoomPanState {
  scale: number        // Current zoom level (1.0 = 100%)
  panX: number         // Pan offset X (pixels)
  panY: number         // Pan offset Y (pixels)
  preset: ZoomPreset   // 'fit' | 'fill' | '100%' | '200%' | 'custom'
}
```

**Rationale**:
- Hybrid approach: cache per-image state with LRU eviction (50 images)
- Reset to "fit" on new image if not cached
- Matches existing editUI pattern (crop tool active, clipping toggles)

### 3. Interaction Patterns

| Interaction | Behavior |
|-------------|----------|
| Mouse wheel | Zoom toward cursor position |
| Click + drag | Pan when zoomed in |
| Double-click | Toggle between fit and 100% |
| Trackpad pinch | Zoom (via ctrlKey wheel event) |
| Two-finger scroll | Pan when zoomed |
| Z key | Toggle fit ↔ 100% |
| Spacebar + drag | Temporary pan mode |
| Cmd/Ctrl + +/- | Zoom in/out |
| Cmd/Ctrl + 0 | Fit to view |
| Cmd/Ctrl + 1 | 100% zoom |

### 4. Zoom Constraints

**Minimum Zoom**: `min(0.1, fitZoom * 0.5)` - Allow some zoom out beyond fit
**Maximum Zoom**: 4.0 (400%) - Beyond this, 2x preview resolution not helpful

**Zoom Presets**:
- Fit: Scale to show entire image (default)
- Fill: Scale to cover viewport
- 50%, 100%, 200% - Fixed percentages

### 5. Preview Quality Switching (Deferred)

**Decision**: Implement quality switching in a future iteration after basic zoom/pan works.

**Future Approach**:
- Threshold: Switch to 2x when zoom > 120% of 1x native resolution
- Timing: Debounce 300ms after zoom gesture completes
- Memory: Limit 2x cache to 5 entries (~250MB)

For now, the zoom/pan implementation will work with the existing 1x preview (2560px).

### 6. Coordinate System Updates

**Screen to Image Coordinates** (for overlays):
```typescript
function screenToImage(screenX: number, screenY: number, camera: ZoomPanState): Point {
  return {
    x: (screenX - camera.panX) / camera.scale,
    y: (screenY - camera.panY) / camera.scale
  }
}
```

**Overlay Hit Detection**: Update `getCanvasCoords()` in cropUtils.ts and maskUtils.ts to account for zoom/pan transform.

### 7. Cursor Feedback

| State | Cursor |
|-------|--------|
| Default (at fit) | `default` |
| Can pan (zoomed in) | `grab` |
| Panning | `grabbing` |
| Spacebar held | `grab` |
| Spacebar + panning | `grabbing` |

### 8. Edge Cases

1. **Browser zoom prevention**: Intercept Cmd/Ctrl + scroll and +/- keys
2. **Crop mode + zoom**: Allow wheel zoom, spacebar enables pan
3. **Pan bounds**: Clamp pan to prevent image from leaving viewport center
4. **Window resize**: Recalculate fit zoom, maintain proportional pan

## Architecture Integration

### Files to Create

1. `apps/web/app/composables/useZoomPan.ts` - Main composable for zoom/pan logic
2. `apps/web/app/utils/zoomCalculations.ts` - Pure functions for zoom math

### Files to Modify

1. `apps/web/app/stores/editUI.ts` - Add zoom/pan state
2. `apps/web/app/components/edit/EditPreviewCanvas.vue` - Wrap content in transform container
3. `apps/web/app/composables/cropUtils.ts` - Update coordinate conversion
4. `apps/web/app/composables/useCropOverlay.ts` - Pass camera state
5. `apps/web/app/composables/useMaskOverlay.ts` - Pass camera state
6. `apps/web/app/pages/edit/[id].vue` - Add keyboard shortcuts

### Component Structure (Updated EditPreviewCanvas)

```
EditPreviewCanvas
├── Outer container (overflow: hidden, receives wheel/mouse events)
│   ├── Transform container (CSS transform for zoom/pan)
│   │   ├── <img> preview image
│   │   ├── <canvas> clipping overlay
│   │   ├── <canvas> crop overlay
│   │   └── <canvas> mask overlay
│   └── Zoom controls (fixed position, not affected by transform)
│       ├── Zoom percentage display
│       ├── +/- buttons
│       └── Preset buttons (Fit, 100%)
```

## Implementation Phases

### Phase 1: Core Transform Infrastructure
- Create useZoomPan composable
- Add zoom/pan state to editUI store
- Wrap preview content in transform container
- Implement basic wheel zoom and drag pan

### Phase 2: Interaction Polish
- Add keyboard shortcuts (Z, Cmd+0, Cmd+1, +/-)
- Implement spacebar pan mode
- Add cursor feedback
- Implement double-click toggle

### Phase 3: Overlay Integration
- Update cropUtils.ts coordinate conversion
- Update useCropOverlay.ts to use camera state
- Update useMaskOverlay.ts to use camera state
- Test all overlays at various zoom levels

### Phase 4: UI Controls
- Add zoom percentage indicator
- Add zoom control buttons
- Handle window resize
- Per-image zoom state caching

## Testing Strategy

1. **Manual Testing**:
   - Zoom in/out via wheel at various cursor positions
   - Pan via drag when zoomed
   - Verify overlays (crop, mask, clipping) remain aligned
   - Test all keyboard shortcuts
   - Test trackpad gestures (macOS)

2. **Unit Tests**:
   - Zoom calculation functions
   - Coordinate conversion functions
   - State management actions

## Success Criteria

- [ ] Wheel zoom works centered on cursor
- [ ] Click-drag pan works when zoomed in
- [ ] Z key toggles between fit and 100%
- [ ] Double-click toggles zoom level
- [ ] Crop overlay remains aligned when zoomed
- [ ] Mask overlay remains aligned when zoomed
- [ ] Clipping overlay renders correctly at all zoom levels
- [ ] Zoom indicator shows current percentage
- [ ] Pan is clamped to prevent image from leaving center
