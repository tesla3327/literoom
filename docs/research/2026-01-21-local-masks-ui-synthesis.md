# Local Masks UI Research Synthesis

**Created**: 2026-01-21 21:45 EST
**Based on**: Parallel research from 4 sub-agents covering edit store, controls panel, crop overlay, and mask types

## Executive Summary

This document synthesizes research into implementing the UI for Local Adjustment Masks (Phase 7). The backend infrastructure (Phases 1-6) is complete - TypeScript types, Rust implementation, WASM bindings, worker integration, edit store state management, and preview pipeline integration are all working. This phase focuses on creating the user interface for creating and editing linear and radial gradient masks.

---

## 1. EXISTING MASK STATE MANAGEMENT (Edit Store)

### State Variables
```typescript
masks: Ref<MaskStack | null>           // Contains linearMasks[] and radialMasks[]
selectedMaskId: Ref<string | null>     // ID of currently selected mask for editing
```

### Available Actions
| Action | Description |
|--------|-------------|
| `addLinearMask(mask)` | Add new linear gradient mask, auto-selects it |
| `addRadialMask(mask)` | Add new radial gradient mask, auto-selects it |
| `updateLinearMask(id, updates)` | Update linear mask properties |
| `updateRadialMask(id, updates)` | Update radial mask properties |
| `deleteMask(id)` | Delete mask by ID (both types searched) |
| `toggleMaskEnabled(id)` | Toggle enabled/disabled state |
| `selectMask(id \| null)` | Select mask for editing |
| `setMaskAdjustments(id, adjustments)` | Set all adjustments for a mask |
| `setMaskAdjustment(id, key, value)` | Update single adjustment value |
| `resetMasks()` | Clear all masks |
| `setMasks(maskStack)` | Set complete mask stack (for paste/load) |

### Computed Properties
- `hasMaskModifications` - Whether any masks exist
- `selectedMask` - Returns `{ type: 'linear' | 'radial', mask }` or null
- `hasModifications` - Includes mask changes in overall dirty check

---

## 2. MASK TYPE STRUCTURES

### LinearGradientMask
```typescript
{
  id: string                    // Unique identifier
  start: Point2D               // Start point (0-1 normalized)
  end: Point2D                 // End point (0-1 normalized)
  feather: number              // 0-1 softness
  enabled: boolean             // Active state
  adjustments: MaskAdjustments // Per-mask adjustments
}
```

### RadialGradientMask
```typescript
{
  id: string
  center: Point2D              // Center point (0-1 normalized)
  radiusX: number              // Horizontal radius (0-1)
  radiusY: number              // Vertical radius (0-1)
  rotation: number             // Degrees
  feather: number              // 0-1 softness
  invert: boolean              // Inside vs outside effect
  enabled: boolean
  adjustments: MaskAdjustments
}
```

### MaskAdjustments
All basic adjustments except tone curve:
- temperature, tint, exposure, contrast
- highlights, shadows, whites, blacks
- vibrance, saturation

---

## 3. EXISTING UI PATTERNS

### EditControlsPanel Structure
- UAccordion with 3 sections: Basic, Tone Curve, Crop & Transform
- Accordion items track expanded state
- Watch callback triggers overlay visibility on expand/collapse

### Adjustment Groups Pattern
```typescript
const adjustmentGroups = [
  { name: 'White Balance', sliders: [...] },
  { name: 'Tone', sliders: [...] },
  { name: 'Presence', sliders: [...] },
]
```

### Composable Architecture
Both `useToneCurve.ts` and `useCropEditor.ts` follow:
- Canvas ref binding
- Local state (synced with store via debounce)
- Computed properties for derived state
- Event handler setup/teardown
- Watchers for store sync when not dragging

---

## 4. CROP OVERLAY PATTERNS (to reuse for masks)

### Canvas Layering
```vue
<canvas ref="clippingCanvasRef" class="pointer-events-none" />
<canvas v-if="editUIStore.isCropToolActive" ref="cropCanvasRef" style="z-index: 20" />
```

### Handle Hit-Detection
```typescript
const HANDLE_SIZE = 12      // Visual size
const HANDLE_HIT_RADIUS = 20  // Hit detection radius (larger!)

function findHandleAt(x, y, ...) {
  // Check distance to each handle position
  if (dist <= HANDLE_HIT_RADIUS) return handle
}
```

### State Machine for Interaction
```typescript
const activeHandle = ref<HandlePosition | null>(null)  // During drag
const isMoving = ref(false)                            // During move
const hoveredHandle = ref<HandlePosition | null>(null) // Hover effect
```

### Local State + Debounced Store Sync
```typescript
const localCrop = ref<CropRectangle>(...)

const debouncedStoreUpdate = debounce(() => {
  commitCrop()
}, 32)

// During drag: update local immediately, debounce store
function handleMouseMove(e) {
  resizeCrop(...)
  debouncedStoreUpdate()
  render()
}

// On mouse up: cancel debounce, force commit
function handleMouseUp() {
  debouncedStoreUpdate.cancel()
  commitCrop()
}
```

### Coordinate Conversion
```typescript
// Canvas coords to normalized (0-1)
function toNormalized(canvasX, canvasY, canvasWidth, canvasHeight) {
  return {
    x: Math.max(0, Math.min(1, canvasX / canvasWidth)),
    y: Math.max(0, Math.min(1, canvasY / canvasHeight)),
  }
}
```

---

## 5. PROPOSED UI ARCHITECTURE

### Files to Create

| File | Purpose |
|------|---------|
| `useMaskOverlay.ts` | Canvas interaction for drawing/editing masks on preview |
| `maskUtils.ts` | Shared utilities (hit detection, rendering, coordinates) |
| `EditMaskPanel.vue` | Mask list panel in controls sidebar |
| `EditMaskAdjustments.vue` | Per-mask adjustment sliders |

### Files to Modify

| File | Changes |
|------|---------|
| `EditControlsPanel.vue` | Add "Masks" accordion section |
| `EditPreviewCanvas.vue` | Add mask overlay canvas layer |
| `editUI.ts` | Add mask tool state (active, drawing mode) |

### Component Hierarchy
```
EditControlsPanel.vue
├── Basic (accordion)
├── Tone Curve (accordion)
├── Crop & Transform (accordion)
└── Masks (accordion) ← NEW
    ├── EditMaskPanel.vue
    │   ├── Add mask buttons (Linear, Radial)
    │   ├── Mask list with toggle/delete
    │   └── Selected mask indicator
    └── EditMaskAdjustments.vue (when mask selected)
        └── Adjustment sliders for selected mask

EditPreviewCanvas.vue
├── Preview image
├── Clipping overlay
├── Crop overlay (z-index: 20)
└── Mask overlay (z-index: 25) ← NEW
```

---

## 6. INTERACTION DESIGN

### Creating a New Mask

**Linear Gradient:**
1. User clicks "Add Linear" button
2. Canvas enters drawing mode (cursor: crosshair)
3. User clicks and drags to define start→end points
4. Mask created, added to store, selected for editing
5. Per-mask adjustments panel appears

**Radial Gradient:**
1. User clicks "Add Radial" button
2. Canvas enters drawing mode
3. User clicks and drags from center to edge
4. Ellipse created with drag determining radiusX/Y
5. Mask created, added to store, selected for editing

### Editing Existing Masks

**Linear Gradient Handles:**
- Start point: move start (affects gradient direction)
- End point: move end (affects gradient length)
- Optional: feather handles perpendicular to line

**Radial Gradient Handles:**
- Center point: move entire ellipse
- Edge points (4): resize radiusX/Y
- Rotation handle: on perimeter
- Optional: feather handle

### Keyboard Shortcuts
- `Delete` / `Backspace` - Delete selected mask
- `M` - Toggle mask overlay visibility
- `I` - Invert selected radial mask
- `Tab` - Cycle through masks

---

## 7. VISUAL DESIGN

### Canvas Rendering

**Selected Mask:**
```typescript
const MASK_COLORS = {
  selectedLine: '#3b82f6',           // Blue
  selectedHandle: '#3b82f6',
  selectedFill: 'rgba(59, 130, 246, 0.2)',
}
```

**Unselected Mask:**
```typescript
const MASK_COLORS = {
  unselectedLine: '#888888',
  unselectedHandle: '#888888',
  unselectedFill: 'rgba(100, 100, 100, 0.1)',
}
```

**Handle Styling:**
- 10px circle with white fill, colored stroke
- 2px stroke width
- Drop shadow for visibility

### Mask Panel Design
```
+----------------------------------+
| Masks                      [+] ▼ |
+----------------------------------+
| [Eye] Linear Mask 1        [x]  |  ← selected (blue highlight)
| [Eye] Radial Mask 1        [x]  |
| [Eye] Linear Mask 2        [x]  |
+----------------------------------+
| [Add Linear] [Add Radial]       |
+----------------------------------+
```

When mask selected:
```
+----------------------------------+
| Adjustments for Linear Mask 1   |
+----------------------------------+
| Exposure      [====●====] +0.50 |
| Contrast      [====●====]  0    |
| Highlights    [====●====]  0    |
| ...                             |
+----------------------------------+
```

---

## 8. IMPLEMENTATION PHASES

### Phase 7.1: Edit UI Store Extensions
- Add `isMaskToolActive` state
- Add `maskDrawingMode: 'linear' | 'radial' | null`
- Add actions: `activateMaskTool()`, `deactivateMaskTool()`, `setMaskDrawingMode()`

### Phase 7.2: Mask Panel Component
- Create `EditMaskPanel.vue`
- Display mask list from store
- Add/delete/toggle visibility buttons
- Selection highlighting
- Integrate into accordion

### Phase 7.3: Mask Adjustments Component
- Create `EditMaskAdjustments.vue`
- Reuse `EditAdjustmentSlider` pattern
- Display sliders for all MaskAdjustments
- Wire to `editStore.setMaskAdjustment()`

### Phase 7.4: Mask Overlay Utilities
- Create `maskUtils.ts`
- Handle positions for linear/radial
- Hit detection functions
- Rendering functions
- Coordinate conversion

### Phase 7.5: Mask Overlay Composable
- Create `useMaskOverlay.ts`
- Canvas rendering loop
- Mouse event handlers (draw, drag, move)
- Local state + debounced store sync
- Cursor feedback

### Phase 7.6: Preview Canvas Integration
- Add mask overlay canvas to `EditPreviewCanvas.vue`
- Wire up composable
- Conditional rendering based on `isMaskToolActive`
- Handle canvas layering (z-index)

### Phase 7.7: Drawing Mode Implementation
- Implement click-drag to create new masks
- Wire "Add" buttons to drawing mode
- Cancel drawing on Escape
- Complete drawing on mouse up

### Phase 7.8: Testing and Polish
- Unit tests for mask utilities
- Manual visual testing
- Keyboard shortcuts
- Edge case handling

---

## 9. TESTING CONSIDERATIONS

### Unit Tests
- Hit detection for all handle types
- Coordinate conversions
- Mask creation defaults
- Store action coverage

### Integration Tests
- Creating masks via UI
- Editing mask properties
- Deleting masks
- Preview updates when masks change

### Manual Visual Tests
- Gradient smoothness
- Handle responsiveness
- Cursor feedback
- Canvas layering

---

## 10. NEXT STEPS

1. Create implementation plan with detailed code changes per phase
2. Start with Phase 7.1 (Edit UI Store) - minimal, foundational
3. Progress through phases sequentially
4. Test each phase before moving to next

**Estimated Files:**
- 4 new files to create
- 3 files to modify
- 8 implementation phases

**Complexity:** Medium-High (canvas interaction requires careful state management)
