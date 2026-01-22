# Iterations 101-110

## 101: 2026-01-21 19:13 EST: Export Workflow - Phase 5 (UI Components)

**Objective**: Implement the Pinia store, composable, and modal UI for the export feature.

**Background**: Phases 1-4 of the export workflow are complete:
- Phase 1: JPEG encoding in Rust/WASM
- Phase 2: Worker integration for encodeJpeg
- Phase 3: Filename template parser
- Phase 4: ExportService coordination

This phase creates the Vue/Nuxt components for the export UI.

**Implementation**:
1. Created `apps/web/app/stores/export.ts` - Pinia store for export state
   - Modal visibility, destination folder, filename template
   - JPEG quality, resize options, export scope
   - Export progress tracking
   - Resize presets (Original, 2048px, 3840px, 5120px)

2. Created `apps/web/app/composables/useExport.ts` - Export logic composable
   - Asset filtering based on scope (picks/selected/all)
   - Native folder picker integration with type-safe API
   - Image bytes loading from folder handle
   - Edit state retrieval (currently from edit store only)
   - Adapter functions to bridge DecodedImage to export dependencies
   - Resize workaround via encode-then-preview pipeline

3. Created `apps/web/app/components/export/ExportModal.vue` - Export dialog UI
   - Destination folder selection
   - Filename template input with validation
   - Scope toggle buttons (Picks/Selected/All)
   - JPEG quality slider (50-100)
   - Resize preset selection
   - Progress bar during export
   - Toast notifications for results

4. Updated `apps/web/app/components/catalog/FilterBar.vue`
   - Added Export button with picks count badge
   - Opens export modal on click

5. Updated `apps/web/app/pages/index.vue`
   - Added ExportModal component

6. Added `./export` entry to `packages/core/package.json` exports

**Tests**: All unit tests pass (317 total).

**Status**: Complete. Export workflow Phase 5 (UI Components) is done.

**Notes**:
- Edit state export only works for currently loaded asset (edit persistence not yet implemented)
- Resize uses encode-then-decode workaround (no direct pixel resize API)
- Demo mode export will fail since mock service doesn't write files

---

## 102: 2026-01-21 19:26 EST: Filmstrip Thumbnail Loading Issue - Fixed

**Objective**: Fix the issue where direct URL navigation to `/edit/[id]` only loads the current thumbnail in the filmstrip, leaving other thumbnails in loading state.

**Background**: This is an open medium-severity issue discovered on 2026-01-21. When users navigate directly to an edit URL (page refresh, shared link, or typing URL), only the currently viewed image's thumbnail loads in the filmstrip. Other thumbnails remain in loading state indefinitely.

**Research Findings**:
The root cause was that `EditFilmstrip.vue` never called `requestThumbnail()` for its visible items. It only displayed thumbnails that already existed in the catalog store.

When navigating via the catalog grid:
- `CatalogThumbnail.vue` requests thumbnails on mount
- Thumbnails are already cached when entering edit view
- Filmstrip displays cached thumbnails correctly

When navigating directly via URL:
- Assets load with `thumbnailStatus: 'pending'`
- No component triggered thumbnail generation for filmstrip items
- Thumbnails stuck in pending state indefinitely

**Fix Applied**: Added a watcher in `EditFilmstrip.vue` that requests thumbnails for all visible filmstrip items when their status is `'pending'`:

```typescript
watch(visibleIds, (ids) => {
  for (const id of ids) {
    const asset = catalogStore.assets.get(id)
    if (asset && asset.thumbnailStatus === 'pending') {
      requestThumbnail(id, 1)  // Priority 1 (near visible)
    }
  }
}, { immediate: true })
```

**Files Modified** (1 file):
- `apps/web/app/components/edit/EditFilmstrip.vue`

**Tests**: All 317 unit tests pass.

**Verification**:
- ✅ Direct URL navigation to `/edit/demo-25` loads all visible filmstrip thumbnails
- ✅ Thumbnails display actual images, not placeholder icons

**Status**: Complete. Issue marked as solved in `docs/issues.md`.

---

## 103: 2026-01-21 19:27 EST: Export Workflow - Phase 6 (Integration) - Complete

**Objective**: Complete the final phase of the export workflow by wiring up the export functionality to the UI.

**Background**: Phases 1-5 of the export workflow are complete:
- Phase 1: JPEG encoding in Rust/WASM
- Phase 2: Worker integration for encodeJpeg
- Phase 3: Filename template parser
- Phase 4: ExportService coordination
- Phase 5: UI Components (store, composable, modal)

Phase 6 integrates the export modal into the catalog page and adds keyboard shortcuts.

**Implementation** (verified already complete):
1. ✅ FilterBar includes Export button with picks count badge
2. ✅ ExportModal added to index.vue
3. ✅ Keyboard shortcut (Cmd/Ctrl+E) implemented in index.vue

**Files Modified**:
- `apps/web/app/components/catalog/FilterBar.vue` - Export button with badge
- `apps/web/app/pages/index.vue` - ExportModal + keyboard handler

**Tests**: All 317 unit tests pass.

**Status**: Complete. Export workflow is fully implemented.

---

## 104: 2026-01-21 19:31 EST: Local Masks - Research Complete

**Objective**: Research the implementation of local adjustment masks (linear gradient, radial gradient).

**Background**: Per spec section 3.5.4, v1 requires:
- Linear gradient mask: position/angle, feather
- Radial gradient mask: ellipse position/size, feather, invert option
- Mask management: create, select, reorder, enable/disable, delete
- Per-mask adjustment subset
- Mask overlay toggle

**Research Approach**: Launched 4 parallel research agents:
1. **Mathematics** - Gradient algorithms, feathering curves, mask blending
2. **Codebase Integration** - Schema, stores, preview pipeline, copy/paste
3. **Canvas UI** - Existing patterns (crop overlay, tone curve), handle design
4. **Rust Implementation** - Current adjustment code, WASM patterns, performance

**Key Findings**:
1. **Math**: Use smootherstep for feathering (6t⁵ - 15t⁴ + 10t³), multiply for mask blending
2. **Schema**: Add MaskStack to EditState v4, migration from v3
3. **UI**: Follow crop overlay pattern (useMaskEditor.ts composable, debounced store sync)
4. **Rust**: Sequential mask application with per-pixel blending, early-exit optimization

**Files Created**:
- `docs/research/2026-01-21-local-masks-research-plan.md`
- `docs/research/2026-01-21-local-masks-synthesis.md`

**Implementation Plan**: 8 phases:
1. Core types and schema (TypeScript)
2. Rust implementation (mask evaluation)
3. WASM bindings
4. Edit store integration
5. Preview pipeline
6. Mask editor UI
7. Copy/paste integration
8. Testing and polish

**Status**: Complete. Research synthesis ready. Next: Create implementation plan.

---

## 105: 2026-01-21 19:40 EST: Local Masks - Implementation Plan Created

**Objective**: Create a detailed implementation plan for local adjustment masks (linear gradient, radial gradient).

**Background**: Iteration 104 completed the research synthesis for local masks. This iteration creates the implementation plan based on that research.

**Plan Structure** (9 phases):

1. **Phase 1: TypeScript Types and Schema**
   - Add `LinearGradientMask`, `RadialGradientMask`, `MaskStack` types
   - Update `EditState` to version 4
   - Add migration function for v3 → v4

2. **Phase 2: Rust Mask Implementation**
   - Create `mask/mod.rs`, `mask/linear.rs`, `mask/radial.rs`, `mask/apply.rs`
   - Implement `smootherstep()` for feathering
   - Implement `evaluate()` methods for both mask types
   - Implement `apply_masked_adjustments()` for per-pixel processing

3. **Phase 3: WASM Bindings**
   - Create `mask.rs` in literoom-wasm
   - Define `JsMaskStack`, `JsLinearMask`, `JsRadialMask` structs
   - Expose `apply_masked_adjustments()` to JavaScript

4. **Phase 4: Worker Integration**
   - Add `apply-masked-adjustments` message type
   - Implement worker handler
   - Add `applyMaskedAdjustments()` to `DecodeService`
   - Update mock implementation

5. **Phase 5: Edit Store Integration**
   - Add `masks` and `selectedMaskId` state
   - Add CRUD actions for masks
   - Update `hasModifications` computed

6. **Phase 6: Preview Pipeline Integration**
   - Add mask step after tone curve
   - Add watcher for mask changes

7. **Phase 7: Mask Editor UI**
   - Create `useMaskEditor.ts` composable
   - Create `EditMaskPanel.vue`, `EditMaskOverlay.vue`, `EditMaskAdjustments.vue`
   - Add mask overlay canvas to preview

8. **Phase 8: Copy/Paste Integration**
   - Add `masks` to `CopyGroups`
   - Update copy/paste logic

9. **Phase 9: Testing and Polish**
   - Rust unit tests for mask evaluation
   - TypeScript tests for schema migration
   - Keyboard shortcuts (M, Delete, Tab)

**Files Created**:
- `docs/plans/2026-01-21-local-masks-plan.md`

**Total Scope**: ~28 files across 9 phases

**Status**: Complete. Implementation plan ready. Next: Begin Phase 1 implementation.

---

## 106: 2026-01-21 19:42 EST: Local Masks - Phase 1 Complete (TypeScript Types)

**Objective**: Implement Phase 1 of the Local Masks feature - TypeScript types and schema.

**Background**: The implementation plan for local masks was created in iteration 105. Phase 1 adds the core TypeScript types that will be used throughout the feature.

**Implementation**:

1. **Updated `EDIT_SCHEMA_VERSION` to 4**
   - Added version history comment documenting v4 adds local masks

2. **Added new types to `packages/core/src/catalog/types.ts`**:
   - `Point2D` - 2D point in normalized coordinates
   - `MaskAdjustments` - Adjustments applicable to mask regions (no toneCurve)
   - `LinearGradientMask` - Linear gradient mask with start/end points, feather
   - `RadialGradientMask` - Radial/elliptical mask with center, radii, rotation, invert
   - `MaskStack` - Container for all masks on an asset

3. **Added helper functions**:
   - `createDefaultMaskStack()` - Create empty mask stack
   - `createLinearMask()` - Create linear mask with defaults
   - `createRadialMask()` - Create radial mask with defaults
   - `isModifiedMaskStack()` - Check if masks differ from default
   - `cloneMaskStack()` - Deep copy mask stack
   - `cloneLinearMask()` - Deep copy linear mask
   - `cloneRadialMask()` - Deep copy radial mask
   - `migrateEditState()` - Migrate from previous schema versions

4. **Updated `EditState` interface**:
   - Added optional `masks?: MaskStack` field

5. **Added 46 new unit tests**:
   - Tests for all new types and functions
   - Migration tests for v1 → v4, v3 → v4
   - Clone/immutability tests

**Files Modified** (2 files):
- `packages/core/src/catalog/types.ts` - Added mask types, helpers, migration
- `packages/core/src/catalog/edit-types.test.ts` - Added 46 new tests

**Tests**: All 362 tests pass (316 existing + 46 new).

**Status**: Complete. Phase 1 done. Next: Phase 2 (Rust Mask Implementation).

---

## 107: 2026-01-21 19:46 EST: Local Masks - Phase 2 Complete (Rust Implementation)

**Objective**: Implement mask evaluation algorithms and masked adjustment application in Rust.

**Background**: Phase 1 added TypeScript types for masks. Phase 2 implements the Rust core functionality for evaluating mask strength at pixel coordinates and applying masked adjustments.

**Implementation**:

1. **Created `crates/literoom-core/src/mask/mod.rs`**:
   - `smootherstep(t)` function for smooth feathering transitions
   - Module re-exports for `LinearGradientMask`, `RadialGradientMask`, `apply_masked_adjustments`
   - Unit tests for smootherstep boundaries, monotonicity, symmetry

2. **Created `crates/literoom-core/src/mask/linear.rs`**:
   - `LinearGradientMask` struct with `start_x`, `start_y`, `end_x`, `end_y`, `feather`
   - `evaluate(x, y)` method returns mask strength (0.0-1.0)
   - Algorithm: projects point onto gradient line, applies feathering centered at midpoint
   - Helper methods: `length()`, `angle()`
   - 13 unit tests covering endpoints, diagonals, hard edges, degenerate cases

3. **Created `crates/literoom-core/src/mask/radial.rs`**:
   - `RadialGradientMask` struct with `center_x`, `center_y`, `radius_x`, `radius_y`, `rotation`, `feather`, `invert`
   - `evaluate(x, y)` method with rotation support and invert option
   - `circle()` helper for circular masks
   - Helper methods: `area()`, `contains()`
   - 14 unit tests covering circles, ellipses, rotation, inversion

4. **Created `crates/literoom-core/src/mask/apply.rs`**:
   - `apply_masked_adjustments(pixels, width, height, linear_masks, radial_masks)` function
   - Iterates over pixels, evaluates each mask, blends adjusted colors
   - Early exit optimizations for empty masks and zero mask values
   - 13 unit tests covering exposure, saturation, multiple masks, feathering

5. **Added `apply_adjustments_to_pixel()` to `adjustments.rs`**:
   - Public function for per-pixel adjustment processing
   - Used by mask module for blending adjusted colors

6. **Updated `crates/literoom-core/src/lib.rs`**:
   - Added `pub mod mask;`
   - Added re-exports: `apply_masked_adjustments`, `LinearGradientMask`, `RadialGradientMask`

**Files Created** (4 files):
- `crates/literoom-core/src/mask/mod.rs`
- `crates/literoom-core/src/mask/linear.rs`
- `crates/literoom-core/src/mask/radial.rs`
- `crates/literoom-core/src/mask/apply.rs`

**Files Modified** (2 files):
- `crates/literoom-core/src/lib.rs` - Added mask module export
- `crates/literoom-core/src/adjustments.rs` - Added `apply_adjustments_to_pixel()` function

**Tests**: All 184 literoom-core tests pass (142 existing + 42 new mask tests).

**Key Algorithms**:
- **Linear mask**: Project point onto line, normalize position (0=start, 1=end), apply feathering centered at 0.5
- **Radial mask**: Translate/rotate to local space, compute normalized ellipse distance, apply feathering from inner to edge
- **Smootherstep**: `6t⁵ - 15t⁴ + 10t³` for zero velocity/acceleration at boundaries

**Status**: Complete. Phase 2 done. Next: Phase 3 (WASM Bindings).

---

## 108: 2026-01-21 20:42 EST: Local Masks - Phase 3 Complete (WASM Bindings)

**Objective**: Expose mask operations to JavaScript via WASM bindings.

**Background**: Phase 2 implemented the Rust mask evaluation algorithms. Phase 3 creates the WASM bindings so TypeScript/JavaScript can call `apply_masked_adjustments()`.

**Implementation**:

1. **Created `crates/literoom-wasm/src/mask.rs`**:
   - `JsMaskStack` struct containing arrays of linear and radial masks
   - `JsLinearMask` struct with start/end points, feather, enabled flag, adjustments
   - `JsRadialMask` struct with center, radii, rotation (degrees), feather, invert, enabled, adjustments
   - `JsAdjustments` struct with all 10 basic adjustments (serde defaults to 0)
   - `apply_masked_adjustments(image, mask_data)` WASM-bound function
   - Conversion from JS structs to core mask types
   - Rotation converted from degrees to radians automatically

2. **Updated `crates/literoom-wasm/src/lib.rs`**:
   - Added `mod mask;` declaration
   - Added `pub use mask::apply_masked_adjustments;` re-export

**Files Created** (1 file):
- `crates/literoom-wasm/src/mask.rs`

**Files Modified** (1 file):
- `crates/literoom-wasm/src/lib.rs` - Added mask module and re-export

**Tests**: All 44 literoom-wasm tests pass (39 existing + 5 new mask tests).

**WASM Build**: Successfully built and exported to `packages/wasm/`.

**TypeScript Signature**:
```typescript
export function apply_masked_adjustments(
  image: JsDecodedImage,
  mask_data: any  // JsMaskStack structure
): JsDecodedImage;
```

**Usage Example** (TypeScript):
```typescript
const maskStack = {
  linear_masks: [{
    start_x: 0.0, start_y: 0.5,
    end_x: 1.0, end_y: 0.5,
    feather: 0.5,
    enabled: true,
    adjustments: { exposure: 1.0 }
  }],
  radial_masks: []
};

const result = apply_masked_adjustments(sourceImage, maskStack);
```

**Status**: Complete. Phase 3 done. Next: Phase 4 (Worker Integration).

---

