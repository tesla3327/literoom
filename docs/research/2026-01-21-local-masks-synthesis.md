# Local Masks Research Synthesis

**Created**: 2026-01-21 19:45 EST
**Based on**: Parallel research from 4 sub-agents covering mathematics, codebase integration, canvas UI, and Rust implementation

## Executive Summary

This synthesis document compiles findings from four parallel research efforts into a comprehensive guide for implementing local adjustment masks (linear and radial gradients) for Literoom. The research confirms that the codebase is well-architected for this feature, with established patterns that can be extended.

---

## 1. MATHEMATICS AND ALGORITHMS

### Linear Gradient Mask

**Definition**: A linear gradient defined by start point P0 and end point P1, with feathering.

**Algorithm**:
```
For pixel at position P(x, y):
1. Direction vector: D = P1 - P0
2. Vector to pixel: V = P - P0
3. Projection: t = (V · D) / (D · D)
4. Clamp: t = clamp(t, 0, 1)
5. Mask value: mask = 1.0 - smootherstep(t)
```

**Feathering**: Extends transition zone using the smootherstep function:
```
smootherstep(t) = t³ × (t × (6t - 15) + 10)
```

This provides zero velocity and acceleration at boundaries for natural transitions.

### Radial Gradient Mask

**Definition**: An elliptical gradient with center, radii, rotation, and feathering.

**Algorithm**:
```
For pixel at position P(x, y):
1. Translate: dx = x - cx, dy = y - cy
2. Rotate to local space (if rotated)
3. Normalized distance: d = sqrt((dx/rx)² + (dy/ry)²)
4. Inner bound: inner = 1.0 - feather
5. Mask value based on d position relative to inner/outer
```

### Mask Combination

Multiple masks can be combined using:
- **Multiply** (intersection): `result = mask1 * mask2` - Default, darkens
- **Screen** (union): `result = 1 - (1-mask1)(1-mask2)` - Brightens
- **Max**: `result = max(mask1, mask2)` - Strongest wins
- **Add**: `result = clamp(mask1 + mask2, 0, 1)` - Cumulative

**Recommendation**: Use **multiply** as the default for Lightroom-like behavior.

---

## 2. DATA STRUCTURES

### Mask Type Definitions

Add to `packages/core/src/catalog/types.ts`:

```typescript
/**
 * Linear gradient mask definition
 */
export interface LinearGradientMask {
  /** Unique identifier */
  id: string
  /** Start point (0-1 normalized) */
  start: { x: number; y: number }
  /** End point (0-1 normalized) */
  end: { x: number; y: number }
  /** Feather amount (0-100, Lightroom-style) */
  feather: number
  /** Whether mask is enabled */
  enabled: boolean
  /** Per-mask adjustments */
  adjustments: Partial<Adjustments>
}

/**
 * Radial gradient mask definition
 */
export interface RadialGradientMask {
  /** Unique identifier */
  id: string
  /** Center point (0-1 normalized) */
  center: { x: number; y: number }
  /** Horizontal radius (0-1 normalized) */
  radiusX: number
  /** Vertical radius (0-1 normalized) */
  radiusY: number
  /** Rotation angle in degrees */
  rotation: number
  /** Feather amount (0-100) */
  feather: number
  /** Whether effect is inside or outside ellipse */
  invert: boolean
  /** Whether mask is enabled */
  enabled: boolean
  /** Per-mask adjustments */
  adjustments: Partial<Adjustments>
}

/**
 * Container for all masks on an asset
 */
export interface MaskStack {
  /** Linear gradient masks */
  linearMasks: LinearGradientMask[]
  /** Radial gradient masks */
  radialMasks: RadialGradientMask[]
  /** How to blend multiple masks */
  blendMode: 'multiply' | 'screen' | 'add' | 'max'
}
```

### Schema Update

Update EditState to version 4:

```typescript
export interface EditState {
  version: 4  // Increment from 3
  adjustments: Adjustments
  cropTransform: CropTransform
  masks?: MaskStack  // NEW FIELD
}

export const EDIT_SCHEMA_VERSION = 4
```

### Migration Function

```typescript
export function migrateEditState(state: any): EditState {
  if (state.version === 3) {
    return {
      ...state,
      version: 4,
      masks: undefined  // No masks in v3
    }
  }
  return state
}
```

---

## 3. INTEGRATION POINTS

### Edit Store (`apps/web/app/stores/edit.ts`)

**New State**:
```typescript
const masks = ref<MaskStack | null>(null)
const selectedMaskId = ref<string | null>(null)  // UI selection
```

**New Actions**:
- `addLinearMask(mask: LinearGradientMask): void`
- `addRadialMask(mask: RadialGradientMask): void`
- `updateMask(maskId: string, updates: Partial<...>): void`
- `deleteMask(maskId: string): void`
- `toggleMaskEnabled(maskId: string): void`
- `setMaskAdjustments(maskId: string, adjustments: Partial<Adjustments>): void`
- `selectMask(maskId: string | null): void`
- `resetMasks(): void`

**New Computed**:
- `hasMaskModifications: boolean`
- `activeMasks: (LinearGradientMask | RadialGradientMask)[]`

### Preview Pipeline (`apps/web/app/composables/useEditPreview.ts`)

**Updated Pipeline Order**:
```
1. Rotation
2. Crop
3. Global Adjustments
4. Global Tone Curve
5. Mask Stack Application (NEW)
6. Clipping Detection
```

**New WASM Call**:
```typescript
if (editStore.masks && editStore.masks.linearMasks.length > 0 ||
    editStore.masks.radialMasks.length > 0) {
  const result = await $decodeService.applyMaskedAdjustments(
    currentPixels, currentWidth, currentHeight, editStore.masks
  )
  currentPixels = result.pixels
}
```

### Copy/Paste System

**Update CopyGroups**:
```typescript
export interface CopyGroups {
  basicAdjustments: boolean
  toneCurve: boolean
  crop: boolean
  rotation: boolean
  masks: boolean  // NEW - excluded by default
}
```

---

## 4. CANVAS UI ARCHITECTURE

### Composable Structure

Create `apps/web/app/composables/useMaskEditor.ts`:

```typescript
export function useMaskEditor(options: UseMaskEditorOptions) {
  const canvasRef = ref<HTMLCanvasElement | null>(null)
  const localMasks = ref<MaskStack>({ linearMasks: [], radialMasks: [], blendMode: 'multiply' })
  const selectedMaskId = ref<string | null>(null)
  const activeHandle = ref<HandleType | null>(null)
  const hoveredHandle = ref<HandleType | null>(null)

  // Rendering
  function render(): void { /* Draw all masks, handles, overlays */ }

  // Interaction
  function handleMouseDown(e: MouseEvent): void { /* Hit detection, start drag */ }
  function handleMouseMove(e: MouseEvent): void { /* Update position, hover state */ }
  function handleMouseUp(e: MouseEvent): void { /* Commit changes */ }

  // Store sync
  const debouncedStoreUpdate = debounce(() => editStore.setMasks(localMasks.value), 32)

  return { canvasRef, localMasks, selectedMaskId, render, ... }
}
```

### Handle Configuration

**Linear Gradient**:
- Start point (moveable)
- End point (moveable)
- Feather handles (perpendicular to gradient line)

**Radial Gradient**:
- Center point (moveable)
- Edge point (resize radius)
- Rotation handle (on perimeter)
- Feather handle (radial outward)

### Visual Feedback

**Colors**:
```typescript
const MASK_COLORS = {
  selectedHandle: '#3b82f6',      // Tailwind blue
  selectedLine: '#3b82f6',
  selectedOverlay: 'rgba(59, 130, 246, 0.2)',
  unselectedHandle: '#888888',
  unselectedLine: '#888888',
  unselectedOverlay: 'rgba(100, 100, 100, 0.1)',
  featherLine: '#60a5fa',
  featherDash: [4, 4],
}
```

**Cursor States**:
- `grab` / `grabbing` - moveable region
- `move` - center/position handles
- `ew-resize` / `ns-resize` - directional resize
- `crosshair` - creating new mask

### Component Structure

```vue
<!-- EditMaskPanel.vue (mask list) -->
<div class="space-y-2">
  <div class="flex justify-between">
    <span>Masks</span>
    <UDropdownMenu :items="addMaskOptions">
      <UButton size="xs" icon="i-heroicons-plus" />
    </UDropdownMenu>
  </div>
  <div v-for="mask in masks" :key="mask.id" class="mask-item">
    <!-- Eye toggle, type icon, name, delete button -->
  </div>
</div>
```

---

## 5. RUST IMPLEMENTATION

### Core Types

Add to `crates/literoom-core/src/mask/mod.rs`:

```rust
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct LinearGradientMask {
    pub start_x: f32,
    pub start_y: f32,
    pub end_x: f32,
    pub end_y: f32,
    pub feather: f32,  // 0.0 to 1.0
}

impl LinearGradientMask {
    pub fn evaluate(&self, x: f32, y: f32) -> f32 {
        let dx = self.end_x - self.start_x;
        let dy = self.end_y - self.start_y;
        let len_sq = dx * dx + dy * dy;

        if len_sq < f32::EPSILON { return 0.5; }

        let t = ((x - self.start_x) * dx + (y - self.start_y) * dy) / len_sq;
        let t_clamped = t.clamp(0.0, 1.0);

        1.0 - smootherstep(t_clamped)
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RadialGradientMask {
    pub center_x: f32,
    pub center_y: f32,
    pub radius_x: f32,
    pub radius_y: f32,
    pub rotation: f32,  // Radians
    pub feather: f32,
    pub invert: bool,
}

impl RadialGradientMask {
    pub fn evaluate(&self, x: f32, y: f32) -> f32 {
        let dx = x - self.center_x;
        let dy = y - self.center_y;

        // Rotate to local coordinates
        let (cos_r, sin_r) = (self.rotation.cos(), self.rotation.sin());
        let local_x = dx * cos_r + dy * sin_r;
        let local_y = -dx * sin_r + dy * cos_r;

        let norm_dist = ((local_x / self.radius_x).powi(2) +
                        (local_y / self.radius_y).powi(2)).sqrt();

        let inner = 1.0 - self.feather;
        let mask = if norm_dist <= inner {
            1.0
        } else if norm_dist >= 1.0 {
            0.0
        } else {
            let t = (norm_dist - inner) / self.feather.max(0.001);
            1.0 - smootherstep(t)
        };

        if self.invert { 1.0 - mask } else { mask }
    }
}

#[inline]
fn smootherstep(t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}
```

### Main Processing Function

```rust
pub fn apply_masked_adjustments(
    pixels: &mut [u8],
    width: u32,
    height: u32,
    linear_masks: &[(LinearGradientMask, BasicAdjustments)],
    radial_masks: &[(RadialGradientMask, BasicAdjustments)],
) {
    if linear_masks.is_empty() && radial_masks.is_empty() {
        return;  // Early exit
    }

    let w_f = width as f32;
    let h_f = height as f32;

    for (idx, chunk) in pixels.chunks_exact_mut(3).enumerate() {
        let x = (idx as u32 % width) as f32 / w_f;
        let y = (idx as u32 / width) as f32 / h_f;

        // Original pixel
        let orig = (chunk[0], chunk[1], chunk[2]);
        let mut r = chunk[0] as f32 / 255.0;
        let mut g = chunk[1] as f32 / 255.0;
        let mut b = chunk[2] as f32 / 255.0;

        // Apply each mask's adjustments
        for (mask, adj) in linear_masks {
            let mask_val = mask.evaluate(x, y);
            if mask_val > 0.001 {
                let (ar, ag, ab) = apply_adjustments_to_pixel(r, g, b, adj);
                r = r * (1.0 - mask_val) + ar * mask_val;
                g = g * (1.0 - mask_val) + ag * mask_val;
                b = b * (1.0 - mask_val) + ab * mask_val;
            }
        }

        for (mask, adj) in radial_masks {
            let mask_val = mask.evaluate(x, y);
            if mask_val > 0.001 {
                let (ar, ag, ab) = apply_adjustments_to_pixel(r, g, b, adj);
                r = r * (1.0 - mask_val) + ar * mask_val;
                g = g * (1.0 - mask_val) + ag * mask_val;
                b = b * (1.0 - mask_val) + ab * mask_val;
            }
        }

        chunk[0] = (r.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[1] = (g.clamp(0.0, 1.0) * 255.0) as u8;
        chunk[2] = (b.clamp(0.0, 1.0) * 255.0) as u8;
    }
}
```

### WASM Bindings

Add to `crates/literoom-wasm/src/mask.rs`:

```rust
#[wasm_bindgen]
pub fn apply_masked_adjustments(
    image: &JsDecodedImage,
    mask_data: JsValue,  // Serialized mask stack with adjustments
) -> JsDecodedImage {
    let mut pixels = image.pixels();
    let masks: MaskStackData = serde_wasm_bindgen::from_value(mask_data).unwrap();

    core::apply_masked_adjustments(
        &mut pixels,
        image.width(),
        image.height(),
        &masks.linear,
        &masks.radial,
    );

    JsDecodedImage::new(image.width(), image.height(), pixels)
}
```

---

## 6. PERFORMANCE CONSIDERATIONS

### Memory
- Per-pixel mask evaluation: 0 MB extra (computed on-the-fly)
- Pre-rendered texture (optional): width × height bytes

### CPU Time (Estimated for 4K)
| Approach | Time |
|----------|------|
| No masks | 200-300ms |
| 1-2 masks | +50-100ms |
| Pre-rendered | +20-50ms |

### Optimizations
1. **Early exit**: Skip pixels where mask = 0 or 1 (no blending needed)
2. **SIMD** (future): Process 4 pixels at once
3. **Rayon** (future): Parallel pixel iteration
4. **Adaptive quality**: 50% resolution during drag, full on release

---

## 7. UI/UX DESIGN

### Panel Layout

```
+------------------+------------------------+------------------+
|  Mask List       |    Preview Canvas      | Mask Controls    |
|  [+] Add         |                        | Opacity: ----    |
|  [Eye] Mask 1    |    [Image with         | Feather: ----    |
|  [Eye] Mask 2    |     mask overlay]      | [x] Invert       |
|                  |                        |                  |
|                  |                        | Adjustments:     |
|                  |                        | Exposure: ----   |
|                  |                        | Contrast: ----   |
+------------------+------------------------+------------------+
```

### Keyboard Shortcuts
- `M` - Toggle mask overlay visibility
- `Delete/Backspace` - Delete selected mask
- `D` - Duplicate selected mask
- `I` - Invert selected mask
- `Tab` - Cycle through masks

### Mask Creation Workflow
1. User clicks "Add Linear Gradient" or "Add Radial Gradient"
2. Canvas enters "drawing mode"
3. User drags to create mask shape
4. Mask appears in list, selected for editing
5. Adjustment sliders appear for mask-specific edits

---

## 8. TESTING STRATEGY

### Unit Tests (Rust)
- Mask evaluation at known coordinates
- Boundary conditions (corners, edges)
- Feathering smoothness
- Invert behavior

### Unit Tests (TypeScript)
- Mask CRUD operations in store
- Copy/paste with masks
- Schema migration v3 → v4

### Integration Tests
- WASM binding correctness
- Worker communication
- Preview pipeline with masks

### Visual Tests (Manual)
- Overlay rendering accuracy
- Handle interaction responsiveness
- Cursor feedback
- Performance at 4K resolution

---

## 9. IMPLEMENTATION PHASES

### Phase 1: Core Types and Schema
- Add mask types to `packages/core/src/catalog/types.ts`
- Update EditState to v4
- Add migration function
- Export types

### Phase 2: Rust Implementation
- Create `mask/mod.rs` in literoom-core
- Implement LinearGradientMask
- Implement RadialGradientMask
- Implement `apply_masked_adjustments()`
- Add unit tests

### Phase 3: WASM Bindings
- Create `mask.rs` in literoom-wasm
- Expose `apply_masked_adjustments()` to JS
- Update worker messages
- Update DecodeService interface

### Phase 4: Edit Store Integration
- Add mask state to edit store
- Add mask CRUD actions
- Update hasModifications computed
- Add mask persistence

### Phase 5: Preview Pipeline
- Update useEditPreview for mask rendering
- Add mask layer to pipeline
- Add watchers for mask changes

### Phase 6: Mask Editor UI
- Create useMaskEditor composable
- Create EditMaskPanel component
- Create mask overlay canvas
- Implement handle interaction

### Phase 7: Copy/Paste Integration
- Add masks to CopyGroups
- Update copy/paste logic
- Add UI for mask copy toggle

### Phase 8: Testing and Polish
- Add E2E tests
- Performance optimization
- Keyboard shortcuts
- Documentation

---

## 10. FILES TO CREATE/MODIFY

### New Files
| File | Purpose |
|------|---------|
| `crates/literoom-core/src/mask/mod.rs` | Mask types and algorithms |
| `crates/literoom-wasm/src/mask.rs` | WASM bindings |
| `apps/web/app/composables/useMaskEditor.ts` | Canvas interaction |
| `apps/web/app/components/edit/EditMaskPanel.vue` | Mask list UI |
| `apps/web/app/components/edit/EditMaskOverlay.vue` | Canvas overlay |
| `apps/web/app/components/edit/EditMaskAdjustments.vue` | Per-mask sliders |

### Modified Files
| File | Changes |
|------|---------|
| `packages/core/src/catalog/types.ts` | Add mask types, v4 schema |
| `apps/web/app/stores/edit.ts` | Add mask state/actions |
| `apps/web/app/composables/useEditPreview.ts` | Add mask rendering step |
| `apps/web/app/stores/editClipboard.ts` | Add masks to copy groups |
| `apps/web/app/composables/useCopyPasteSettings.ts` | Handle mask copy/paste |
| `packages/core/src/decode/worker-messages.ts` | Add mask message type |
| `packages/core/src/decode/decode-worker.ts` | Handle mask operations |
| `packages/core/src/decode/decode-service.ts` | Add applyMaskedAdjustments |
| `crates/literoom-core/src/lib.rs` | Export mask module |
| `crates/literoom-wasm/src/lib.rs` | Export mask bindings |

---

## Conclusion

The research confirms that implementing local adjustment masks is feasible with the existing Literoom architecture. Key findings:

1. **Mathematical foundation** is well-established (smootherstep for feathering)
2. **Codebase is well-prepared** with existing patterns for canvas interaction and WASM processing
3. **8-phase implementation** provides clear path forward
4. **Performance should be acceptable** with proper early-exit optimizations

Estimated effort: ~20 files, 8 phases, moderate complexity.

Next step: Create detailed implementation plan with specific code changes per phase.
