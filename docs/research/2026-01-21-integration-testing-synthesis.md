# Phase 7: Integration and Testing - Research Synthesis

**Date**: 2026-01-21
**Status**: Research Complete
**Research Plan**: [Integration Testing Research Plan](./2026-01-21-integration-testing-research-plan.md)

---

## Executive Summary

Phase 7 focuses on completing the vertical integration of Literoom's catalog functionality by:
1. Creating a CatalogService Nuxt plugin with proper store wiring
2. Implementing demo mode for E2E tests without File System Access API
3. Building comprehensive E2E test coverage with Playwright
4. Adding unit tests for stores and composables

---

## Key Findings

### 1. Current State Assessment

**What's Complete:**
- UI Components (Phase 6): CatalogGrid, CatalogThumbnail, FilterBar, PermissionRecovery
- Pinia Stores: catalog, catalogUI, selection, permissionRecovery
- Composables: useDecode, useIntersectionObserver, useGridKeyboard
- Core Services: CatalogService, ScanService, ThumbnailService, DecodeService
- Page Integration: index.vue manually orchestrates folder selection and scanning

**Key Gaps Identified:**
- No CatalogService plugin (service created manually in page)
- No service-store wiring (page directly mutates stores)
- Minimal E2E coverage (only basic smoke tests)
- No demo mode for testing without real file system
- No MockCatalogService (only MockDecodeService exists)

### 2. Demo Mode Architecture

**Toggle Mechanism:**
- Use Nuxt runtime config: `runtimeConfig.public.demoMode`
- Environment variable: `LITEROOM_DEMO_MODE=true`
- Check in plugins to swap real vs mock services

**Static Assets:**
- Create `apps/web/public/demo-images/` with 5-10 sample images
- Include both JPEG and mock ARW files (~200KB total)
- Use real images for authentic decode pipeline testing

**MockFileSystemProvider:**
- Create `packages/core/src/filesystem/mock.ts`
- Implements same interface as BrowserFileSystemProvider
- Returns hardcoded list of demo images
- Fetches images from `/demo-images/` URL

### 3. Mock Services Design

**Existing Patterns to Follow:**
- MockDecodeService already exists with configurable delays and custom handlers
- Interface-first design (IDecodeService, ICatalogService)
- Factory pattern with `create()` method
- Callback-based event system

**MockCatalogService Structure:**
```typescript
MockCatalogService implements ICatalogService
├── Configuration Options
│   ├── demoAssets: Asset[] (25-50 pre-defined assets)
│   ├── scanDelay: number (ms between batches)
│   ├── thumbnailDelayRange: [min, max]
│   └── failScan?: boolean (for error testing)
├── Initialization
│   ├── create(options) factory
│   └── loadFromDatabase() pre-populates assets
├── Core Methods
│   ├── scanFolder() - yields batches from demoAssets
│   ├── getAsset(id) - instant Map lookup
│   ├── setFlag() - in-memory update + callback
│   └── requestThumbnail() - queue and async generate
└── Events
    ├── onAssetsAdded - fire after each batch
    ├── onAssetUpdated - fire on flag change
    └── onThumbnailReady - fire with pre-generated URLs
```

### 4. Nuxt Plugin Integration

**CatalogService Plugin Pattern:**
```typescript
// apps/web/app/plugins/catalog.client.ts
export default defineNuxtPlugin(async () => {
  const config = useRuntimeConfig()
  const isDemoMode = config.public.demoMode

  // Create services (real or mock based on mode)
  const decodeService = isDemoMode
    ? await MockDecodeService.create()
    : await DecodeService.create()

  const catalogService = isDemoMode
    ? await MockCatalogService.create(decodeService)
    : await CatalogService.create(decodeService)

  // Wire callbacks to stores
  const catalogStore = useCatalogStore()

  catalogService.onAssetsAdded = (assets) => {
    catalogStore.addAssetBatch(assets)
  }

  catalogService.onAssetUpdated = (asset) => {
    catalogStore.updateAsset(asset.id, asset)
  }

  catalogService.onThumbnailReady = (assetId, url) => {
    catalogStore.updateThumbnail(assetId, 'ready', url)
  }

  // Session restoration
  const restored = await catalogService.loadFromDatabase()
  if (restored) {
    catalogStore.addAssetBatch(catalogService.getAssets())
  }

  // Cleanup
  window.addEventListener('beforeunload', () => {
    catalogService.destroy()
    catalogStore.clear()
  })

  return { provide: { catalogService } }
})
```

### 5. E2E Testing Strategy

**Test Scenarios:**

A. **Folder Selection Workflow**
- Home page shows "Choose Folder" button
- Clicking button opens folder picker (mocked in demo mode)
- Grid appears with scanned assets
- Folder name displays in header

B. **Photo Grid & Scrolling**
- Grid renders with correct column count
- Virtual scrolling renders only visible rows
- Scrolling doesn't cause jumps or blank areas
- Overscan pre-renders adjacent rows

C. **Keyboard Navigation**
- Arrow keys navigate grid (grid-aware, respects columns)
- P/X/U keys flag current photo
- Flags visible immediately (badge appears)
- Focus ring shows current item

D. **Filter Mode Switching**
- All/Picks/Rejects/Unflagged buttons work
- Filter changes update grid immediately
- Count badges show correct numbers
- Active filter has solid variant

E. **Click Selection**
- Single click selects item
- Ctrl+click toggles selection
- Shift+click range selects
- Selection ring shows selected items

**Playwright Configuration Updates:**
```typescript
// playwright.config.ts
export default defineConfig({
  use: {
    baseURL: 'http://localhost:3000',
  },
  webServer: {
    command: 'LITEROOM_DEMO_MODE=true pnpm dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
})
```

### 6. Test Fixtures and Demo Assets

**Recommended:**
- **Count**: 25-50 demo assets
- **Thumbnail Size**: 256x256px (system default)
- **Image Type**: Programmatically generated solid colors
- **Flag Distribution**: 40% unflagged, 40% picked, 20% rejected

**Color Scheme for Visual Identification:**
- Blue = unflagged (flag: 'none')
- Green = picked (flag: 'pick')
- Red = rejected (flag: 'reject')

**Demo Catalog Factory:**
```typescript
// packages/core/src/catalog/demo-assets.ts
export function createDemoCatalog(count: number = 50): Asset[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `demo-asset-${i}`,
    folderId: 'demo-folder',
    path: `demo-image-${i}.jpg`,
    filename: `demo-image-${i}`,
    extension: i % 4 === 0 ? 'arw' : 'jpg',
    flag: i % 5 === 0 ? 'pick' : i % 7 === 0 ? 'reject' : 'none',
    captureDate: new Date(2026, 0, 1 + i),
    modifiedDate: new Date(),
    fileSize: 1024 * 1024 * (2 + (i % 5)),
    thumbnailStatus: 'pending',
    thumbnailUrl: null,
  }))
}
```

---

## Implementation Plan

### Phase 7.1: Mock Services
**Files to Create:**
- `packages/core/src/filesystem/mock.ts` - MockFileSystemProvider
- `packages/core/src/catalog/mock-catalog-service.ts` - MockCatalogService
- `packages/core/src/catalog/demo-assets.ts` - Demo asset factory

### Phase 7.2: Nuxt Plugin Integration
**Files to Create:**
- `apps/web/app/plugins/catalog.client.ts` - CatalogService plugin
- `apps/web/app/composables/useCatalog.ts` - CatalogService composable

**Files to Modify:**
- `apps/web/nuxt.config.ts` - Add runtimeConfig for demoMode
- `apps/web/app/pages/index.vue` - Use useCatalog() instead of manual service

### Phase 7.3: Demo Mode Assets
**Files to Create:**
- `apps/web/public/demo-images/` directory with sample images
- `apps/web/test/fixtures/demo-catalog.ts` - Test data factory

### Phase 7.4: E2E Tests
**Files to Create:**
- `apps/web/e2e/catalog-grid.spec.ts` - Grid display and scrolling
- `apps/web/e2e/keyboard-navigation.spec.ts` - Arrow keys and shortcuts
- `apps/web/e2e/filter-modes.spec.ts` - Filter button functionality
- `apps/web/e2e/folder-selection.spec.ts` - Folder workflow (demo mode)

### Phase 7.5: Unit Tests
**Files to Create:**
- `apps/web/test/stores/catalog.test.ts`
- `apps/web/test/stores/catalogUI.test.ts`
- `apps/web/test/stores/selection.test.ts`
- `apps/web/test/composables/useGridKeyboard.test.ts`
- `packages/core/src/catalog/mock-catalog-service.test.ts`

---

## Dependencies

**No new dependencies needed** - all tools already available:
- Vitest for unit tests
- Playwright for E2E tests
- @tanstack/vue-virtual already installed
- MockDecodeService pattern exists

---

## Verification Checklist

After Phase 7 complete:

**Demo Mode:**
- [ ] `LITEROOM_DEMO_MODE=true pnpm dev` shows demo catalog
- [ ] Demo images load without File System Access API
- [ ] Flags can be changed in demo mode
- [ ] Filters work in demo mode

**Plugin Integration:**
- [ ] CatalogService plugin initializes on app start
- [ ] Service callbacks update stores correctly
- [ ] Session restoration works (persisted folders re-open)
- [ ] Cleanup runs on page unload

**E2E Tests:**
- [ ] All E2E tests pass in CI
- [ ] Grid scrolling test verifies virtual rendering
- [ ] Keyboard navigation test covers all shortcuts
- [ ] Filter test verifies all modes

**Unit Tests:**
- [ ] Store tests cover all actions
- [ ] MockCatalogService tests verify behavior
- [ ] Coverage > 60% for catalog module

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| File System Access API not available in CI | Demo mode with MockFileSystemProvider |
| Large test suite slows CI | Run E2E tests in parallel, use demo mode |
| Flaky E2E tests | Use deterministic demo data, avoid timing-dependent assertions |
| Service initialization race conditions | Plugin returns promise, awaited during app boot |

---

## Summary

Phase 7 transforms Literoom from a collection of components into a fully integrated, testable application:

1. **CatalogService plugin** makes the service globally available and wires callbacks to stores
2. **Demo mode** enables E2E testing without real file system access
3. **MockCatalogService** provides deterministic behavior for reliable tests
4. **E2E tests** verify core workflows (grid, keyboard, filters)
5. **Unit tests** ensure stores and services behave correctly

After Phase 7, the app will have a complete vertical slice of functionality that can be tested in CI and demonstrated without requiring actual photo files.
