# Iterations 111-120

## 111: 2026-01-21 21:00 EST: Export Issue - Research Complete

**Objective**: Research and fix the critical export issue - "Export doesn't actually export anything".

**Background**: The export feature appears to do nothing when triggered. According to docs/issues.md, this is a Critical severity issue discovered on 2026-01-21.

**Root Cause Analysis**:

The export fails silently due to three main issues:

1. **Demo mode breaks `loadImageBytes()`** (`useExport.ts:111-142`)
   - Function requires `catalogService.getCurrentFolder()` to return a real folder handle
   - In demo mode, this returns `null` (no real file system folder)
   - Every export attempt throws `'No folder selected'` silently

2. **No error logging** (`export-service.ts:145-152`)
   - When `processAsset()` fails, the error is captured in `result.failures`
   - But it's NEVER logged to console or displayed to user
   - Makes debugging impossible

3. **MockDecodeService creates empty JPEGs** (`mock-decode-service.ts:574-609`)
   - Returns minimal mock JPEG (~20 bytes) with just SOI/EOI headers
   - Even if demo mode could write files, they'd be corrupt

**Data Flow (showing failure point)**:
```
Export Button → runExport() → ExportService.exportAssets()
    ↓
For each asset:
    loadImageBytes(asset) → getCurrentFolder() → null in demo mode
    ↓
    throw Error('No folder selected') ← FAILS HERE
    ↓
catch: result.failures.push({...}) ← NO CONSOLE LOGGING
    ↓
Export "completes" with 100% failure rate (silently)
```

**Documents Created**:
- `docs/research/2026-01-21-export-fix-synthesis.md` - Full research analysis
- `docs/plans/2026-01-21-export-fix-plan.md` - Implementation plan

**Implementation Plan Summary**:
1. **Phase 1**: Add console.error logging in export catch block
2. **Phase 2**: Fix demo mode - load images via fetch from bundled assets
3. **Phase 3**: Accept mock JPEGs for demo mode (or use real WASM)
4. **Phase 4**: Show export errors in UI (detailed toast)
5. **Phase 5**: Progress indicator in toolbar (enhancement)

**Files Identified for Changes**:
- `packages/core/src/export/export-service.ts` - Add error logging
- `apps/web/app/composables/useExport.ts` - Demo mode image loading
- `apps/web/app/components/export/ExportModal.vue` - Error display

**Status**: Research complete, plan created. Ready for implementation.

---

## 112: 2026-01-21 21:23 EST: Export Fix - Implementation Complete

**Objective**: Fix the critical export issue so export actually produces output files.

**Changes Implemented**:

### Phase 1: Error Logging
- Added `console.error()` in export service catch block (`export-service.ts:146`)
- Errors now logged with asset filename and full error details

### Phase 2: Demo Mode Image Loading
- Added `generateDemoImageBytes()` function in `useExport.ts`
- Generates synthetic JPEG images using canvas for demo mode
- Creates visually distinct images with gradient backgrounds and patterns
- Each demo asset gets a unique appearance based on its index

### Phase 4: Show Export Errors in UI
- Enhanced toast messages to include failure details
- Shows first 3 failed filenames + count of additional failures
- Logs all failures to console for debugging
- Shows first error message when all exports fail

### Phase 5: Progress Indicator in Toolbar
- Added export progress bar to `FilterBar.vue`
- Shows current/total count during export
- Animated progress bar with percentage
- Spinning icon to indicate activity
- Replaces export button while exporting

**Files Modified**:
1. `packages/core/src/export/export-service.ts` - Error logging
2. `apps/web/app/composables/useExport.ts` - Demo mode + error display
3. `apps/web/app/components/catalog/FilterBar.vue` - Progress indicator

**Testing**:
- All 363 unit tests pass
- Browser verification pending

**Status**: Implementation complete. Ready for verification and commit.

---

## 113: 2026-01-21 21:28 EST: Local Masks - Phase 6 (Preview Pipeline Integration)

**Objective**: Integrate mask rendering into the preview pipeline so masks actually affect the displayed image.

**Background**: Phases 1-5 of local masks are complete:
- Phase 1: TypeScript types and schema (v4)
- Phase 2: Rust mask evaluation algorithms
- Phase 3: WASM bindings for `apply_masked_adjustments`
- Phase 4: Worker integration
- Phase 5: Edit store state management

The preview pipeline needs to call the mask processing step after global adjustments and tone curve.

**Status**: Complete

**Changes Made**:
1. **useEditPreview.ts**: Integrated masks into the preview pipeline
   - Added `MaskStackData` import from `@literoom/core/decode`
   - Added `hasMasks` check alongside `hasAdjustments` and `hasTransforms`
   - Added Step 5: Apply masked adjustments after tone curve, converting `editStore.masks` to `MaskStackData` format
   - Added watcher for `editStore.masks` changes to trigger throttled re-render
   - Updated pipeline order comment to document the complete flow: Rotate -> Crop -> Adjustments -> Tone Curve -> Masked Adjustments

2. **decode-worker-pool.ts**: Added missing `applyMaskedAdjustments` method
   - Imported `MaskStackData` type
   - Implemented load-balanced `applyMaskedAdjustments` matching `IDecodeService` interface

**Testing**: All 362 unit tests pass. The integration connects the existing mask state management (Phase 5) to the WASM mask processing (Phases 2-4).

**Next Steps**: Phase 7 (Mask UI) will add the UI components for creating and editing masks in the edit view.

---

## 114: 2026-01-21 21:33 EST: Crop Bug Research - Issue Resolved (Not a Bug)

**Objective**: Research and fix the high-severity issue "Crop doesn't update the image".

**Background**: From docs/issues.md:
- Crop overlay UI works (handles can be dragged, region can be moved)
- No way to "set" or "lock in" the crop
- The actual image/preview is never updated with the crop

**Research Process**:
1. Launched 4 parallel research agents to investigate:
   - Preview pipeline (where crop is applied)
   - Store state management (how crop values are stored)
   - WASM implementation (crop functions)
   - UI components (how they interact)

2. All agents confirmed crop implementation is **complete and working**:
   - WASM `applyCrop()` function exists and works correctly
   - Worker handler for crop operations exists
   - `DecodeService.applyCrop()` method exists
   - Preview pipeline applies crop at STEP 2 (after rotation, before adjustments)
   - Store correctly manages crop state with `setCrop()` action
   - Watchers trigger re-render when `editStore.cropTransform` changes

3. Browser testing confirmed:
   - Console shows `[useEditPreview] Applying crop:` log when crop is set
   - Crop IS being applied to the preview

**Root Cause of Confusion**:
The issue was a **misunderstanding of expected behavior**, not a bug. The app follows the same pattern as Lightroom:

1. **When crop tool is ACTIVE** (Crop & Transform expanded):
   - Full image shown with crop overlay
   - User can see and adjust crop region with handles
   - Dark mask shows area to be cropped out

2. **When crop tool is INACTIVE** (Crop & Transform collapsed):
   - Only cropped region is displayed
   - Preview shows final cropped result

**Resolution**: Marked issue as SOLVED in `docs/issues.md`. The behavior is correct and matches professional photo editors.

**Screenshots**:
- `docs/screenshots/crop-test-08-after-long-wait.png` - Tool active (full image + overlay)
- `docs/screenshots/crop-test-09-crop-collapsed.png` - Tool inactive (cropped result)

**Status**: Complete - Issue resolved as "working as designed"

---

---

