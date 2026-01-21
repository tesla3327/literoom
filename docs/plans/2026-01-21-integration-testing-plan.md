# Phase 7: Integration and Testing Implementation Plan

**Date**: 2026-01-21
**Status**: In Progress
**Research**: [Integration Testing Synthesis](../research/2026-01-21-integration-testing-synthesis.md)

---

## Overview

Phase 7 completes the vertical integration of Literoom's catalog functionality by:
1. Creating mock services for deterministic testing
2. Implementing a CatalogService Nuxt plugin with proper store wiring
3. Setting up demo mode for E2E tests without File System Access API
4. Building comprehensive E2E and unit test coverage

---

## Implementation Phases

### Phase 7.1: Mock Services

**Goal**: Create mock implementations for testing without real file system access.

#### 7.1.1 Create `packages/core/src/catalog/demo-assets.ts`

Demo asset factory for generating deterministic test data:

```typescript
import type { Asset, FlagStatus } from './types'

export interface DemoAssetOptions {
  count?: number
  pickRate?: number      // 0-1, default 0.4
  rejectRate?: number    // 0-1, default 0.2
  rawRate?: number       // 0-1, default 0.25
}

export function createDemoAssets(options: DemoAssetOptions = {}): Asset[]
export function createDemoAsset(index: number, options?: DemoAssetOptions): Asset
```

Key features:
- Configurable flag distribution (default: 40% unflagged, 40% picked, 20% rejected)
- Mix of JPEG and ARW files
- Deterministic IDs based on index
- Varied file sizes and capture dates

#### 7.1.2 Create `packages/core/src/filesystem/mock.ts`

MockFileSystemProvider for demo mode:

```typescript
import type { FileSystemProvider, DirectoryEntry, FileHandle } from './types'

export interface MockFileSystemProviderOptions {
  demoImageBaseUrl?: string  // Default: '/demo-images'
}

export class MockFileSystemProvider implements FileSystemProvider {
  constructor(options?: MockFileSystemProviderOptions)

  // Returns true (always supported in mock mode)
  isSupported(): boolean

  // Returns a mock directory handle for 'Demo Photos' folder
  selectDirectory(): Promise<MockDirectoryHandle>

  // Lists demo files from predefined list
  listDirectory(handle: FileHandle): Promise<DirectoryEntry[]>

  // Reads file contents from demo-images URL
  readFile(handle: FileHandle): Promise<ArrayBuffer>

  // No-ops for mock mode
  saveHandle(): Promise<void>
  loadHandle(): Promise<FileHandle | null>
  queryPermission(): Promise<PermissionState>
  requestPermission(): Promise<PermissionState>
}
```

#### 7.1.3 Create `packages/core/src/catalog/mock-catalog-service.ts`

MockCatalogService for E2E testing:

```typescript
import type { ICatalogService, Asset, FlagStatus } from './types'
import { createDemoAssets } from './demo-assets'

export interface MockCatalogServiceOptions {
  demoAssets?: Asset[]
  scanDelayMs?: number        // Delay between scan batches (default: 50)
  thumbnailDelayMs?: number   // Delay for thumbnail generation (default: 100)
  failScan?: boolean          // Force scan failure for error testing
}

export class MockCatalogService implements ICatalogService {
  static async create(options?: MockCatalogServiceOptions): Promise<MockCatalogService>

  // Callback properties (same as real CatalogService)
  onAssetsAdded?: (assets: Asset[]) => void
  onAssetUpdated?: (asset: Asset) => void
  onThumbnailReady?: (assetId: string, url: string) => void
  onScanProgress?: (current: number, total: number) => void
  onError?: (error: Error) => void

  // Core methods
  scanFolder(handle: FileHandle): AsyncGenerator<Asset[], void, unknown>
  loadFromDatabase(): Promise<boolean>
  getAssets(): Asset[]
  getAsset(id: string): Asset | undefined
  setFlag(assetId: string, flag: FlagStatus): Promise<void>
  setFlagBatch(assetIds: string[], flag: FlagStatus): Promise<void>
  requestThumbnail(assetId: string, priority: number): void
  cancelThumbnail(assetId: string): void
  destroy(): void
}
```

Key features:
- Uses `createDemoAssets()` by default (50 assets)
- Configurable delays for realistic async behavior
- In-memory storage (no IndexedDB)
- Pre-generated thumbnail URLs (solid color images)

#### 7.1.4 Update exports

Add to `packages/core/src/catalog/index.ts`:
```typescript
export { MockCatalogService, type MockCatalogServiceOptions } from './mock-catalog-service'
export { createDemoAssets, createDemoAsset, type DemoAssetOptions } from './demo-assets'
```

Add to `packages/core/src/filesystem/index.ts`:
```typescript
export { MockFileSystemProvider, type MockFileSystemProviderOptions } from './mock'
```

#### 7.1.5 Verification

- [ ] `createDemoAssets(50)` returns 50 valid Asset objects
- [ ] MockFileSystemProvider.listDirectory returns demo file entries
- [ ] MockCatalogService.scanFolder yields assets in batches
- [ ] MockCatalogService callbacks fire correctly
- [ ] Unit tests pass

---

### Phase 7.2: Nuxt Plugin Integration

**Goal**: Create CatalogService plugin with proper store wiring.

#### 7.2.1 Update `apps/web/nuxt.config.ts`

Add runtime config for demo mode:

```typescript
export default defineNuxtConfig({
  runtimeConfig: {
    public: {
      demoMode: process.env.LITEROOM_DEMO_MODE === 'true',
    },
  },
  // ... existing config
})
```

#### 7.2.2 Create `apps/web/app/plugins/catalog.client.ts`

Client-only plugin that initializes CatalogService:

```typescript
export default defineNuxtPlugin(async () => {
  const config = useRuntimeConfig()
  const isDemoMode = config.public.demoMode

  // Import services dynamically to support tree-shaking
  const { DecodeService, MockDecodeService } = await import('@literoom/core/decode')
  const { CatalogService, MockCatalogService } = await import('@literoom/core/catalog')

  // Create decode service (real or mock)
  const decodeService = isDemoMode
    ? await MockDecodeService.create()
    : await DecodeService.create()

  // Create catalog service (real or mock)
  const catalogService = isDemoMode
    ? await MockCatalogService.create()
    : await CatalogService.create(decodeService)

  // Get stores
  const catalogStore = useCatalogStore()
  const selectionStore = useSelectionStore()

  // Wire callbacks
  catalogService.onAssetsAdded = (assets) => {
    catalogStore.addAssetBatch(assets)
  }

  catalogService.onAssetUpdated = (asset) => {
    catalogStore.updateAsset(asset.id, asset)
  }

  catalogService.onThumbnailReady = (assetId, url) => {
    catalogStore.updateThumbnail(assetId, 'ready', url)
  }

  catalogService.onScanProgress = (current, total) => {
    catalogStore.setScanProgress(current, total)
  }

  catalogService.onError = (error) => {
    console.error('[CatalogService]', error)
  }

  // Session restoration (only for real mode)
  if (!isDemoMode) {
    const restored = await catalogService.loadFromDatabase()
    if (restored) {
      const assets = catalogService.getAssets()
      catalogStore.addAssetBatch(assets)
    }
  }

  // Cleanup on page unload
  if (import.meta.client) {
    window.addEventListener('beforeunload', () => {
      catalogService.destroy()
    })
  }

  return {
    provide: {
      catalogService,
      decodeService,
    },
  }
})
```

#### 7.2.3 Create `apps/web/app/composables/useCatalog.ts`

Composable for accessing CatalogService:

```typescript
import type { ICatalogService } from '@literoom/core/catalog'

export function useCatalog() {
  const nuxtApp = useNuxtApp()
  const catalogService = nuxtApp.$catalogService as ICatalogService

  const catalogStore = useCatalogStore()
  const selectionStore = useSelectionStore()

  async function selectFolder() {
    // For demo mode, trigger auto-scan
    const config = useRuntimeConfig()
    if (config.public.demoMode) {
      catalogStore.setScanning(true)
      for await (const batch of catalogService.scanFolder(null as any)) {
        // Callback handles adding to store
      }
      catalogStore.setScanning(false)
      return
    }

    // Real mode: use BrowserFileSystemProvider
    const { BrowserFileSystemProvider } = await import('@literoom/core/filesystem')
    const fsProvider = new BrowserFileSystemProvider()

    if (!fsProvider.isSupported()) {
      throw new Error('File System Access API not supported')
    }

    const handle = await fsProvider.selectDirectory()
    if (!handle) return

    // Save handle for session restoration
    await fsProvider.saveHandle('main-folder', handle)

    catalogStore.setFolderPath(handle.name)
    catalogStore.setScanning(true)

    for await (const batch of catalogService.scanFolder(handle)) {
      // Callback handles adding to store
    }

    catalogStore.setScanning(false)
  }

  function setFlag(flag: FlagStatus) {
    const selectedIds = selectionStore.selectedIds
    if (selectedIds.size === 0 && selectionStore.currentId) {
      catalogService.setFlag(selectionStore.currentId, flag)
    } else if (selectedIds.size > 0) {
      catalogService.setFlagBatch([...selectedIds], flag)
    }
  }

  function requestThumbnail(assetId: string, priority: number) {
    catalogService.requestThumbnail(assetId, priority)
  }

  return {
    selectFolder,
    setFlag,
    requestThumbnail,
    catalogService,
  }
}
```

#### 7.2.4 Update `apps/web/app/pages/index.vue`

Simplify page to use composables:

```vue
<script setup lang="ts">
const catalogStore = useCatalogStore()
const catalogUIStore = useCatalogUIStore()
const selectionStore = useSelectionStore()
const permissionRecoveryStore = usePermissionRecoveryStore()

const { selectFolder, setFlag } = useCatalog()

const folderName = computed(() => {
  const path = catalogStore.folderPath
  return path ? path.split('/').pop() || path : null
})

const hasAssets = computed(() => catalogStore.assetIds.length > 0)
const showWelcome = computed(() => !catalogStore.folderPath && !catalogStore.isScanning)
</script>
```

#### 7.2.5 Verification

- [ ] Plugin initializes on app start (check console)
- [ ] `useCatalog()` returns service instance
- [ ] Demo mode: `LITEROOM_DEMO_MODE=true pnpm dev` loads demo catalog
- [ ] Real mode: folder selection works
- [ ] Store updates correctly from callbacks

---

### Phase 7.3: Demo Mode Assets

**Goal**: Create demo images for testing.

#### 7.3.1 Create `apps/web/public/demo-images/` directory

Generate 5 placeholder images:
- `demo-0.jpg` through `demo-4.jpg`
- 256x256 solid color squares
- Colors: blue, green, red, gray, purple

These are used by MockFileSystemProvider to return actual image bytes.

Note: For E2E tests, MockCatalogService generates thumbnail URLs programmatically using data URLs, so physical files are only needed for full decode testing.

#### 7.3.2 Create `apps/web/test/fixtures/demo-catalog.ts`

Test fixture helpers:

```typescript
import { createDemoAssets } from '@literoom/core/catalog'

export const DEMO_CATALOG_SIZE = 50

export function createTestCatalog(overrides?: Partial<Asset>[]) {
  const assets = createDemoAssets({ count: DEMO_CATALOG_SIZE })
  if (overrides) {
    overrides.forEach((override, i) => {
      if (assets[i]) Object.assign(assets[i], override)
    })
  }
  return assets
}

export function findAssetsByFlag(assets: Asset[], flag: FlagStatus) {
  return assets.filter(a => a.flag === flag)
}
```

#### 7.3.3 Verification

- [ ] Demo images accessible at `/demo-images/demo-0.jpg`
- [ ] Test fixtures create valid asset arrays

---

### Phase 7.4: E2E Tests

**Goal**: Comprehensive E2E test coverage for catalog workflows.

#### 7.4.1 Update `apps/web/playwright.config.ts`

Configure for demo mode:

```typescript
export default defineConfig({
  webServer: {
    command: 'LITEROOM_DEMO_MODE=true pnpm dev',
    port: 3000,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:3000',
  },
})
```

#### 7.4.2 Create `apps/web/e2e/catalog-grid.spec.ts`

Grid display and scrolling tests:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Catalog Grid', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Wait for demo catalog to load
    await page.waitForSelector('[data-testid="catalog-grid"]')
  })

  test('displays grid with thumbnails', async ({ page }) => {
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    await expect(thumbnails).toHaveCount(50) // Demo catalog size
  })

  test('virtual scrolling renders only visible rows', async ({ page }) => {
    // Check that not all 50 items are in DOM initially
    const rendered = await page.locator('[data-testid="catalog-thumbnail"]').count()
    expect(rendered).toBeLessThan(50)
  })

  test('scrolling loads more items', async ({ page }) => {
    const grid = page.locator('[data-testid="catalog-grid"]')
    await grid.evaluate(el => el.scrollTop = 1000)
    // Wait for virtualization to update
    await page.waitForTimeout(100)
    // Items should still render
    const rendered = await page.locator('[data-testid="catalog-thumbnail"]').count()
    expect(rendered).toBeGreaterThan(0)
  })
})
```

#### 7.4.3 Create `apps/web/e2e/keyboard-navigation.spec.ts`

Keyboard shortcut tests:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Keyboard Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid="catalog-grid"]')
    // Focus the grid
    await page.click('[data-testid="catalog-grid"]')
  })

  test('arrow keys navigate grid', async ({ page }) => {
    // Press right arrow
    await page.keyboard.press('ArrowRight')
    const current = page.locator('[data-testid="catalog-thumbnail"][data-current="true"]')
    await expect(current).toHaveAttribute('data-index', '1')
  })

  test('P key picks current photo', async ({ page }) => {
    await page.keyboard.press('p')
    const flagBadge = page.locator('[data-testid="catalog-thumbnail"][data-index="0"] [data-testid="flag-badge"]')
    await expect(flagBadge).toBeVisible()
    await expect(flagBadge).toHaveAttribute('data-flag', 'pick')
  })

  test('X key rejects current photo', async ({ page }) => {
    await page.keyboard.press('x')
    const flagBadge = page.locator('[data-testid="catalog-thumbnail"][data-index="0"] [data-testid="flag-badge"]')
    await expect(flagBadge).toHaveAttribute('data-flag', 'reject')
  })

  test('U key clears flag', async ({ page }) => {
    await page.keyboard.press('p') // First pick
    await page.keyboard.press('u') // Then clear
    const flagBadge = page.locator('[data-testid="catalog-thumbnail"][data-index="0"] [data-testid="flag-badge"]')
    await expect(flagBadge).not.toBeVisible()
  })
})
```

#### 7.4.4 Create `apps/web/e2e/filter-modes.spec.ts`

Filter functionality tests:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Filter Modes', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForSelector('[data-testid="catalog-grid"]')
  })

  test('filter buttons show counts', async ({ page }) => {
    const allButton = page.locator('button:has-text("All")')
    const picksButton = page.locator('button:has-text("Picks")')
    const rejectsButton = page.locator('button:has-text("Rejects")')

    await expect(allButton).toContainText('50')
    // Counts depend on demo data distribution
    await expect(picksButton).toBeVisible()
    await expect(rejectsButton).toBeVisible()
  })

  test('clicking Picks filters to picked photos', async ({ page }) => {
    const picksButton = page.locator('button:has-text("Picks")')
    await picksButton.click()

    // All visible items should have pick flag
    const flagBadges = page.locator('[data-testid="flag-badge"]')
    const count = await flagBadges.count()
    for (let i = 0; i < count; i++) {
      await expect(flagBadges.nth(i)).toHaveAttribute('data-flag', 'pick')
    }
  })

  test('clicking All shows all photos', async ({ page }) => {
    // First filter to picks
    await page.click('button:has-text("Picks")')
    // Then back to all
    await page.click('button:has-text("All")')

    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    const count = await thumbnails.count()
    expect(count).toBeGreaterThan(10) // Should show more than just picks
  })
})
```

#### 7.4.5 Create `apps/web/e2e/folder-selection.spec.ts`

Folder workflow tests (demo mode):

```typescript
import { test, expect } from '@playwright/test'

test.describe('Folder Selection (Demo Mode)', () => {
  test('home page shows welcome screen initially', async ({ page }) => {
    // Clear any stored state
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')

    const welcomeScreen = page.locator('[data-testid="welcome-screen"]')
    await expect(welcomeScreen).toBeVisible()
  })

  test('choose folder button loads demo catalog', async ({ page }) => {
    await page.evaluate(() => localStorage.clear())
    await page.goto('/')

    const chooseButton = page.locator('button:has-text("Choose Folder")')
    await chooseButton.click()

    // Wait for grid to appear
    const grid = page.locator('[data-testid="catalog-grid"]')
    await expect(grid).toBeVisible()

    // Thumbnails should be present
    const thumbnails = page.locator('[data-testid="catalog-thumbnail"]')
    await expect(thumbnails.first()).toBeVisible()
  })
})
```

#### 7.4.6 Verification

- [ ] All E2E tests pass locally
- [ ] All E2E tests pass in CI
- [ ] No flaky tests

---

### Phase 7.5: Unit Tests

**Goal**: Unit test coverage for stores and mock services.

#### 7.5.1 Create `apps/web/test/stores/catalog.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useCatalogStore } from '~/stores/catalog'
import { createDemoAssets } from '@literoom/core/catalog'

describe('catalogStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('addAssetBatch adds assets to store', () => {
    const store = useCatalogStore()
    const assets = createDemoAssets({ count: 10 })

    store.addAssetBatch(assets)

    expect(store.assetIds.length).toBe(10)
    expect(store.assets.size).toBe(10)
  })

  it('setFlag updates asset flag', () => {
    const store = useCatalogStore()
    const assets = createDemoAssets({ count: 1 })
    store.addAssetBatch(assets)

    store.setFlag(assets[0].id, 'pick')

    expect(store.assets.get(assets[0].id)?.flag).toBe('pick')
  })

  it('pickCount returns count of picked assets', () => {
    const store = useCatalogStore()
    const assets = createDemoAssets({ count: 10, pickRate: 0.5, rejectRate: 0 })
    store.addAssetBatch(assets)

    expect(store.pickCount).toBe(5)
  })
})
```

#### 7.5.2 Create `apps/web/test/stores/selection.test.ts`

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSelectionStore } from '~/stores/selection'

describe('selectionStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('selectSingle sets currentId and clears selection', () => {
    const store = useSelectionStore()

    store.selectSingle('asset-1', ['asset-1', 'asset-2', 'asset-3'])

    expect(store.currentId).toBe('asset-1')
    expect(store.selectedIds.size).toBe(1)
    expect(store.selectedIds.has('asset-1')).toBe(true)
  })

  it('toggleSelection adds/removes from selection', () => {
    const store = useSelectionStore()
    store.selectSingle('asset-1', ['asset-1', 'asset-2'])

    store.toggleSelection('asset-2')

    expect(store.selectedIds.has('asset-1')).toBe(true)
    expect(store.selectedIds.has('asset-2')).toBe(true)

    store.toggleSelection('asset-2')

    expect(store.selectedIds.has('asset-2')).toBe(false)
  })

  it('selectRange selects items between anchor and target', () => {
    const store = useSelectionStore()
    const ids = ['a-1', 'a-2', 'a-3', 'a-4', 'a-5']
    store.selectSingle('a-2', ids)

    store.selectRange('a-4', ids)

    expect(store.selectedIds.size).toBe(3)
    expect(store.selectedIds.has('a-2')).toBe(true)
    expect(store.selectedIds.has('a-3')).toBe(true)
    expect(store.selectedIds.has('a-4')).toBe(true)
  })
})
```

#### 7.5.3 Create `packages/core/src/catalog/mock-catalog-service.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest'
import { MockCatalogService } from './mock-catalog-service'
import { createDemoAssets } from './demo-assets'

describe('MockCatalogService', () => {
  it('create() returns initialized service', async () => {
    const service = await MockCatalogService.create()
    expect(service).toBeDefined()
  })

  it('scanFolder yields assets in batches', async () => {
    const assets = createDemoAssets({ count: 25 })
    const service = await MockCatalogService.create({ demoAssets: assets, scanDelayMs: 0 })

    const batches: any[] = []
    for await (const batch of service.scanFolder(null as any)) {
      batches.push(batch)
    }

    expect(batches.length).toBeGreaterThan(0)
    expect(batches.flat().length).toBe(25)
  })

  it('setFlag updates asset and fires callback', async () => {
    const service = await MockCatalogService.create()
    const onAssetUpdated = vi.fn()
    service.onAssetUpdated = onAssetUpdated

    const assets = service.getAssets()
    await service.setFlag(assets[0].id, 'pick')

    expect(onAssetUpdated).toHaveBeenCalledTimes(1)
    expect(service.getAsset(assets[0].id)?.flag).toBe('pick')
  })

  it('requestThumbnail fires onThumbnailReady', async () => {
    const service = await MockCatalogService.create({ thumbnailDelayMs: 10 })
    const onThumbnailReady = vi.fn()
    service.onThumbnailReady = onThumbnailReady

    const assets = service.getAssets()
    service.requestThumbnail(assets[0].id, 1)

    await new Promise(r => setTimeout(r, 50))

    expect(onThumbnailReady).toHaveBeenCalledWith(assets[0].id, expect.any(String))
  })
})
```

#### 7.5.4 Verification

- [ ] `pnpm test:unit` passes
- [ ] Coverage > 60% for catalog module

---

## File Summary

```
packages/core/src/
├── catalog/
│   ├── demo-assets.ts              # 7.1.1
│   ├── mock-catalog-service.ts     # 7.1.3
│   ├── mock-catalog-service.test.ts # 7.5.3
│   └── index.ts                    # 7.1.4 (updated)
└── filesystem/
    ├── mock.ts                     # 7.1.2
    └── index.ts                    # 7.1.4 (updated)

apps/web/
├── app/
│   ├── plugins/
│   │   └── catalog.client.ts       # 7.2.2
│   ├── composables/
│   │   └── useCatalog.ts           # 7.2.3
│   └── pages/
│       └── index.vue               # 7.2.4 (updated)
├── public/
│   └── demo-images/                # 7.3.1
├── test/
│   ├── fixtures/
│   │   └── demo-catalog.ts         # 7.3.2
│   └── stores/
│       ├── catalog.test.ts         # 7.5.1
│       └── selection.test.ts       # 7.5.2
├── e2e/
│   ├── catalog-grid.spec.ts        # 7.4.2
│   ├── keyboard-navigation.spec.ts # 7.4.3
│   ├── filter-modes.spec.ts        # 7.4.4
│   └── folder-selection.spec.ts    # 7.4.5
├── nuxt.config.ts                  # 7.2.1 (updated)
└── playwright.config.ts            # 7.4.1 (updated)
```

---

## Verification Checklist

After all phases complete:

**Mock Services (7.1):**
- [ ] `createDemoAssets()` returns valid Asset array
- [ ] MockFileSystemProvider implements FileSystemProvider interface
- [ ] MockCatalogService fires all callbacks correctly
- [ ] Unit tests pass for mock services

**Plugin Integration (7.2):**
- [ ] Plugin initializes on app start
- [ ] Demo mode activates with `LITEROOM_DEMO_MODE=true`
- [ ] Service callbacks wire to stores correctly
- [ ] `useCatalog()` composable works

**Demo Assets (7.3):**
- [ ] Demo images accessible at `/demo-images/`
- [ ] Test fixtures create valid data

**E2E Tests (7.4):**
- [ ] Grid tests pass
- [ ] Keyboard navigation tests pass
- [ ] Filter tests pass
- [ ] Folder selection tests pass

**Unit Tests (7.5):**
- [ ] Store tests pass
- [ ] MockCatalogService tests pass
- [ ] Coverage > 60%

---

## Implementation Order

1. **Phase 7.1**: Mock Services (demo-assets, MockFileSystemProvider, MockCatalogService)
2. **Phase 7.2**: Nuxt Plugin Integration (catalog.client.ts, useCatalog composable)
3. **Phase 7.3**: Demo Mode Assets (public/demo-images/, test fixtures)
4. **Phase 7.4**: E2E Tests (Playwright test files)
5. **Phase 7.5**: Unit Tests (store tests, mock service tests)

---

## Dependencies

No new dependencies required. All tools already installed:
- Vitest for unit tests
- Playwright for E2E tests
- Pinia for stores
- @tanstack/vue-virtual for grid
