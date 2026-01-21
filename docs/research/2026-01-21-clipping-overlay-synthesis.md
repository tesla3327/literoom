# Clipping Overlay Research Synthesis

## Executive Summary

This research investigates how to implement the clipping overlay feature that shows clipped pixels (highlight/shadow) directly on the preview canvas. The feature is partially implemented - toggle states exist in the histogram composable, but no visual overlay appears on the preview.

## Current State

### What Exists
1. **Toggle States**: `showHighlightClipping` and `showShadowClipping` refs in `useHistogramDisplay.ts`
2. **Toggle Methods**: `toggleClippingOverlays()`, `toggleShadowClipping()`, `toggleHighlightClipping()`
3. **UI Buttons**: Toggle buttons in `EditHistogramDisplay.vue` with visual feedback (opacity changes)
4. **Keyboard Shortcut**: J key toggles clipping overlays
5. **Color Constants**: Blue (#3b82f6) for shadows, Red (#ef4444) for highlights

### What's Missing
1. Clipping states are not shared with the preview composable
2. No pixel-level clipping detection during preview rendering
3. No overlay rendering on the preview canvas
4. `useEditPreview.ts` does not consume clipping toggle states

## Recommended Architecture

### State Management: Pinia Store Approach

Create a new `editUI.ts` store (or extend existing) to share clipping state between histogram and preview:

```typescript
// apps/web/app/stores/editUI.ts
export const useEditUIStore = defineStore('editUI', () => {
  const showHighlightClipping = ref(false)
  const showShadowClipping = ref(false)

  function toggleClippingOverlays() {
    const newState = !(showHighlightClipping.value && showShadowClipping.value)
    showHighlightClipping.value = newState
    showShadowClipping.value = newState
  }

  return {
    showHighlightClipping,
    showShadowClipping,
    toggleClippingOverlays,
    toggleShadowClipping: () => showShadowClipping.value = !showShadowClipping.value,
    toggleHighlightClipping: () => showHighlightClipping.value = !showHighlightClipping.value,
  }
})
```

**Rationale**: Matches existing Pinia patterns, enables sharing across components, allows persistence.

### Overlay Rendering: Separate Canvas Layer (Option B)

Add a second canvas positioned absolutely over the preview image:

```html
<div class="preview-container relative">
  <img :src="previewUrl" />  <!-- Main preview -->
  <canvas ref="clippingOverlayCanvas" class="absolute inset-0 pointer-events-none" />
</div>
```

**Rationale**:
- Instant toggle performance (<1ms vs 200-500ms for WASM recomputation)
- Preserves browser image rendering optimizations
- Matches crop editor pattern already in codebase
- Separation of concerns

### Clipping Detection: JavaScript Post-Processing

Detect clipped pixels in JavaScript after preview pixels are available:

```typescript
function detectClippedPixels(pixels: Uint8Array, width: number, height: number): Uint8Array {
  const pixelCount = width * height
  const clipped = new Uint8Array(pixelCount)

  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
    let clipType = 0

    // Shadow clipping: any channel <= 0
    if (r <= 0 || g <= 0 || b <= 0) clipType |= 1
    // Highlight clipping: any channel >= 255
    if (r >= 255 || g >= 255 || b >= 255) clipType |= 2

    clipped[i / 3] = clipType
  }

  return clipped  // 0=none, 1=shadow, 2=highlight, 3=both
}
```

**Performance**: ~1-3ms for 512x512 thumbnail, acceptable for per-render detection.

## Implementation Approach

### Phase 1: State Management
1. Create `useEditUIStore` with clipping toggle states
2. Update `useHistogramDisplay.ts` to use store instead of local refs
3. Update `useHistogramDisplaySVG.ts` similarly

### Phase 2: Clipping Detection
1. Add `detectClippedPixels()` function to `useEditPreview.ts`
2. Store clipping map alongside preview pixels
3. Recompute when preview updates

### Phase 3: Overlay Rendering
1. Create `useClippingOverlay.ts` composable
2. Add overlay canvas to `EditPreviewCanvas.vue`
3. Render clipped pixels with semi-transparent colors
4. Watch store toggles to show/hide overlay

### Phase 4: Integration
1. Wire up components to use shared store
2. Ensure keyboard shortcut (J key) works globally
3. Test rapid toggling and preview updates

## Key Design Decisions

1. **Clipping Thresholds**: 0 and 255 (matches histogram detection, industry standard)
2. **Overlay Colors**: Blue (#3b82f6) shadows, Red (#ef4444) highlights at 30-40% opacity
3. **Toggle Behavior**: J key toggles both, individual buttons toggle each
4. **State Persistence**: UI state only (not saved with edits)
5. **Overlay Layer**: Separate canvas, not baked into preview image

## Files to Create/Modify

### New Files
- `apps/web/app/stores/editUI.ts` - UI state store
- `apps/web/app/composables/useClippingOverlay.ts` - Overlay rendering

### Modified Files
- `apps/web/app/composables/useHistogramDisplay.ts` - Use store
- `apps/web/app/composables/useHistogramDisplaySVG.ts` - Use store
- `apps/web/app/composables/useEditPreview.ts` - Add clipping detection
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - Add overlay canvas
- `apps/web/app/components/edit/EditHistogramDisplay.vue` - Use store
- `apps/web/app/components/edit/EditHistogramDisplaySVG.vue` - Use store

## Performance Considerations

| Operation | Time | Frequency |
|-----------|------|-----------|
| Clipping detection | 1-3ms | Per preview render |
| Overlay render | <1ms | Per toggle or preview update |
| Toggle show/hide | <1ms | On user action |

Total overhead: Negligible when clipping is disabled, ~2-4ms when enabled.

## Testing Strategy

1. **Unit Tests**: Clipping detection function with edge cases
2. **Integration Tests**: Store state synchronization
3. **E2E Tests**: Toggle buttons, keyboard shortcut, visual overlay
4. **Manual Testing**: Verify colors match Lightroom convention
