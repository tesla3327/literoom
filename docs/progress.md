# Literoom Development Progress

## Current Status

**Last Updated**: 2026-01-21 10:20 EST
**Current Phase**: Phase 9 Complete - TypeScript Integration for apply_adjustments()

## Project Structure

```
literoom/
├── .github/workflows/ci.yml     # CI/CD pipeline
├── .vscode/                     # VS Code settings
├── apps/web/                    # Nuxt 4 application
│   ├── app/                     # Nuxt app directory
│   ├── e2e/                     # Playwright tests
│   ├── test/                    # Vitest tests
│   └── nuxt.config.ts
├── packages/
│   ├── core/                    # Shared TypeScript logic
│   │   └── src/
│   │       ├── filesystem/      # FS abstraction layer
│   │       ├── decode/          # Image decode types & services
│   │       └── catalog/         # Catalog service (scan, thumbnails, db)
│   └── wasm/                    # WASM output (generated)
├── crates/
│   ├── literoom-core/           # Rust image processing
│   └── literoom-wasm/           # WASM bindings
├── docs/
│   ├── spec.md                  # Product specification
│   ├── research/                # Research documents
│   ├── plans/                   # Implementation plans
│   └── progress.md              # This file
├── Cargo.toml                   # Rust workspace
├── pnpm-workspace.yaml          # pnpm workspace
└── package.json                 # Root scripts
```

## Completed Work

### 50: 2026-01-21 10:20 EST: Phase 9 Complete - TypeScript Integration for apply_adjustments()

**Objective**: Complete Phases 9.3-9.6 to enable real-time photo editing with WASM-based adjustments.

**Work Completed**:

**Phase 9.3 - Worker Message Types**:
- Added `Adjustments` interface to `packages/core/src/decode/types.ts` (10 adjustment properties)
- Added `ApplyAdjustmentsRequest` to `packages/core/src/decode/worker-messages.ts`
- Exported new types from `packages/core/src/decode/index.ts`

**Phase 9.4 - Worker Handler**:
- Added `apply-adjustments` case to decode-worker.ts switch statement
- Imports `apply_adjustments`, `BasicAdjustments`, `JsDecodedImage` from WASM
- Creates WASM types, applies adjustments, returns result with Transferable pixels
- Proper WASM memory cleanup (free input, output, and adjustments)

**Phase 9.5 - Decode Service Method**:
- Added `applyAdjustments()` method to `IDecodeService` interface
- Implemented method in `DecodeService` class
- Implemented method in `MockDecodeService` for testing
- Added `onApplyAdjustments` handler option to mock service options

**Phase 9.6 - Preview Integration**:
- Rewrote `useEditPreview.ts` composable to use WASM-based adjustment application
- Added helper functions: `rgbToRgba()`, `pixelsToUrl()`, `loadImagePixels()`
- Caches source pixels to avoid reloading on each adjustment change
- Uses `$decodeService.applyAdjustments()` to apply edits in Web Worker
- Proper blob URL memory management (revokes old URLs)
- Debounced renders (300ms) during slider drag

**Test Results**:
- `packages/core`: 226 tests passing
- `literoom-core`: 76 tests passing
- `literoom-wasm`: 19 tests passing
- TypeScript compiles (pre-existing errors in catalog unrelated)

**Files Modified**:
- `packages/core/src/decode/types.ts` (added Adjustments)
- `packages/core/src/decode/worker-messages.ts` (added ApplyAdjustmentsRequest)
- `packages/core/src/decode/index.ts` (added export)
- `packages/core/src/decode/decode-worker.ts` (added handler)
- `packages/core/src/decode/decode-service.ts` (added method)
- `packages/core/src/decode/mock-decode-service.ts` (added method)
- `apps/web/app/composables/useEditPreview.ts` (full rewrite)

**Next Step**: Test the edit view in browser to verify adjustments work, or move to Phase 10 (Histogram Display).

---

### 49: 2026-01-21 10:09 EST: Phase 9.2 Complete - WASM Bindings for apply_adjustments()

**Objective**: Expose the `apply_adjustments()` function to JavaScript via WASM bindings.

**Work Completed**:

**Updated `crates/literoom-wasm/src/types.rs`**:
- Added `JsDecodedImage::new(width, height, pixels)` constructor for creating images from JavaScript

**Updated `crates/literoom-wasm/src/adjustments.rs`**:
- Added `apply_adjustments(image, adjustments)` WASM-bound function
- Takes a `JsDecodedImage` and `BasicAdjustments`, returns a new adjusted image
- Clones input pixels to avoid modifying the original image
- Added `inner()` method to `BasicAdjustments` to access core type

**Updated `crates/literoom-wasm/src/lib.rs`**:
- Exported `apply_adjustments` function

**Unit Tests** (5 new tests in literoom-wasm):
- Identity test (default adjustments = no change)
- Exposure test (+1 stop = 2x brightness)
- Contrast test (dark pixel gets darker)
- Non-destructive test (original image unchanged)

**Test Results**:
- `literoom-core`: 76 tests passing
- `literoom-wasm`: 19 tests passing (5 new apply_adjustments tests)
- Clippy: No warnings
- Formatting: Passes
- WASM build: Succeeds (447KB)

**TypeScript API**:
```typescript
// Create image from pixels
const image = new JsDecodedImage(width, height, pixels);

// Set up adjustments
const adj = new BasicAdjustments();
adj.exposure = 1.0;  // +1 stop
adj.contrast = 20;   // +20 contrast

// Apply adjustments (returns new image)
const adjusted = apply_adjustments(image, adj);
const outputPixels = adjusted.pixels();
```

**Files Modified**:
- `crates/literoom-wasm/src/types.rs` (added constructor)
- `crates/literoom-wasm/src/adjustments.rs` (added apply_adjustments + tests)
- `crates/literoom-wasm/src/lib.rs` (added export)

**Next Step**: Phase 9.3 - Worker Message Types for apply-adjustments requests.

---

### 48: 2026-01-21 10:08 EST: Phase 9.1 Complete - Rust Adjustment Module

**Objective**: Implement core adjustment algorithms in Rust for applying the 10 basic adjustments to image pixels.

**Work Completed**:

**Created `crates/literoom-core/src/adjustments.rs`**:
- `apply_all_adjustments(pixels, adjustments)` - Main function to apply all adjustments in a single pass
- Individual adjustment functions:
  - `apply_exposure` - Exposure in stops (-5 to +5), using `2^exposure` multiplier
  - `apply_contrast` - Contrast adjustment (-100 to +100), pivot around midpoint
  - `apply_temperature` - White balance warm/cool (-100 to +100)
  - `apply_tint` - Green/magenta tint (-100 to +100)
  - `apply_highlights` - Affects bright areas only (luminance > 0.5)
  - `apply_shadows` - Affects dark areas only (luminance < 0.5)
  - `apply_whites` - Affects brightest pixels (max channel > 0.9)
  - `apply_blacks` - Affects darkest pixels (min channel < 0.1)
  - `apply_saturation` - Global saturation adjustment
  - `apply_vibrance` - Smart saturation protecting skin tones and already-saturated colors
- Helper functions: `calculate_luminance`, `smoothstep`
- Early exit optimization when all adjustments are at default values
- Single-pass pixel processing for cache efficiency

**Unit Tests** (26 new tests):
- Identity tests (no change with default adjustments)
- Individual adjustment tests (exposure, contrast, temperature, tint, etc.)
- Boundary tests (extreme values don't crash)
- Multi-pixel tests
- Edge case tests (empty pixels, incomplete pixel data)

**Test Results**:
- `literoom-core`: 76 tests passing (26 new adjustment tests + 50 existing)
- Clippy: No warnings
- Formatting: Passes

**Files Created**:
- `crates/literoom-core/src/adjustments.rs`

**Files Modified**:
- `crates/literoom-core/src/lib.rs` (added `pub mod adjustments`)

**Next Step**: Phase 9.2 - WASM bindings for `apply_adjustments()` function.

---

### 47: 2026-01-21 10:03 EST: Phase 9 Research Complete - WASM Edit Pipeline

**Objective**: Research and plan the implementation of `apply_adjustments()` function to enable real-time photo editing.

**Work Completed**:

**Research Documents Created**:
- `docs/research/2026-01-21-wasm-edit-pipeline-research-plan.md` - Research plan
- `docs/research/2026-01-21-wasm-edit-pipeline-synthesis.md` - Combined findings

**Implementation Plan Created**:
- `docs/plans/2026-01-21-wasm-edit-pipeline-plan.md` - Detailed 6-phase plan

**Key Findings**:

1. **Existing Infrastructure**:
   - `BasicAdjustments` struct fully defined in Rust
   - WASM bindings already expose getters/setters
   - Decode worker/service pattern ready for extension
   - `useEditPreview` has placeholder for WASM integration

2. **Missing Piece**:
   - No `apply_adjustments(pixels, adjustments)` function exists
   - Need to implement 10 adjustment algorithms in Rust
   - Need to wire through worker/service to composable

3. **Adjustment Algorithms** (researched formulas for all 10):
   - Exposure: `pixel * 2^(exposure_value)`
   - Contrast: `(pixel - 0.5) * factor + 0.5`
   - Temperature/Tint: Per-channel RGB multipliers
   - Highlights/Shadows: Luminance-based selective adjustment
   - Whites/Blacks: Threshold-based extremes adjustment
   - Saturation: HSV conversion, multiply S channel
   - Vibrance: Selective saturation protecting skin tones

4. **Performance Strategy**:
   - Draft quality: 600px, <50ms (during slider drag)
   - Full quality: 2560px, <300ms (after slider release)
   - 300ms debounce (already implemented)

**Implementation Plan Structure** (6 phases):
- Phase 9.1: Rust Adjustment Module (`crates/literoom-core/src/adjustments.rs`)
- Phase 9.2: WASM Bindings (`apply_adjustments` function)
- Phase 9.3: Worker Message Types (`ApplyAdjustmentsRequest`)
- Phase 9.4: Worker Handler (decode-worker.ts)
- Phase 9.5: Decode Service Method (`applyAdjustments()`)
- Phase 9.6: Preview Integration (useEditPreview.ts)

**Files to Create**:
- `crates/literoom-core/src/adjustments.rs` - Adjustment algorithms

**Files to Modify**:
- `crates/literoom-core/src/lib.rs` - Add module export
- `crates/literoom-wasm/src/adjustments.rs` - Add WASM binding
- `crates/literoom-wasm/src/lib.rs` - Export function
- `packages/core/src/decode/worker-messages.ts` - Add message type
- `packages/core/src/decode/decode-worker.ts` - Add handler
- `packages/core/src/decode/decode-service.ts` - Add method
- `apps/web/app/composables/useEditPreview.ts` - Wire to WASM

**Next Step**: Phase 9.1 - Implement Rust adjustment algorithms.

---

### 46: 2026-01-21 10:15 EST: Fixed CSS Loading - Upgraded to Nuxt 4 and Nuxt UI 4

**Objective**: Fix CSS not loading in the application.

**Problem Identified**:
The app's CSS file (`main.css`) used Tailwind v4 / Nuxt UI v4 syntax:
```css
@import "tailwindcss";
@import "@nuxt/ui";
```

But the app was running on older versions:
- `nuxt: ^3.15.4` (not v4)
- `@nuxt/ui: ^3.0.0` (not v4)

Additionally, in Nuxt 4's directory structure, `~/assets` resolves to `app/assets/`. The file at `app/assets/css/main.css` was **empty** (0 bytes), while the content existed in the old location `assets/css/main.css`.

**Fixes Applied**:

1. **Upgraded dependencies** in `apps/web/package.json`:
   - `nuxt`: `^3.15.4` → `^4.2.2`
   - `@nuxt/ui`: `^3.0.0` → `^4.4.0`

2. **Fixed the CSS file** at `app/assets/css/main.css`:
   ```css
   @import "tailwindcss";
   @import "@nuxt/ui";
   ```

3. **Cleaned up** duplicate old `assets/css/main.css` file

**Verification**:
- App now displays correctly with Nuxt UI v4 styling (dark theme, styled buttons, proper layout)
- Browser automation confirmed CSS loading via screenshot

**Files Modified**:
- `apps/web/package.json` (dependency upgrades)
- `apps/web/app/assets/css/main.css` (added CSS imports)
- `docs/issues.md` (marked issues as resolved)

**Files Deleted**:
- `apps/web/assets/css/main.css` (duplicate old file)

---

### 45: 2026-01-21 09:56 EST: Phase 8.5 Verified Complete - Keyboard Shortcuts

**Objective**: Verify and document that Phase 8.5 (Keyboard Shortcuts) was already implemented as part of the edit view shell.

**Verification**:
- Reviewed `apps/web/app/pages/edit/[id].vue`
- All Phase 8.5 requirements were already implemented:
  - Escape key returns to grid ✅
  - Left/Right arrows navigate between photos ✅
  - G key also returns to grid ✅
  - Shortcuts ignore input when typing in form fields ✅
  - Event listener cleanup on unmount ✅

**Phase 8 Edit View is now complete!** All sub-phases delivered:
- Phase 8.1: Edit Page Shell
- Phase 8.2: Edit State Store
- Phase 8.3: Basic Adjustments UI
- Phase 8.4: Preview with Edits
- Phase 8.5: Keyboard Shortcuts

**Next Step**: Phase 9 - WASM Edit Pipeline (apply_adjustments function), OR address Nuxt v3→v4 version issue in docs/issues.md.

---

### 44: 2026-01-21 09:57 EST: Phase 8.4 Complete - Preview with Edits

**Objective**: Implement the useEditPreview composable for managing preview rendering in the edit view.

**Work Completed**:

**useEditPreview Composable** (`apps/web/app/composables/useEditPreview.ts`):
- Manages preview rendering pipeline for edit view
- Loads source preview for asset (currently uses thumbnail)
- Watches for edit changes and triggers debounced renders
- Provides draft/full render quality indicators
- Implements internal debounce utility (no VueUse dependency needed)
- Placeholder for WASM-based edit application (Phase 9)

**EditPreviewCanvas Updates** (`apps/web/app/components/edit/EditPreviewCanvas.vue`):
- Now uses useEditPreview composable
- Shows rendering indicator (top-right) during preview updates
- Shows quality indicator (Draft) during draft renders
- Proper states: loading, preview, error, no-preview
- All states have data-testid for E2E testing

**Key Features**:
- 300ms debounce for slider changes
- Immediate preview load when asset changes
- Debounce cancellation on asset switch
- Error handling with user-friendly messages
- Placeholder ready for WASM integration in Phase 9

**Test Results**:
- `packages/core`: 226 tests passing
- No new lint errors in created files

**Files Created**:
- `apps/web/app/composables/useEditPreview.ts`

**Files Modified**:
- `apps/web/app/components/edit/EditPreviewCanvas.vue`
- `apps/web/app/components/edit/EditControlsPanel.vue` (fixed unused var lint error)

**Next Step**: Phase 8.5 - Keyboard Shortcuts for edit view (Escape to return, Left/Right to navigate).

---

### 43: 2026-01-21 09:05 EST: E2E Infrastructure Fixed - Tailwind CSS v4 and Plugin Issues Resolved

**Objective**: Fix E2E test infrastructure issues that were blocking test execution.

**Issues Resolved**:

1. **Tailwind CSS v4 `@apply` in scoped styles** - Components using `@apply` in Vue scoped style blocks failed with "Cannot apply unknown utility class" error
   - **Solution**: Refactored all components to use inline Tailwind utility classes instead of `@apply` in scoped styles (recommended approach for Tailwind v4)
   - Components updated: `FilterBar.vue`, `CatalogGrid.vue`, `CatalogThumbnail.vue`, `index.vue`
   - Kept minimal scoped styles only for CSS animations (shimmer) and pseudo-selectors (hover state)

2. **Nuxt component auto-import naming** - Components in `components/catalog/` weren't resolving correctly
   - **Solution**: Added `pathPrefix: false` to `components` config in `nuxt.config.ts`
   - Updated component references in templates (e.g., `CatalogCatalogGrid` → `CatalogGrid`)

3. **Duplicate plugin conflict** - Two plugins were both providing `$decodeService`, causing "Cannot redefine property" error
   - **Solution**: Removed duplicate `decode.client.ts` plugin (functionality already included in `catalog.client.ts`)

4. **Test selector update** - Test used `.catalog-header` class that was replaced with inline utilities
   - **Solution**: Updated test to use `header` element selector instead

**E2E Test Results**:
- **17 tests passing** (up from 4 initially passing)
- **11 tests failing** - These failures reveal actual implementation gaps:
  - Virtual scrolling not working (all 50 items render)
  - Filter modes not filtering results
  - Keyboard navigation not working (arrow keys, flag shortcuts)
- All folder-selection tests now pass (6/6)
- All example tests pass (2/2)
- Basic catalog-grid tests pass (4/5)
- Basic filter-modes tests pass (5/9)

**Files Modified**:
- `apps/web/nuxt.config.ts` (added `components.pathPrefix: false`)
- `apps/web/app/pages/index.vue` (inline utility classes, component names)
- `apps/web/app/components/catalog/FilterBar.vue` (inline utility classes)
- `apps/web/app/components/catalog/CatalogGrid.vue` (inline utility classes)
- `apps/web/app/components/catalog/CatalogThumbnail.vue` (inline utility classes)
- `apps/web/app/plugins/catalog.client.ts` (no changes needed, already complete)
- `apps/web/e2e/folder-selection.spec.ts` (updated header selector)

**Files Deleted**:
- `apps/web/app/plugins/decode.client.ts` (duplicate functionality)

**Next Steps**: The remaining 11 failing tests reveal implementation gaps:
1. Fix virtual scrolling (currently renders all 50 items)
2. Implement filter mode functionality (clicking filters should filter assets)
3. Implement keyboard navigation (arrow keys, P/X/U flag shortcuts)

---

### 42: 2026-01-21 07:35 EST: Phase 7.4 Complete - E2E Test Files Created

**Objective**: Create Playwright E2E tests for catalog workflows.

**Work Completed**:

**Playwright Configuration**:
- Updated `apps/web/playwright.config.ts`:
  - Added `LITEROOM_DEMO_MODE=true` to webServer command
  - Increased timeout to 120 seconds for server startup
- Disabled runtime typeCheck in `apps/web/nuxt.config.ts` (CI handles separately)

**Component Updates (data-testid attributes)**:
- `CatalogGrid.vue`: Added `data-testid="catalog-grid"`
- `CatalogThumbnail.vue`: Added `data-testid="catalog-thumbnail"`, `data-current`, `data-flag`, and flag badge with `data-testid="flag-badge"`
- `FilterBar.vue`: Added `data-testid="filter-bar"`, per-button `data-testid="filter-{mode}"`, `data-active`, and count badges `data-testid="filter-{mode}-count"`

**E2E Test Files Created**:
- `apps/web/e2e/catalog-grid.spec.ts`:
  - Grid display with thumbnails
  - Virtual scrolling renders only visible rows
  - Scrolling maintains functionality
  - Click to select thumbnails
  - Thumbnail loading states

- `apps/web/e2e/keyboard-navigation.spec.ts`:
  - Arrow key navigation (left/right)
  - P key picks current photo
  - X key rejects current photo
  - U key clears flag
  - Flag changes persist while navigating

- `apps/web/e2e/filter-modes.spec.ts`:
  - Filter bar displays all buttons
  - All filter active by default
  - Filter buttons show count badges
  - Picks/Rejects/Unflagged filtering
  - Filter counts update when flags change

- `apps/web/e2e/folder-selection.spec.ts`:
  - Welcome screen displays initially
  - Demo mode indicator visible
  - Choose folder button loads demo catalog
  - Welcome screen hidden after selection
  - Page structure after loading

**Known Issue**:
- E2E tests cannot run due to Tailwind CSS v4 configuration issue
- Error: "Cannot apply unknown utility class px-4. Are you using CSS modules or similar and missing @reference?"
- This is a pre-existing infrastructure issue unrelated to the E2E tests
- Tests are ready to run once Tailwind/Nuxt UI configuration is resolved

**Files Created**:
- `apps/web/e2e/catalog-grid.spec.ts`
- `apps/web/e2e/keyboard-navigation.spec.ts`
- `apps/web/e2e/filter-modes.spec.ts`
- `apps/web/e2e/folder-selection.spec.ts`

**Files Modified**:
- `apps/web/playwright.config.ts`
- `apps/web/nuxt.config.ts`
- `apps/web/app/components/catalog/CatalogGrid.vue`
- `apps/web/app/components/catalog/CatalogThumbnail.vue`
- `apps/web/app/components/catalog/FilterBar.vue`

**Next Step**: Resolve Tailwind CSS v4 configuration issue to enable E2E testing, then proceed to Phase 7.5 (Unit Tests).

---

### 41: 2026-01-21 07:16 EST: Phase 7.3 Complete - Demo Mode Assets

**Objective**: Create demo images and test fixtures for E2E testing.

**Work Completed**:

**Demo Images**:
- Created `apps/web/public/demo-images/` directory
- Generated 5 placeholder JPEG images (256x256 solid colors):
  - `demo-0.jpg` - Blue (#4285F4)
  - `demo-1.jpg` - Green (#34A853)
  - `demo-2.jpg` - Red (#EA4335)
  - `demo-3.jpg` - Gray (#9E9E9E)
  - `demo-4.jpg` - Purple (#9C27B0)

**Test Fixtures**:
- Created `apps/web/test/fixtures/demo-catalog.ts`:
  - `DEMO_CATALOG_SIZE` constant (50)
  - `createTestCatalog()` - create catalog with optional overrides
  - `createSmallTestCatalog()` - create smaller catalog for quick tests
  - `findAssetsByFlag()` - filter assets by flag status
  - `getExpectedFlagCounts()` - get expected counts for assertions
  - `createTestAsset()` - create single asset with overrides
  - `DEMO_IMAGE_URLS` - array of demo image paths
  - `getDemoImageUrl()` - get demo URL by index (cycles through)
  - Re-exports from `@literoom/core/catalog` for convenience

**Test Summary**:
- `packages/core`: 200 tests passing

**Files Created**:
- `apps/web/public/demo-images/demo-0.jpg`
- `apps/web/public/demo-images/demo-1.jpg`
- `apps/web/public/demo-images/demo-2.jpg`
- `apps/web/public/demo-images/demo-3.jpg`
- `apps/web/public/demo-images/demo-4.jpg`
- `apps/web/test/fixtures/demo-catalog.ts`

**Next Step**: Phase 7.4 - E2E Tests (Playwright tests for grid, keyboard, filters, folder selection).

---

### 40: 2026-01-21 07:14 EST: Phase 7.1 & 7.2 Complete - Mock Services & Nuxt Plugin Integration

**Objective**: Implement mock services for demo mode and integrate CatalogService with Nuxt plugin.

**Work Completed**:

**Phase 7.1 (Mock Services)** - Already implemented:
- Verified `packages/core/src/catalog/demo-assets.ts` exists with:
  - `createDemoAsset()` and `createDemoAssets()` functions
  - Configurable flag distribution (pick/reject/unflagged rates)
  - Deterministic generation based on index
  - 24 unit tests passing
- Verified `packages/core/src/catalog/mock-catalog-service.ts` exists with:
  - Full `ICatalogService` implementation
  - Configurable delays for scan and thumbnail operations
  - Callback support (onAssetsAdded, onAssetUpdated, onThumbnailReady)
  - 46 unit tests passing
- Verified `packages/core/src/filesystem/mock.ts` exists with:
  - `MockFileSystemProvider` implementing `FileSystemProvider`
  - Configurable permission states and failure modes
  - 43 unit tests passing

**Phase 7.2 (Nuxt Plugin Integration)** - Newly implemented:
- Updated `apps/web/nuxt.config.ts`:
  - Added `runtimeConfig.public.demoMode` from `LITEROOM_DEMO_MODE` env var
- Created `apps/web/app/plugins/catalog.client.ts`:
  - Creates CatalogService (real or mock based on demo mode)
  - Creates DecodeService (real or mock based on demo mode)
  - Wires service callbacks to Pinia stores
  - Provides `$catalogService`, `$decodeService`, `$isDemoMode`
- Created `apps/web/app/composables/useCatalog.ts`:
  - `selectFolder()` - handles folder selection (mock or real)
  - `restoreSession()` - restore from saved handle
  - `setFlag()`, `pick()`, `reject()`, `clearFlag()` - flag operations
  - `requestThumbnail()`, `updateThumbnailPriority()` - thumbnail requests
- Updated `apps/web/app/pages/index.vue`:
  - Simplified to use `useCatalog` composable
  - Removed direct service instantiation
  - Added demo mode indicator banner
  - Added data-testid attributes for E2E testing
- Created `.nvmrc` file specifying Node 22

**Test Summary**:
- `packages/core`: 200 tests passing (including mock services)
- No new type errors in plugin/composable files

**Files Created**:
- `apps/web/app/plugins/catalog.client.ts`
- `apps/web/app/composables/useCatalog.ts`
- `.nvmrc`

**Files Modified**:
- `apps/web/nuxt.config.ts`
- `apps/web/app/pages/index.vue`
- `docs/progress.md`

**Next Step**: Phase 7.3 - Demo Mode Assets (create demo images in public/demo-images/).

---

### 39: 2026-01-21 07:00 EST: Phase 7 Implementation Plan Created

**Objective**: Create detailed implementation plan for Phase 7 (Integration and Testing).

**Work Completed**:
- Created implementation plan: `docs/plans/2026-01-21-integration-testing-plan.md`

**Plan Structure** (5 phases):
1. **Phase 7.1: Mock Services** - demo-assets factory, MockFileSystemProvider, MockCatalogService
2. **Phase 7.2: Nuxt Plugin Integration** - catalog.client.ts plugin, useCatalog composable
3. **Phase 7.3: Demo Mode Assets** - public/demo-images/, test fixtures
4. **Phase 7.4: E2E Tests** - Playwright tests for grid, keyboard, filters, folder selection
5. **Phase 7.5: Unit Tests** - Store tests, mock service tests

**Key Implementation Details**:
- Demo mode toggle via `LITEROOM_DEMO_MODE=true` environment variable
- MockCatalogService follows existing MockDecodeService patterns
- Nuxt plugin wires service callbacks to Pinia stores
- E2E tests run against demo mode (no File System Access API needed)
- 50 demo assets with mixed flag states for realistic testing

**Files to Create**:
- `packages/core/src/catalog/demo-assets.ts`
- `packages/core/src/catalog/mock-catalog-service.ts`
- `packages/core/src/filesystem/mock.ts`
- `apps/web/app/plugins/catalog.client.ts`
- `apps/web/app/composables/useCatalog.ts`
- E2E test files in `apps/web/e2e/`
- Unit test files in `apps/web/test/stores/`

**Next Step**: Begin Phase 7.1 implementation - Mock Services (demo-assets, MockFileSystemProvider, MockCatalogService).

---

### 38: 2026-01-21 06:57 EST: Phase 7 Research Complete - Integration and Testing

**Objective**: Research patterns and best practices for demo mode, E2E testing, and mock services to enable comprehensive testing of the catalog workflow.

**Work Completed**:
- Created research plan covering 6 areas:
  1. Demo mode architecture (toggle mechanism, static assets, mock filesystem)
  2. Mock services patterns (MockCatalogService, MockFileSystemProvider)
  3. Playwright E2E testing (keyboard shortcuts, virtual scrolling, filter modes)
  4. Nuxt plugin integration (callback wiring, session restoration, error handling)
  5. Test fixtures and demo assets (count, dimensions, flag distribution)
  6. Codebase review (current integration state, gaps)

- Created synthesis document combining all findings

**Key Decisions**:
1. **Demo mode**: Enable via `LITEROOM_DEMO_MODE=true` environment variable, checked in Nuxt runtime config
2. **MockFileSystemProvider**: New class fetching demo images from `/demo-images/` URL
3. **MockCatalogService**: Follows existing MockDecodeService pattern with configurable delays
4. **CatalogService Plugin**: Wire callbacks to stores, handle session restoration
5. **Demo assets**: 25-50 programmatically generated images with varied flag states
6. **E2E tests**: Grid scrolling, keyboard navigation, filter modes, folder selection

**Research Documents Created**:
- `docs/research/2026-01-21-integration-testing-research-plan.md`
- `docs/research/2026-01-21-integration-testing-synthesis.md`

**Implementation Plan Structure** (5 phases):
- Phase 7.1: Mock Services (MockFileSystemProvider, MockCatalogService, demo-assets)
- Phase 7.2: Nuxt Plugin Integration (catalog.client.ts, useCatalog composable)
- Phase 7.3: Demo Mode Assets (public/demo-images/, test fixtures)
- Phase 7.4: E2E Tests (grid, keyboard, filters, folder selection)
- Phase 7.5: Unit Tests (stores, composables, mock services)

**Key Gaps Identified**:
- No CatalogService plugin (service created manually in page)
- No service-store wiring (page directly mutates stores)
- Minimal E2E coverage (only basic smoke tests exist)
- No demo mode for testing without real file system

**Next Step**: Create implementation plan based on synthesis, then begin Phase 7.1 (Mock Services).

---

### 37: 2026-01-21 01:52 EST: Phase 6.6 Complete - Page Integration

**Objective**: Wire all Phase 6 UI components together on the main catalog page.

**Work Completed**:
- Rewrote `apps/web/app/pages/index.vue` to integrate all catalog components:
  - Welcome screen with folder selection when no folder is selected
  - Loading state during initial folder scan
  - Main catalog view with header, FilterBar, and CatalogGrid
  - Permission recovery modal integration

**Key Features**:
- **Folder Selection**: Uses `BrowserFileSystemProvider.selectDirectory()` to pick folders
- **Handle Persistence**: Saves folder handle to IndexedDB for session restoration
- **Scanning**: Lists directory recursively, filters for supported extensions (JPEG, ARW)
- **Batched Processing**: Processes files in batches of 50 for responsive UI
- **Progress Tracking**: Updates `catalogStore.scanProgress` during scan
- **Permission Recovery**: Checks saved handle permissions on app load, shows modal if needed
- **Empty State**: Shows helpful message when no supported images found

**Page Layout**:
```
┌─────────────────────────────────────────────┐
│ Header: [Folder Name] | Selection Count     │
├─────────────────────────────────────────────┤
│ FilterBar: [All][Picks][Rejects][Unflagged] │
│            Sort: Date ▼                     │
├─────────────────────────────────────────────┤
│                                             │
│           CatalogGrid                       │
│     (Virtual scrolling thumbnails)          │
│                                             │
└─────────────────────────────────────────────┘
```

**Files Modified**:
- `apps/web/app/pages/index.vue` (complete rewrite)

**Verification**:
- No TypeScript errors in index.vue or app files
- Pre-existing errors in packages/core are unrelated to this change

**Phase 6 Complete!**

The UI Components phase is now finished. All components are wired together:
- Phase 6.1: Composables (useIntersectionObserver, useGridKeyboard)
- Phase 6.2: CatalogThumbnail component
- Phase 6.3: CatalogGrid with virtual scrolling
- Phase 6.4: FilterBar component
- Phase 6.5: PermissionRecovery store and component
- Phase 6.6: Page integration

**Next Step**: Phase 7 - Integration and Testing (E2E tests, demo mode).

---

### 36: 2026-01-21 06:46 EST: Phase 6.5 Complete - PermissionRecovery Store and Component

**Objective**: Implement permission recovery UI for folder re-authorization when app is reopened.

**Work Completed**:
- Created `apps/web/app/stores/permissionRecovery.ts`:
  - Pinia store following established patterns (Composition API, shallowRef)
  - State: `showModal`, `folderIssues`, `isRechecking`, `error`
  - Computed: `hasIssues`, `accessibleCount`, `issueCount`
  - Actions: `checkFolderPermission`, `addFolderIssue`, `reauthorizeFolder`, `retryAll`, `clearIssues`
  - Uses `BrowserFileSystemProvider` for permission checks
  - Lazy provider initialization to avoid SSR issues

- Created `apps/web/app/components/catalog/PermissionRecovery.vue`:
  - Non-dismissible UModal for blocking permission recovery
  - Lists folders with permission issues
  - Shows folder name, path, and permission state badge
  - Re-authorize button per folder (triggers user gesture for browser API)
  - Error display for failed operations
  - Footer actions: "Choose Different Folder", "Retry All", "Continue"
  - Emits events: `selectNewFolder`, `continue`, `reauthorized`

**Key Implementation Details**:
- `FolderIssue` type: `folderId`, `folderName`, `folderPath`, `permissionState`, `error`
- Permission states: `'prompt'` (needs permission) or `'denied'` (explicitly denied)
- Nuxt UI 4 color mapping: prompt → warning, denied → error
- `reauthorizeFolder()` must be called from button click (browser requirement)
- Store automatically closes modal when all issues resolved

**Files Created**:
- `apps/web/app/stores/permissionRecovery.ts`
- `apps/web/app/components/catalog/PermissionRecovery.vue`

**Verification**:
- No PermissionRecovery-specific type errors (pre-existing errors in packages/core are unrelated)

**Next Step**: Phase 6.6 - Page Integration (wire all components together).

---

### 35: 2026-01-21 06:45 EST: Phase 6.5 Research Complete - PermissionRecovery

**Objective**: Research patterns and best practices for implementing permission recovery UI for folder re-authorization.

**Work Completed**:
- Created research plan covering 5 areas
- Launched 5 parallel research sub-agents to investigate:
  1. **File System Access API Permission States**: Three states (granted/prompt/denied), handles from IndexedDB return 'prompt' by default
  2. **Existing FileSystemProvider**: Already has queryPermission/requestPermission methods, handle persistence via IndexedDB
  3. **Nuxt UI Modal API**: UModal with v-model:open, :dismissible="false", header/body/footer slots
  4. **Pinia Store Patterns**: Composition API setup function, shallowRef for collections, error refs
  5. **Permission Recovery UX**: Blocking modal recommended, clear folder status, re-authorize/choose-different/continue actions

- Created synthesis document combining all findings

**Key Decisions**:
1. **Modal behavior**: Non-dismissible blocking modal since editing requires folder access
2. **Permission check**: Call `queryPermission()` on app load, show modal if not 'granted'
3. **User gestures**: `requestPermission()` must be called from button click (browser requirement)
4. **Store structure**: Lightweight Pinia store with folderIssues, showModal, isRechecking, error
5. **Actions**: "Re-authorize", "Choose Different Folder", "Continue with X accessible"

**Research Documents Created**:
- `docs/research/2026-01-21-permission-recovery-research-plan.md`
- `docs/research/2026-01-21-permission-recovery-synthesis.md`

**Next Step**: Create implementation plan based on synthesis, then implement Phase 6.5 (permissionRecovery store and component).

---

### 34: 2026-01-21 06:41 EST: Phase 6.4 Complete - FilterBar Component

**Objective**: Implement FilterBar component for filtering and sorting photos in the catalog grid.

**Work Completed**:
- Created `apps/web/app/components/catalog/FilterBar.vue`:
  - Filter mode buttons: All, Picks, Rejects, Unflagged
  - Count badges showing number of items per filter
  - Active filter highlighted with solid variant
  - Sort dropdown with options:
    - Date (newest/oldest)
    - Name (A-Z/Z-A)
    - Size (largest/smallest)
  - Sort dropdown displays current sort label
  - Integration with `catalogStore` and `catalogUIStore`

**Key Features**:
- Reactive filter counts from catalogStore (totalCount, pickCount, rejectCount, unflaggedCount)
- Sort options grouped by field type in dropdown menu
- Current sort state displayed in dropdown button
- Tailwind styling with dark theme (gray-950, border-gray-800)
- Uses Nuxt UI components: UButton, UBadge, UDropdownMenu

**Files Created**:
- `apps/web/app/components/catalog/FilterBar.vue`

**Verification**:
- No FilterBar-specific type errors (pre-existing errors in packages/core are unrelated)

**Next Step**: Phase 6.5 - PermissionRecovery store and component.

---

### 33: 2026-01-21 01:39 EST: Phase 6.3 Complete - CatalogGrid Component

**Objective**: Implement CatalogGrid component with virtual scrolling for displaying photo thumbnails.

**Work Completed**:
- Created `apps/web/app/components/catalog/CatalogGrid.vue`:
  - Uses `@tanstack/vue-virtual` for row-only virtualization
  - Responsive column count based on container width (2-5 columns)
  - ResizeObserver for container width tracking
  - Integration with stores: catalogStore, catalogUIStore, selectionStore
  - Keyboard navigation via `useGridKeyboard` composable
  - Click handling with modifier support (single, Ctrl/Cmd, Shift)
  - Scroll-to-item functionality for keyboard navigation
  - Empty state display when no photos match filter
  - Focus management for accessible navigation
  - ARIA attributes: `role="grid"`, `role="row"`, `aria-label`

**Key Features**:
- Virtual scrolling renders only visible rows (+ 2 overscan)
- Automatic column count: 2 (<640px), 3 (<1024px), 4 (<1280px), 5 (≥1280px)
- Row height calculated from container width for aspect-square thumbnails
- Syncs selection state with selectionStore
- Supports flag shortcuts (P/X/U) via keyboard handler
- View mode switching (E/Enter for edit, G for grid)

**Files Created**:
- `apps/web/app/components/catalog/CatalogGrid.vue`

**Verification**:
- No CatalogGrid-specific type errors (pre-existing errors in packages/core are unrelated)

**Next Step**: Phase 6.4 - FilterBar component.

---

### 32: 2026-01-21 06:36 EST: Phase 6.2 Complete - CatalogThumbnail Component

**Objective**: Implement CatalogThumbnail component for displaying individual photos in the catalog grid.

**Work Completed**:
- Created `apps/web/app/components/catalog/CatalogThumbnail.vue`:
  - Props: `asset`, `isSelected`, `isCurrent`, `index`
  - Emits: `click` event for selection handling
  - Four thumbnail states: pending, loading, error, ready
  - Loading skeleton with shimmer animation
  - Error state with icon and "Failed" text
  - Flag badge (top-left): green check for picks, red X for rejects
  - Selection indicator (top-right): cyan circle with checkmark
  - Focus ring (blue) for current/focused thumbnail
  - Selection ring (cyan) for selected thumbnails
  - Filename overlay on hover (gradient fade)
  - Proper ARIA attributes: `role="gridcell"`, `aria-selected`
  - Roving tabindex support (`tabindex="0"` for current, `-1` otherwise)

**Key Features**:
- Aspect-square thumbnails with rounded corners
- CSS-only shimmer animation for loading state
- Object-fit cover for image display
- Transition animations for hover/focus states
- Tailwind CSS utilities with scoped styles
- Lazy loading and async decoding for images

**Files Created**:
- `apps/web/app/components/catalog/CatalogThumbnail.vue`

**Verification**:
- No CatalogThumbnail-specific type errors (pre-existing errors in packages/core are unrelated)

**Next Step**: Phase 6.3 - CatalogGrid component with virtual scrolling.

---

### 31: 2026-01-21 06:34 EST: Phase 6.1 Complete - Composables Implemented

**Objective**: Implement Phase 6.1 composables for intersection observer and keyboard navigation.

**Work Completed**:
- Installed `@tanstack/vue-virtual` dependency (apps/web)
- Created `apps/web/app/composables/useIntersectionObserver.ts`:
  - `useIntersectionObserver()` - Track single element visibility with callback
  - `useIntersectionObserverBatch()` - Efficiently observe multiple elements with one observer
  - Configurable threshold, rootMargin, and root element
  - Automatic cleanup on unmount
- Created `apps/web/app/composables/useGridKeyboard.ts`:
  - Grid-aware arrow key navigation (left/right/up/down)
  - Flag shortcuts: P (pick), X (reject), U (clear)
  - View shortcuts: E/Enter (edit), G (grid), D (develop)
  - `shouldIgnoreShortcuts()` helper to skip when typing in inputs
  - `scrollIntoViewIfNeeded()` helper for smooth scrolling
  - Handles edge cases (no selection, boundary conditions)

**Key Features**:
- Both composables auto-import via Nuxt's composables directory
- Proper cleanup on component unmount
- TypeScript interfaces for all options and return types
- No new type errors introduced (verified via typecheck)

**Files Created**:
- `apps/web/app/composables/useIntersectionObserver.ts`
- `apps/web/app/composables/useGridKeyboard.ts`

**Files Modified**:
- `apps/web/package.json` (added @tanstack/vue-virtual)

**Next Step**: Phase 6.2 - CatalogThumbnail component.

---

### 30: 2026-01-21 06:16 EST: Catalog Service - Phase 6 Implementation Plan Created

**Objective**: Create detailed implementation plan for Phase 6 UI Components based on research synthesis.

**Work Completed**:
- Created implementation plan: [UI Components Plan](./plans/2026-01-21-ui-components-plan.md)

**Plan Structure** (6 phases):
1. **Phase 6.1: Composables** - useIntersectionObserver, useGridKeyboard
2. **Phase 6.2: CatalogThumbnail** - Loading states, selection, flag badges
3. **Phase 6.3: CatalogGrid** - Virtual scrolling with @tanstack/vue-virtual
4. **Phase 6.4: FilterBar** - Filter buttons, sort dropdown, count badges
5. **Phase 6.5: PermissionRecovery** - Modal for folder re-authorization
6. **Phase 6.6: Page Integration** - Wire components together

**Key Implementation Details**:
- Row-only virtualization (simpler than dual-axis)
- Responsive columns via ResizeObserver (2-5 columns based on width)
- Roving tabindex for accessible keyboard navigation
- Centralized click handling with event delegation
- Store-managed Object URLs for memory safety
- Nuxt UI components (UButton, UBadge, UModal, UDropdownMenu)

**Dependencies to Add**:
- `@tanstack/vue-virtual` (apps/web)

**Files to Create**:
- `apps/web/app/composables/useIntersectionObserver.ts`
- `apps/web/app/composables/useGridKeyboard.ts`
- `apps/web/app/components/catalog/CatalogThumbnail.vue`
- `apps/web/app/components/catalog/CatalogGrid.vue`
- `apps/web/app/components/catalog/FilterBar.vue`
- `apps/web/app/components/catalog/PermissionRecovery.vue`
- `apps/web/app/stores/permissionRecovery.ts`

**Next Step**: Begin Phase 6.1 implementation - composables (useIntersectionObserver, useGridKeyboard).

---

### 29: 2026-01-21 03:06 EST: Catalog Service - Phase 6 Research Complete (UI Components)

**Objective**: Research patterns and best practices for implementing catalog UI components.

**Work Completed**:
- Created research plan covering 6 areas
- Launched 6 parallel research sub-agents to investigate:
  1. **Virtual Scrolling**: @tanstack/vue-virtual for responsive photo grid
  2. **Thumbnail Component**: Loading states, selection, badges, click handling
  3. **Filter Bar**: Nuxt UI components (UFieldGroup, UButton, UBadge)
  4. **Permission Recovery**: Modal patterns, re-authorization flow
  5. **Keyboard Navigation**: Arrow keys, shortcuts (P/X/U), roving tabindex
  6. **Codebase Review**: Existing patterns, store integration, CSS conventions

- Created synthesis document combining all findings

**Key Decisions**:
1. **Virtual scrolling**: Row-only virtualization (simpler than dual-axis)
2. **Thumbnail component**: Skeleton loading, store-managed Object URLs
3. **Filter bar**: UFieldGroup with UButton + UBadge, defineShortcuts for keyboard
4. **Keyboard navigation**: useGridKeyboard composable with roving tabindex
5. **Styling**: Tailwind dark theme (gray-950), following existing patterns

**Dependencies to Add**:
- `@tanstack/vue-virtual` for virtual scrolling

**Files to Create**:
- `apps/web/app/components/catalog/CatalogGrid.vue`
- `apps/web/app/components/catalog/CatalogThumbnail.vue`
- `apps/web/app/components/catalog/FilterBar.vue`
- `apps/web/app/components/catalog/PermissionRecovery.vue`
- `apps/web/app/composables/useGridKeyboard.ts`
- `apps/web/app/composables/useIntersectionObserver.ts`
- `apps/web/app/stores/permissionRecovery.ts`

**Research Documents Created**:
- `docs/research/2026-01-21-ui-components-research-plan.md`
- `docs/research/2026-01-21-ui-components-synthesis.md`

**Next Step**: Create implementation plan based on synthesis, then begin Phase 6 implementation.

---

### 28: 2026-01-20 22:42 EST: Catalog Service - Phase 5 Complete (Pinia Stores)

**Objective**: Implement Pinia stores for reactive state management in Vue components.

**Work Completed**:
- Created `apps/web/app/stores/catalog.ts` (catalogStore):
  - Core catalog state: `assets` (Map), `assetIds` (array), `folderPath`
  - Uses `shallowRef` for Map to avoid deep reactivity overhead
  - Scan progress tracking (`isScanning`, `scanProgress`)
  - Computed flag counts (`pickCount`, `rejectCount`, `unflaggedCount`)
  - Actions: `addAssetBatch`, `updateAsset`, `updateThumbnail`, `setFlag`, `setFlagBatch`
  - Proper Object URL cleanup in `clear()` to prevent memory leaks

- Created `apps/web/app/stores/catalogUI.ts` (catalogUIStore):
  - UI state: `filterMode`, `sortField`, `sortDirection`, `viewMode`
  - Grid layout: `gridColumns`, `thumbnailSize`
  - Computed `filteredAssetIds` and `sortedAssetIds`
  - Actions for setting filter, sort, view mode, and reset to defaults

- Created `apps/web/app/stores/selection.ts` (selectionStore):
  - Selection state: `currentId`, `selectedIds` (Set), `lastClickedId`
  - Computed: `selectionCount`, `hasMultipleSelected`, `isEmpty`
  - Full selection support:
    - `selectSingle` - plain click
    - `toggleSelection` - Ctrl/Cmd+click
    - `selectRange` - Shift+click with anchor
    - `handleClick` - main entry point with modifier detection
  - Navigation: `navigateNext`, `navigatePrevious`, `navigateToNextUnflagged`
  - Culling workflow support with `selectAll` and flag-based navigation

- Added Pinia to web app:
  - Installed `@pinia/nuxt` and `pinia` dependencies
  - Added `@pinia/nuxt` to nuxt.config.ts modules

- Added `./catalog` export path to `packages/core/package.json`

- Created missing `apps/web/app/assets/css/main.css` (empty placeholder)

**Test Summary**:
- `packages/core`: 87 tests (all passing)
- TypeScript compiles without store-related errors

**Files Created**:
- `apps/web/app/stores/catalog.ts`
- `apps/web/app/stores/catalogUI.ts`
- `apps/web/app/stores/selection.ts`
- `apps/web/app/assets/css/main.css`

**Files Modified**:
- `apps/web/nuxt.config.ts` (added @pinia/nuxt)
- `apps/web/package.json` (added pinia dependencies)
- `packages/core/package.json` (added ./catalog export)

**Next Step**: Phase 6 - UI Components (CatalogGrid, CatalogThumbnail, FilterBar, PermissionRecovery).

---

### 27: 2026-01-20 22:36 EST: Catalog Service - Phase 4 Complete (CatalogService)

**Objective**: Implement the main CatalogService that composes ScanService, ThumbnailService, and database.

**Work Completed**:
- Created `packages/core/src/catalog/catalog-service.ts`:
  - Main service implementing `ICatalogService` interface
  - Async factory pattern (`CatalogService.create()`)
  - Folder selection via File System Access API with handle persistence
  - Folder scanning with progress updates via ScanService
  - Asset management with in-memory Map + Dexie database persistence
  - Flag management (pick/reject) with batch support
  - Thumbnail requests forwarded to ThumbnailService
  - Callback-based event system (onAssetsAdded, onAssetUpdated, onThumbnailReady)
  - `loadFromDatabase()` for restoring previous session
  - Proper cleanup via `destroy()`

- Added `@types/wicg-file-system-access` dev dependency for FSA types

- Updated `packages/core/src/catalog/index.ts`:
  - Exported `CatalogService` and `createCatalogService`

**Key Features**:
- Composes: ScanService, ThumbnailService, Dexie database
- Handles native `FileSystemDirectoryHandle` for File System Access API
- Persists folder handles via IndexedDB for session restoration
- Converts between database `AssetRecord` and application `Asset` types
- Creates `getBytes` functions for on-demand file reading

**Test Summary**:
- `packages/core`: 87 tests (all passing)
- TypeScript compiles without errors

**Files Created**:
- `packages/core/src/catalog/catalog-service.ts`

**Files Modified**:
- `packages/core/src/catalog/index.ts`
- `packages/core/package.json` (added @types/wicg-file-system-access)

**Next Step**: Phase 5 - Pinia Stores (catalogStore, catalogUIStore, selectionStore).

---

### 26: 2026-01-20 22:32 EST: Catalog Service - Phase 3 Complete (Thumbnail Service)

**Objective**: Implement the Thumbnail Service with priority queue, LRU cache, and OPFS storage.

**Work Completed**:
- Created `packages/core/src/catalog/thumbnail-queue.ts`:
  - Min-heap based priority queue for viewport-aware thumbnail generation
  - O(log n) enqueue/dequeue, O(n) priority update and removal
  - Maximum size limit with eviction of lowest priority items
  - FIFO ordering within same priority level
  - 25 unit tests

- Created `packages/core/src/catalog/thumbnail-cache.ts`:
  - `MemoryThumbnailCache`: LRU cache with Object URL management
  - `OPFSThumbnailCache`: Persistent storage via Origin Private File System
  - `ThumbnailCache`: Combined two-tier caching (memory + OPFS)
  - Automatic Object URL revocation on eviction
  - 17 unit tests

- Created `packages/core/src/catalog/thumbnail-service.ts`:
  - Coordinates queue, cache, and DecodeService
  - Single-threaded processing to avoid overwhelming decoder
  - Callback-based notification for ready/error
  - RGB to RGBA conversion using OffscreenCanvas
  - JPEG blob encoding for efficient storage

- Updated `packages/core/src/catalog/index.ts`:
  - Exported all new thumbnail components

**Test Summary**:
- `packages/core`: 87 tests (all passing)
- Thumbnail Queue: 25 tests
- Thumbnail Cache: 17 tests

**Files Created**:
- `packages/core/src/catalog/thumbnail-queue.ts`
- `packages/core/src/catalog/thumbnail-cache.ts`
- `packages/core/src/catalog/thumbnail-service.ts`
- `packages/core/src/catalog/thumbnail-queue.test.ts`
- `packages/core/src/catalog/thumbnail-cache.test.ts`

**Next Step**: Phase 4 - Catalog Service (main service composing scan + thumbnail services).

---

### 25: 2026-01-20 22:17 EST: Catalog Service Implementation Plan Created

**Objective**: Create detailed implementation plan for the Catalog Service based on research synthesis.

**Work Completed**:
- Created implementation plan: [Catalog Service Plan](./plans/2026-01-20-catalog-service-plan.md)

**Plan Structure (7 Phases)**:
1. **Phase 1: Core Types and Database** - Dexie.js schema, TypeScript interfaces
2. **Phase 2: Scan Service** - Async generator with batched yielding, AbortController
3. **Phase 3: Thumbnail Service** - Priority queue, LRU cache, OPFS storage
4. **Phase 4: Catalog Service** - Main service composing scan + thumbnail services
5. **Phase 5: Pinia Stores** - catalogStore, catalogUIStore, selectionStore
6. **Phase 6: UI Components** - CatalogGrid, CatalogThumbnail, FilterBar, PermissionRecovery
7. **Phase 7: Integration and Testing** - Nuxt plugin, composable, E2E tests

**Dependencies to Add**:
- `dexie` (packages/core) - IndexedDB wrapper
- `@tanstack/vue-virtual` (apps/web) - Virtual scrolling

**Files to Create**:
- `packages/core/src/catalog/` - types.ts, db.ts, scan-service.ts, thumbnail-*.ts, catalog-service.ts
- `apps/web/app/stores/` - catalog.ts, catalogUI.ts, selection.ts
- `apps/web/app/components/catalog/` - CatalogGrid.vue, CatalogThumbnail.vue, FilterBar.vue

**Next Step**: Begin Phase 1 implementation - Core Types and Database.

---

### 24: 2026-01-20 22:15 EST: Catalog Service Research Complete

**Objective**: Research and plan the Catalog Service - the core system enabling folder scanning, asset discovery, thumbnail generation, and state management.

**Work Completed**:
- Created research plan: [Catalog Service Research Plan](./research/2026-01-20-catalog-service-research-plan.md)
- Completed parallel research across 6 areas:
  - **Area 1 (Storage)**: Dexie.js for IndexedDB, OPFS for binary blobs (2-4x faster)
  - **Area 2 (Scanning)**: Async generators with batched yielding, AbortController cancellation
  - **Area 3 (Thumbnails)**: Priority queue with viewport awareness, LRU + OPFS caching
  - **Area 4 (State)**: Normalized Pinia stores with shallowRef for performance
  - **Area 5 (Permissions)**: Use existing FileSystemProvider, recovery UI patterns
  - **Area 6 (Codebase)**: Follow DecodeService patterns (async factory, interface-first)
- Created synthesis document: [Catalog Service Synthesis](./research/2026-01-20-catalog-service-synthesis.md)

**Key Architecture Decisions**:
1. **Storage**: Dexie.js for metadata (compound indexes for filtering), OPFS for thumbnails/previews
2. **Scanning**: Async generator yielding batches of 50 files, extension-based file detection
3. **Thumbnails**: Priority queue with viewport-aware ordering, 150-item LRU memory cache
4. **State**: Normalized stores (`Map<id, Asset>` + `string[]` for order) with `shallowRef`
5. **Permissions**: Leverage existing `FileSystemProvider.saveHandle/loadHandle`
6. **Service**: Async factory pattern matching DecodeService

**Implementation Phases Defined**:
1. Core Types and Database (Dexie schema)
2. Scan Service (folder iteration)
3. Thumbnail Service (priority queue + caching)
4. Catalog Service (composition)
5. Pinia Stores
6. UI Components (virtual grid, filter bar)
7. Integration and Testing

**Research Documents Created**:
- `docs/research/2026-01-20-catalog-service-research-plan.md`
- `docs/research/2026-01-20-catalog-area-1-storage.md`
- `docs/research/2026-01-20-catalog-area-2-scanning.md`
- `docs/research/2026-01-20-catalog-area-3-thumbnails.md`
- `docs/research/2026-01-20-catalog-area-4-state.md`
- `docs/research/2026-01-20-catalog-area-5-permissions.md`
- `docs/research/2026-01-20-catalog-area-6-codebase-review.md`
- `docs/research/2026-01-20-catalog-service-synthesis.md`

**Next Step**: Create implementation plan from synthesis, then begin Phase 1 (Core Types and Database).

---

### 23: 2026-01-20 22:04 EST: TypeScript Integration - Phase 5 Complete (Testing)

**Objective**: Complete Phase 5 of the TypeScript Integration Plan - Testing infrastructure.

**Work Completed**:
- Created `packages/core/src/decode/mock-decode-service.ts`:
  - `MockDecodeService` class implementing `IDecodeService` interface
  - Configurable options: init delay, decode delay, failure mode
  - Custom handlers for all decode methods
  - Built-in file type detection from magic bytes
  - `createTestImage()` utility for creating test fixtures

- Created `packages/core/src/decode/types.test.ts`:
  - 9 unit tests for `DecodeError` and `filterToNumber`
  - Tests error creation, cause chaining, all error codes

- Created `packages/core/src/decode/mock-decode-service.test.ts`:
  - 20 unit tests covering all MockDecodeService functionality
  - Tests for initialization, delays, custom handlers, file detection, destroy

- Updated `packages/core/src/decode/index.ts`:
  - Added exports for `MockDecodeService`, `createTestImage`, `MockDecodeServiceOptions`

- Added vitest configuration to packages/core:
  - `packages/core/vitest.config.ts`
  - Added test scripts to `packages/core/package.json`
  - Updated root `package.json` to include core tests in `test:unit`

**Test Summary**:
- `packages/core`: 29 tests (9 types + 20 mock service)
- All tests pass

**Files Created**:
- `packages/core/src/decode/mock-decode-service.ts`
- `packages/core/src/decode/types.test.ts`
- `packages/core/src/decode/mock-decode-service.test.ts`
- `packages/core/vitest.config.ts`

**Files Modified**:
- `packages/core/src/decode/index.ts`
- `packages/core/package.json`
- `package.json` (root)
- `docs/plans/2026-01-20-typescript-integration-plan.md`

**Phase 7 (TypeScript Integration) is now complete!**

**Next Step**: Determine next priority - either Phase 4 of Image Decoding Plan (Full RAW Decoding) or begin Catalog Service integration.

---

### 22: 2026-01-20 22:00 EST: TypeScript Integration - Phase 4 Complete (Nuxt Integration)

**Objective**: Implement Phase 4 of the TypeScript Integration Plan - Nuxt configuration and composable.

**Work Completed**:
- Updated `apps/web/nuxt.config.ts`:
  - Added `worker.plugins` configuration with wasm and topLevelAwait plugins
  - Enables WASM loading within Web Workers

- Created `apps/web/app/plugins/decode.client.ts`:
  - Client-only plugin that creates DecodeService instance
  - Provides `$decodeService` to Nuxt app
  - Handles cleanup on page unload (terminates worker)

- Created `apps/web/app/composables/useDecode.ts`:
  - Vue composable for accessing the decode service
  - Returns `IDecodeService` interface for type-safe access
  - Note: Placed in web app (not packages/core) since it depends on Nuxt-specific APIs

- Fixed TypeScript errors:
  - Added `override` modifier to `DecodeError.cause` property in types.ts
  - Fixed same issue in `FileSystemError` (filesystem/types.ts)
  - Both now properly use `{ cause }` in super() call for ES2022 compatibility

**Files Created**:
- `apps/web/app/plugins/decode.client.ts`
- `apps/web/app/composables/useDecode.ts`

**Files Modified**:
- `apps/web/nuxt.config.ts`
- `packages/core/src/decode/types.ts`
- `packages/core/src/filesystem/types.ts`

**Next Step**: Phase 5 - Testing (mock implementation, unit tests for DecodeService).

---

### 21: 2026-01-20 21:57 EST: TypeScript Integration - Phase 3 Complete (DecodeService)

**Objective**: Implement Phase 3 of the TypeScript Integration Plan - DecodeService class.

**Work Completed**:
- Created `packages/core/src/decode/decode-service.ts`:
  - `IDecodeService` interface for testability and mock support
  - `DecodeService` class with factory pattern (`DecodeService.create()`)
  - Worker creation using `new URL('./decode-worker.ts', import.meta.url)` pattern
  - Request/response correlation using UUID and Map
  - 30-second timeout handling with proper cleanup
  - All decode methods: `decodeJpeg`, `decodeRawThumbnail`, `generateThumbnail`, `generatePreview`, `detectFileType`
  - Proper cleanup on `destroy()` - rejects pending requests, terminates worker

- Updated `packages/core/src/decode/index.ts`:
  - Added exports for `DecodeService` and `IDecodeService`

**Key Implementation Details**:
- Private constructor pattern - must use `DecodeService.create()` for async initialization
- All pending requests tracked in Map with timeout IDs
- Proper error handling - converts worker errors to `DecodeError` instances
- `filterToNumber()` helper used for PreviewOptions filter conversion
- Service state tracked via `DecodeServiceState` interface

**TypeScript Verification**: No errors in decode files (pre-existing browser.ts errors are unrelated).

**Next Step**: Phase 4 - Nuxt Integration (nuxt.config.ts, plugin, composable).

---

### 20: 2026-01-20 21:54 EST: TypeScript Integration - Phase 2 Complete (Decode Worker)

**Objective**: Implement Phase 2 of the TypeScript Integration Plan - decode worker.

**Work Completed**:
- Created `packages/core/src/decode/decode-worker.ts`:
  - Lazy WASM initialization on first request
  - Handles 5 message types: decode-jpeg, decode-raw-thumbnail, generate-thumbnail, generate-preview, detect-file-type
  - Uses Transferable for output pixels (avoids copying large buffers)
  - Error classification (INVALID_FORMAT, CORRUPTED_FILE, OUT_OF_MEMORY, etc.)
  - Automatic file type detection for RAW vs JPEG
  - Proper memory management with `image.free()` calls

- Updated `packages/core/package.json`:
  - Added `literoom-wasm` workspace dependency
  - Added `./decode` export path

- Updated `packages/core/tsconfig.json`:
  - Added `WebWorker` lib for worker types

**Key Implementation Details**:
- Worker auto-detects file type in generate-thumbnail/preview requests
- RAW files use embedded thumbnail extraction (fast path)
- Uses `DedicatedWorkerGlobalScope` for proper TypeScript typing
- Sends `{ type: 'ready' }` message on startup

**Next Step**: Phase 3 - Implement DecodeService class (`decode-service.ts`).

---

### 19: 2026-01-20 21:51 EST: TypeScript Integration - Phase 1 Complete (Core Types)

**Objective**: Implement Phase 1 of the TypeScript Integration Plan - core types and worker messages.

**Work Completed**:
- Created `packages/core/src/decode/types.ts`:
  - `DecodedImage` interface (width, height, pixels)
  - `ThumbnailOptions` interface (size)
  - `PreviewOptions` interface (maxEdge, filter)
  - `FilterType` type ('nearest' | 'bilinear' | 'lanczos3')
  - `FileType` type ('jpeg' | 'raw' | 'unknown')
  - `ErrorCode` type (8 error codes)
  - `DecodeError` class with code and cause
  - `DecodeServiceState` interface for status tracking
  - `filterToNumber()` helper function

- Created `packages/core/src/decode/worker-messages.ts`:
  - `DecodeRequest` discriminated union (5 request types)
  - `DecodeResponse` discriminated union (3 response types)
  - Individual request interfaces for type safety

- Created `packages/core/src/decode/index.ts` (module exports)
- Updated `packages/core/src/index.ts` to export decode module
- Verified types compile successfully

**Files Created**:
- `packages/core/src/decode/types.ts`
- `packages/core/src/decode/worker-messages.ts`
- `packages/core/src/decode/index.ts`

**Next Step**: Phase 2 - Implement decode worker (`decode-worker.ts`).

---

### 18: 2026-01-20 21:48 EST: TypeScript Integration - Implementation Plan Created

**Objective**: Create implementation plan for Phase 7 of the Image Decoding Plan.

**Work Completed**:
- Created implementation plan: [TypeScript Integration Plan](./plans/2026-01-20-typescript-integration-plan.md)
- **Plan Structure** (5 phases):
  - Phase 1: Core Types and Worker Messages (`types.ts`, `worker-messages.ts`)
  - Phase 2: Decode Worker (`decode-worker.ts`)
  - Phase 3: DecodeService Class (`decode-service.ts`)
  - Phase 4: Nuxt Integration (config, plugin, composable)
  - Phase 5: Testing (unit tests, mock implementation)

**Key Implementation Details**:
1. **Types**: `DecodedImage`, `DecodeError`, `ThumbnailOptions`, `PreviewOptions`
2. **Worker**: Lazy WASM init, handles 5 message types
3. **Service**: UUID correlation, 30s timeout, `IDecodeService` interface
4. **Integration**: Client-only Nuxt plugin, `useDecode()` composable

**Next Step**: Begin Phase 1 implementation - core types and worker messages.

---

### 17: 2026-01-20 21:46 EST: TypeScript Integration - Research Complete

**Objective**: Research and plan the TypeScript integration for Phase 7 of the Image Decoding Plan.

**Work Completed**:
- Created research plan: [TypeScript Integration Research Plan](./research/2026-01-20-typescript-integration-research-plan.md)
- Completed parallel research across 4 areas:
  - **Area 1 (WASM Workers)**: Lazy async initialization pattern with default URL resolution
  - **Area 2 (Message Passing)**: Manual request/response correlation using UUID + discriminated unions
  - **Area 3 (API Design)**: Interface-based DecodeService with Vue composable integration
  - **Area 4 (Vite/Nuxt)**: Minor config addition needed (`worker.plugins`)
- Created synthesis document: [TypeScript Integration Synthesis](./research/2026-01-20-typescript-integration-synthesis.md)

**Key Decisions**:
1. **Worker initialization**: Lazy async with `init()` on first request
2. **Message passing**: Manual pattern (no Comlink for v1), add library in v2 if needed
3. **Data transfer**: Structured clone for input (safety), Transferable for output (45x faster)
4. **Configuration**: Add `worker: { plugins: () => [wasm(), topLevelAwait()] }` to nuxt.config.ts
5. **API**: `IDecodeService` interface with methods for JPEG/RAW decode, thumbnail/preview generation

**Research Documents Created**:
- `docs/research/2026-01-20-typescript-integration-research-plan.md`
- `docs/research/2026-01-20-ts-integration-area-1-wasm-workers.md`
- `docs/research/2026-01-20-ts-integration-area-2-message-passing.md`
- `docs/research/2026-01-20-ts-integration-area-3-api-design.md`
- `docs/research/2026-01-20-ts-integration-area-4-vite-nuxt.md`
- `docs/research/2026-01-20-typescript-integration-synthesis.md`

**Next Step**: Create implementation plan for TypeScript integration based on research synthesis.

---

### 16: 2026-01-20 21:39 EST: WASM Bindings - Phase 5 & 6 Complete (Testing & CI)

**Objective**: Complete WASM bindings testing phase and CI integration.

**Work Completed**:
- Verified Phase 5 (Testing) was already complete from prior work:
  - Unit tests for types: 5 tests in `types.rs`
  - Platform-agnostic tests in `decode.rs`: 6 tests
  - WASM-specific tests via `wasm_bindgen_test`: 12 tests
  - All 65 tests pass (50 core + 15 wasm)
  - Clippy passes with no warnings
  - Formatting passes
- Updated CI workflow (`.github/workflows/ci.yml`):
  - WASM build now outputs to `packages/wasm/` to match project structure
  - Added verification step to ensure output files exist
- Updated WASM Bindings Plan to mark all phases complete
- Updated all verification checklist items in the plan

**Test Summary**:
- `literoom-core`: 50 tests (JPEG, RAW thumbnail, resize, types)
- `literoom-wasm`: 15 tests (adjustments, decode, types)
- All tests pass

**Next Step**: Phase 7 of Image Decoding Plan - TypeScript Integration (DecodeService, Web Worker wrapper).

---

### 15: 2026-01-20 15:17 EST: WASM Bindings - Phase 4 Complete (Build Configuration)

**Objective**: Configure wasm-pack build scripts and verify WASM output.

**Work Completed**:
- Verified `Cargo.toml` has correct WASM release profile (`opt-level = "s"`, `lto = true`)
- Confirmed wasm-pack build scripts exist in root `package.json`:
  - `wasm:build` - release build
  - `wasm:build:dev` - debug build
- Created `packages/wasm/.gitignore` to exclude generated files from git
- Installed wasm-pack via cargo
- Successfully ran `wasm-pack build --target web` and verified output:
  - `literoom_wasm.js` (31KB) - ES module wrapper
  - `literoom_wasm.d.ts` (13KB) - TypeScript definitions with all expected exports
  - `literoom_wasm_bg.wasm` (447KB) - WASM binary (well under 2MB target)
  - TypeScript types include: `BasicAdjustments`, `JsDecodedImage`, `decode_jpeg`, `decode_raw_thumbnail`, `extract_raw_thumbnail_bytes`, `is_raw_file`, `resize`, `resize_to_fit`, `generate_thumbnail`
- All 65 tests pass (50 core + 15 wasm)
- Clippy and fmt checks pass

**Next Step**: Phase 5 - Testing (add unit tests, verify tests pass).

---

### 14: 2026-01-20 15:12 EST: WASM Bindings - Phase 3 Complete (Decode Bindings)

**Objective**: Implement WASM bindings for all decode functions.

**Work Completed**:
- Created `crates/literoom-wasm/src/decode.rs` with 7 WASM-bound functions:
  - `decode_jpeg(bytes)` - Decode JPEG with EXIF orientation correction
  - `extract_raw_thumbnail_bytes(bytes)` - Extract embedded JPEG from RAW files
  - `decode_raw_thumbnail(bytes)` - Extract and decode RAW thumbnail
  - `is_raw_file(bytes)` - Check if bytes are a TIFF-based RAW file
  - `resize(image, width, height, filter)` - Resize to exact dimensions
  - `resize_to_fit(image, max_edge, filter)` - Resize preserving aspect ratio
  - `generate_thumbnail(image, size)` - Generate grid thumbnail
- Updated `lib.rs` to include decode module and re-export all functions
- Split tests into platform-agnostic tests and wasm32-only tests
  - Platform-agnostic: `is_raw_file`, `JsDecodedImage` creation/conversion
  - WASM-only: Functions returning `Result<T, JsValue>` (use `wasm-pack test`)
- **File Structure**:
  ```
  crates/literoom-wasm/src/
  ├── lib.rs          # Module exports, init, version
  ├── adjustments.rs  # BasicAdjustments wrapper
  ├── types.rs        # JsDecodedImage, filter_from_u8
  └── decode.rs       # Decode bindings (7 functions)
  ```
- All 65 tests pass (50 core + 15 wasm)
- Clippy and fmt checks pass

**Next Step**: Phase 4 - Build configuration (wasm-pack scripts and packages/wasm setup).

---

### 13: 2026-01-20 15:07 EST: WASM Bindings - Phase 1 Complete (File Organization)

**Objective**: Reorganize literoom-wasm crate into a clean module structure.

**Work Completed**:
- Created `crates/literoom-wasm/src/adjustments.rs` - moved BasicAdjustments wrapper from lib.rs
- Created `crates/literoom-wasm/src/types.rs` - added JsDecodedImage wrapper and filter_from_u8 helper
- Updated `crates/literoom-wasm/src/lib.rs` - module declarations and re-exports
- **New File Structure**:
  ```
  crates/literoom-wasm/src/
  ├── lib.rs          # Module exports, init, version
  ├── adjustments.rs  # BasicAdjustments wrapper
  └── types.rs        # JsDecodedImage, filter_from_u8
  ```
- All 59 tests pass (50 core + 9 wasm)
- Clippy and fmt checks pass

**Next Step**: Phase 2 and 3 - implement decode bindings (decode.rs module with 7 functions).

---

### 12: 2026-01-20 15:03 EST: WASM Bindings Implementation Plan Created

**Objective**: Create detailed implementation plan for WASM bindings based on research synthesis.

**Work Completed**:
- Created implementation plan: [WASM Bindings Plan](./plans/2026-01-20-wasm-bindings-plan.md)
- **Plan Structure**:
  - Phase 1: File organization (refactor lib.rs into modules)
  - Phase 2: Core types (JsDecodedImage wrapper)
  - Phase 3: Decode bindings (7 functions: decode_jpeg, extract_raw_thumbnail_bytes, decode_raw_thumbnail, is_raw_file, resize, resize_to_fit, generate_thumbnail)
  - Phase 4: Build configuration (wasm-pack scripts)
  - Phase 5: Testing (unit tests, wasm-bindgen-test)
  - Phase 6: CI integration
- Defined verification checklist and expected TypeScript API
- Documented risk mitigation strategies

**Next Step**: Begin Phase 1 implementation - file organization and refactoring.

---

### 11: 2026-01-20 15:02 EST: WASM Bindings Research - Synthesis Complete

**Objective**: Synthesize research findings into actionable implementation guidance.

**Work Completed**:
- Created synthesis document: [WASM Bindings Synthesis](./research/2026-01-20-wasm-bindings-synthesis.md)
- **Key Decisions Made**:
  1. **Pixel buffers**: Use `Vec<u8>` returns (safe copy semantics), `&[u8]` inputs (zero-copy)
  2. **Memory management**: Rely on wasm-bindgen automatic cleanup, stateless function pattern
  3. **Error handling**: String-based via `Result<T, JsValue>` (consistent with existing patterns)
  4. **TypeScript types**: Let wasm-bindgen generate automatically
  5. **Build target**: `wasm-pack --target web` to `packages/wasm/`
- Defined file organization: `types.rs`, `decode.rs`, refactored `adjustments.rs`
- Defined 7 WASM functions to implement (decode_jpeg, extract_raw_thumbnail_bytes, decode_raw_thumbnail, is_raw_file, resize, resize_to_fit, generate_thumbnail)
- Established performance expectations and testing strategy

**Next Step**: Create implementation plan for WASM bindings based on synthesis.

---

### 10: 2026-01-20 15:00 EST: WASM Bindings Research - Area 1 Complete

**Objective**: Research wasm-bindgen patterns for efficiently transferring large pixel buffers between Rust/WASM and JavaScript.

**Work Completed**:
- Completed research area 1: [Pixel Buffer Patterns](./research/2026-01-20-wasm-bindings-area-1-pixel-buffers.md)
- **Key Findings**:
  - `Vec<u8>` return type automatically converts to `Uint8Array` (creates copy, but safe)
  - `&[u8]` input creates zero-copy view from JS (no copy on input)
  - `Uint8Array::view()` provides zero-copy but is unsafe (invalidated by memory growth)
  - Real-world projects (Discourse, Squoosh) use copying for safety
- **Recommendation for v1**:
  - Use stateless functions returning `Vec<u8>` (simple, safe)
  - Use wrapper struct (`JsDecodedImage`) to keep data in WASM during multi-step operations
  - Accept copy overhead (~10-50ms) vs decode time (50-2000ms)
  - Defer zero-copy optimization until profiling proves necessary

**Next Step**: Research area 2 (Memory Management) or proceed to synthesis if enough research is done.

---

### 9: 2026-01-20 14:56 EST: WASM Bindings Research - Area 6 Complete

**Objective**: Review existing literoom-wasm crate to understand patterns and integration needs.

**Work Completed**:
- Completed research area 6: [Crate Review](./research/2026-01-20-wasm-bindings-area-6-crate-review.md)
- **Key Findings**:
  - Solid wrapper pattern established: `inner: literoom_core::Type`
  - Getter/setter with `#[wasm_bindgen(getter/setter)]` for property access
  - JSON serialization via `serde-wasm-bindgen`
  - String-based error handling via `JsValue::from_str`
  - Release profile configured with `opt-level = "s"` and `lto = true`
- **Integration Plan**:
  - Add new `decode.rs` module for all decode bindings
  - Need wrapper types: `JsDecodedImage`, `JsImageMetadata`
  - Need functions: `decode_jpeg`, `extract_raw_thumbnail`, `resize`, etc.
  - Critical decision pending: pixel buffer transfer strategy (research area 1)

**Next Step**: Research area 1 (wasm-bindgen patterns for image data) - critical for pixel buffer design.

---

### 8: 2026-01-20 14:50 EST: WASM Bindings Research Plan Created

**Objective**: Begin Phase 6 (WASM Bindings) by creating a research plan.

**Work Completed**:
- Created research plan: [WASM Bindings Research Plan](./research/2026-01-20-wasm-bindings-research-plan.md)
- Identified 6 research areas:
  1. wasm-bindgen patterns for image data
  2. Memory management in image WASM modules
  3. Error handling across WASM boundary
  4. TypeScript type generation
  5. WASM module build configuration
  6. Existing literoom-wasm crate review

**Next Step**: Research area 6 (existing literoom-wasm crate review) first to understand current state.

---

### 7: 2026-01-20: Image Decoding Phase 5 - Image Resizing

**Objective**: Implement image resizing functions for thumbnail and preview generation.

**Work Completed**:

1. **Resize Functions** (`crates/literoom-core/src/decode/resize.rs`):
   - `resize(image, width, height, filter)` - resize to exact dimensions
   - `resize_to_fit(image, max_edge, filter)` - fit within max edge, preserve aspect ratio
   - `generate_thumbnail(image, size)` - convenience function for grid thumbnails (uses bilinear)
   - `calculate_fit_dimensions()` - internal helper for aspect ratio calculations

2. **Features**:
   - Supports all three filter types: Nearest, Bilinear, Lanczos3
   - Fast path for same-size images (no-op clone)
   - Proper aspect ratio preservation for landscape, portrait, and square images
   - Small images not upscaled in `resize_to_fit`

3. **Unit Tests** (16 new tests):
   - Basic resize operations (downscale, upscale, same size)
   - Resize to fit (landscape, portrait, square, already smaller)
   - Thumbnail generation
   - Dimension calculation
   - Error handling (zero dimensions)
   - All filter types

4. **Testing Results**:
   - All 50 tests pass (16 new resize tests + 34 existing)
   - Clippy passes with no warnings
   - Formatting check passes

---

### 6: 2026-01-20: Image Decoding Phase 3 - RAW Thumbnail Extraction

**Objective**: Implement fast-path thumbnail extraction from Sony ARW files by extracting the embedded JPEG preview.

**Work Completed**:

1. **RAW Thumbnail Extractor** (`crates/literoom-core/src/decode/raw_thumbnail.rs`):
   - `extract_raw_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, DecodeError>` - extracts embedded JPEG bytes
   - `decode_raw_thumbnail(bytes: &[u8]) -> Result<DecodedImage, DecodeError>` - convenience function to extract and decode
   - `is_raw_file(bytes: &[u8]) -> bool` - quick header check for TIFF-based RAW formats
   - `get_raw_camera_info(bytes: &[u8]) -> Result<(String, String), DecodeError>` - extracts make/model from EXIF

2. **TIFF Parsing Implementation**:
   - Manual TIFF structure parsing (IFD0, SubIFD, IFD1)
   - Supports both little-endian and big-endian TIFF files
   - Extracts JPEG via JpegInterchangeFormat tags or strip-based data
   - Fallback JPEG scanning for edge cases

3. **Extraction Strategy** (in order of priority):
   - SubIFD preview (preferred for Sony ARW - larger preview)
   - IFD1 standard EXIF thumbnail
   - Direct IFD0 JPEG entries
   - Marker-based JPEG scanning (fallback)

4. **Unit Tests** (12 new tests):
   - Header detection (TIFF LE/BE, JPEG rejection, short data)
   - Invalid/empty data handling
   - Byte order reading (u16/u32 in both endianness)
   - Error case coverage

5. **Testing Results**:
   - All 34 tests pass (12 new RAW thumbnail tests + 22 existing)
   - Clippy passes with no warnings
   - Formatting check passes

**Notes**:
- `rawloader` crate doesn't expose preview data, so custom TIFF parsing was implemented
- Real ARW file testing requires test fixtures (can be added later)
- The implementation handles the common Sony ARW structure

---

### 5: 2026-01-20: Image Decoding Phase 2 - JPEG Decoding

**Objective**: Implement JPEG decoding with EXIF orientation handling.

**Work Completed**:

1. **JPEG Decoder Implementation** (`crates/literoom-core/src/decode/jpeg.rs`):
   - `decode_jpeg(bytes: &[u8]) -> Result<DecodedImage, DecodeError>` - main decoder with orientation correction
   - `decode_jpeg_no_orientation(bytes: &[u8])` - decoder without orientation (for when already handled)
   - `get_orientation(bytes: &[u8]) -> Orientation` - extract EXIF orientation
   - `apply_orientation(img, orientation)` - apply EXIF orientation transformations

2. **Orientation Handling**:
   - Extracts EXIF orientation from JPEG bytes using `kamadak-exif`
   - Applies all 8 EXIF orientation transformations (Normal, FlipH, Rotate180, FlipV, Transpose, Rotate90CW, Transverse, Rotate270CW)
   - Defaults to Normal when no EXIF data present

3. **Unit Tests** (11 new tests):
   - Valid JPEG decoding
   - Invalid/empty/truncated JPEG handling
   - Orientation extraction (no EXIF, invalid data)
   - Orientation transformations (Normal, Rotate90, Rotate180, FlipH)

4. **Testing Results**:
   - All 22 tests pass (11 new JPEG tests + 11 existing)
   - Clippy passes with no warnings
   - Formatting check passes

---

### 4: 2026-01-20: Image Decoding Phase 1 - Dependencies & Core Types

**Objective**: Add image decoding dependencies and define core types for the decode pipeline.

**Work Completed**:

1. **Dependencies Added** (workspace Cargo.toml + literoom-core):
   - `image` v0.25 (JPEG/PNG decoding, resizing)
   - `rawloader` v0.37 (RAW file parsing, Sony ARW support)
   - `kamadak-exif` v0.5 (EXIF metadata extraction)
   - `thiserror` v2.0 (Error handling)

2. **Core Types Created** (`crates/literoom-core/src/decode/types.rs`):
   - `DecodeError` enum - error types for decoding operations
   - `FilterType` enum - resize algorithms (Nearest, Bilinear, Lanczos3)
   - `Orientation` enum - EXIF orientation values (1-8)
   - `ImageMetadata` struct - camera info, date, dimensions, EXIF data
   - `DecodedImage` struct - width, height, RGB pixel buffer

3. **Module Structure**:
   - Created `decode` module with types.rs
   - Exposed types via `pub mod decode` in lib.rs

4. **Testing**:
   - 6 new unit tests for decode types
   - All 11 tests pass
   - Clippy passes with no warnings

---

### 3: 2026-01-20: Image Decoding Implementation Plan

**Objective**: Create detailed implementation plan for the image decoding pipeline.

**Plan Document**: [Image Decoding Plan](./plans/2026-01-20-image-decoding-plan.md)

**Plan Summary**:
- 8 phases covering dependencies → JPEG decode → RAW thumbnails → full RAW decode → WASM bindings → TypeScript integration
- Prioritizes embedded JPEG extraction (fast path <50ms) for immediate thumbnail display
- Bilinear demosaicing for v1 (speed over quality)
- Worker-based architecture to keep main thread responsive
- Target performance: thumbnails <50ms, full RAW decode <2s
literoom-core

---

### 2: 2026-01-20: Image Decoding Pipeline Research

**Objective**: Research best approaches for decoding JPEG and Sony ARW RAW files in Rust/WASM for the Literoom image processing pipeline.

**Research Documents**:
- [Research Plan](./research/2026-01-20-image-decoding-research-plan.md)
- [Research Synthesis](./research/2026-01-20-image-decoding-synthesis.md)

**Key Findings**:

1. **Library Recommendations**:
   - JPEG decoding: `image` crate (mature, WASM-ready)
   - RAW decoding: `rawloader` crate (pure Rust, supports Sony ARW)
   - Alternative: LibRaw-WASM ports exist if needed

2. **Two-Path Thumbnail Strategy**:
   - **Fast path** (<50ms): Extract embedded JPEG from ARW files (1616x1080)
   - **Quality path** (1-5s): Full RAW decode with demosaicing

3. **Sony ARW Format**:
   - TIFF-based format with embedded JPEG in IFD1
   - Supports 12-bit and 14-bit color depth
   - Lossless compression available since ARW 4.0 (2021)

4. **WASM Memory Management**:
   - 4GB limit for WASM32
   - Use direct memory access to avoid double allocation
   - Process one image at a time, release buffers aggressively

5. **Demosaicing**:
   - Start with bilinear interpolation (fast, acceptable quality)
   - AHD available for future high-quality export

---

### 1: 2026-01-20: Project Scaffolding

**Objective**: Set up the complete monorepo structure with Nuxt 4, Nuxt UI 4, Rust WASM, CI/CD, and testing infrastructure.

**Implementation Plan**:
- [Scaffolding Plan](./plans/2026-01-20-project-scaffolding-plan.md)

**Work Completed**:

1. **pnpm Workspace Setup**
   - Created `pnpm-workspace.yaml` with apps and packages directories
   - Root `package.json` with workspace scripts
   - `.npmrc` configuration

2. **Nuxt 4 Application** (`apps/web/`)
   - Nuxt 4 with Nuxt UI 4 configuration
   - Basic landing page with "Choose Folder" action
   - WASM plugin integration (vite-plugin-wasm)
   - TypeScript strict mode enabled

3. **Rust WASM Workspace**
   - `crates/literoom-core/` - Core image processing library
     - BasicAdjustments, ToneCurve, Histogram structs
     - Unit tests passing
   - `crates/literoom-wasm/` - WASM bindings
     - wasm-bindgen integration
     - BasicAdjustments exposed to JS
   - Rust tooling: rustfmt.toml, clippy.toml, rust-toolchain.toml

4. **Shared Packages**
   - `packages/core/` - TypeScript core logic
     - File System abstraction layer (FileSystemProvider interface)
     - Browser implementation using File System Access API
     - Tauri-compatible abstraction design
   - `packages/wasm/` - WASM output placeholder

5. **Testing Infrastructure**
   - Vitest configuration for Nuxt unit tests
   - Playwright configuration for E2E tests
   - Sample unit and E2E tests created
   - Rust tests passing

6. **CI/CD Pipeline**
   - GitHub Actions workflow (`.github/workflows/ci.yml`)
   - Web job: lint, typecheck, unit tests
   - E2E job: Playwright tests
   - Rust job: fmt, clippy, tests
   - WASM job: build verification

7. **Development Tooling**
   - VS Code settings and recommended extensions
   - ESLint configuration
   - Prettier configuration
   - .gitignore for monorepo

**Smoke Test Results**:
- [x] `pnpm install` - Dependencies installed successfully
- [x] `cargo fmt --all -- --check` - Formatting passes
- [x] `cargo check --all-targets` - Type check passes (requires RUSTC env var)
- [x] `cargo clippy --all-targets -- -D warnings` - Linting passes
- [x] `cargo test --all-features` - Unit tests pass (8/8)
- [ ] `pnpm lint` - Requires Node.js 22+ (CI will work)
- [ ] `pnpm dev` - Requires Node.js 22+ (CI will work)

**Known Issues / Environment Notes**:

1. **Node.js Version**: Local environment has Node.js 18.17.0, but Nuxt 4 tooling requires Node.js 22+. The CI pipeline uses Node 22 and will work correctly.

2. **Rust Toolchain Path**: The local environment has an older rustc at `/usr/local/bin/rustc` (1.70.0) that takes precedence over rustup. To run cargo commands locally:
   ```bash
   RUSTC=/Users/michaelthiessen/.cargo/bin/rustc cargo check
   ```
   Or ensure `~/.cargo/bin` is first in PATH.

---
