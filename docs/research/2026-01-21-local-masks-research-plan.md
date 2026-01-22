# Local Masks Research Plan

**Created**: 2026-01-21 19:31 EST
**Purpose**: Research implementation of linear and radial gradient masks for local adjustments

## v1 Requirements (from spec section 3.5.4)

### Linear Gradient Mask
- Position and angle control
- Feather (transition width)
- Adjustable center/end points

### Radial Gradient Mask
- Ellipse position and size
- Feather (transition width)
- Invert option (inside vs outside)

### Mask Management
- Create new masks
- Select/deselect masks
- Reorder mask stack
- Enable/disable individual masks
- Delete masks

### Per-Mask Adjustments
- Each mask has its own adjustment set (subset of basic panel)
- Typical: Exposure, Contrast, Highlights, Shadows, Saturation, Temperature, Tint

### UI Requirements
- Mask overlay toggle in preview
- Visual indicators for mask position/shape
- Interactive drag handles for editing

## Research Areas

### Area 1: Mask Mathematics and Algorithms
**Questions**:
- How to compute gradient falloff for linear masks?
- How to compute elliptical falloff for radial masks?
- What interpolation functions produce natural-looking feathering?
- How do multiple masks combine (blend modes)?

**Expected Output**: Mathematical formulas and algorithms for:
- Linear gradient computation
- Radial/elliptical gradient computation
- Feathering curves (linear, smooth, etc.)
- Mask combination/blending

### Area 2: Codebase Review - Integration Points
**Questions**:
- Where does mask data fit in the edit state?
- How should masks integrate with the preview pipeline?
- What changes needed in WASM/Rust for mask-aware adjustments?
- How to extend the copy/paste system for masks?

**Files to examine**:
- `packages/core/src/catalog/edit-types.ts` - Edit state schema
- `apps/web/app/stores/edit.ts` - Edit store
- `apps/web/app/composables/useEditPreview.ts` - Preview pipeline
- `crates/literoom-core/src/adjust/` - Rust adjustment code

### Area 3: Canvas UI for Mask Editing
**Questions**:
- How to render mask overlays on the preview canvas?
- What drag handles needed for linear gradient (start/end points)?
- What drag handles needed for radial gradient (center, edge, rotation)?
- How to show feather region visually?

**Reference**:
- Existing crop overlay implementation (`useCropOverlay.ts`, `cropUtils.ts`)
- Tone curve canvas interaction patterns

### Area 4: Rust/WASM Implementation
**Questions**:
- How to apply adjustments with mask blending efficiently?
- Should mask computation happen per-pixel or via LUT?
- How to structure the mask data types in Rust?
- Performance considerations for real-time preview

**Reference**:
- `crates/literoom-core/src/adjust/mod.rs` - Current adjustment code
- `crates/literoom-wasm/src/adjust.rs` - WASM bindings

### Area 5: State Management
**Questions**:
- How to store mask list in edit state?
- Schema versioning for masks
- Copy/paste mask selection UI
- Undo/redo considerations (future)

## Research Agents

Launch 5 parallel research agents:
1. **Area 1**: Mask mathematics (web search + theory)
2. **Area 2**: Codebase integration points
3. **Area 3**: Canvas UI patterns
4. **Area 4**: Rust implementation
5. **Area 5**: State management

## Synthesis

After parallel research:
1. Combine findings into synthesis document
2. Identify implementation approach
3. Create detailed implementation plan with phases

## Success Criteria

Research is complete when we have:
- [ ] Mathematical algorithms for both mask types
- [ ] Clear integration points in existing codebase
- [ ] UI/UX design for mask editing
- [ ] Rust implementation strategy
- [ ] State schema design
- [ ] Implementation plan with phases
