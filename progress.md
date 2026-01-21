# Literoom Development Progress

## Current Status

**Last Updated**: 2026-01-21 09:10 EST

### Current Task: Fix E2E Tests

Unit tests now passing (201 tests). E2E tests have 11 failures due to:
1. Grid focus handler not triggering `data-current` as expected by tests
2. Tests assume specific flag states that don't match demo data (pre-flagged assets)
3. Virtual scrolling test expects fewer rendered items, but viewport may show all 20

Need to update E2E tests to:
- Wait for grid focus to propagate to first item
- Account for pre-existing demo asset flags
- Use correct assertions for the demo catalog

### Unit Tests Fixed ✅

Fixed issues in `apps/web/test` setup:
- **vitest.config.ts**: Added `runtimeConfig.public.demoMode: true` in nuxt overrides
- **example.nuxt.test.ts**: Fixed import path `~/app/app.vue` → `~/app.vue` and updated assertion

### Phase 7.1: Mock Services - Complete ✅

Implemented mock services for demo mode and E2E testing without real file system access.

**Files Created**:
- `packages/core/src/catalog/demo-assets.ts` - Demo asset factory:
  - `createDemoAsset()` and `createDemoAssets()` factories
  - Configurable pick/reject/raw rates for distribution control
  - Deterministic generation based on index for reproducible tests
  - `getDemoFlagCounts()` and `filterDemoAssetsByFlag()` helpers
  - 24 unit tests

- `packages/core/src/catalog/mock-catalog-service.ts` - MockCatalogService:
  - Full ICatalogService implementation for testing
  - Configurable scan delay, batch size, thumbnail delay
  - Mock folder selection and scanning with batched callbacks
  - Flag management with async callbacks
  - Simulated thumbnail generation with data URL SVGs
  - Test-specific methods: `setAssets()`, `clearAssets()`, `resetToDemo()`, `completeAllThumbnails()`
  - 46 unit tests

- `packages/core/src/filesystem/mock.ts` - MockFileSystemProvider:
  - Full FileSystemProvider implementation for testing
  - Configurable demo file count, raw rate, subdirectories
  - Mock permission states and handle persistence
  - `createMockFileHandle()` and `createMockDirectoryHandle()` helpers
  - Valid JPEG placeholder data for file reads
  - 43 unit tests

**Files Modified**:
- `packages/core/src/catalog/index.ts` - Added MockCatalogService, demo-assets exports
- `packages/core/src/filesystem/index.ts` - Added MockFileSystemProvider exports

**Verification**:
- ✅ All unit tests pass (200 tests total)
- ✅ TypeScript typecheck passes
- ✅ Exports work correctly from package entry points

---

## Next Steps

Continue with **Phase 7.2: Nuxt Plugin Integration**:
- Add `runtimeConfig.public.demoMode` to nuxt.config.ts
- Create `apps/web/app/plugins/catalog.client.ts` - CatalogService plugin
- Create `apps/web/app/composables/useCatalog.ts` - CatalogService composable
- Update index.vue to use the new composables

---

## Completed Phases

### Project Scaffolding ✅
- Nuxt 4 + Nuxt UI 4 monorepo structure
- Rust WASM package setup
- CI/CD pipeline

### Image Decoding ✅
- JPEG decoding with EXIF orientation
- RAW thumbnail extraction for Sony ARW
- Image resizing for thumbnails/previews

### WASM Bindings ✅
- wasm-pack integration
- TypeScript type generation

### TypeScript Integration ✅
- DecodeService for worker communication
- MockDecodeService for testing
- Nuxt plugin integration

### Catalog Service Phase 1 ✅
- Core types and interfaces
- Dexie database schema
- Public exports

### Catalog Service Phase 2 ✅
- ScanService with async generator pattern
- Batched yielding for UI responsiveness
- AbortController cancellation support
- Comprehensive unit tests (16 tests)
