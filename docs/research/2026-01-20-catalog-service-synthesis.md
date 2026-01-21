# Catalog Service Research Synthesis

**Date**: 2026-01-20
**Status**: Complete
**Priority**: Critical (enables primary user workflow)

---

## Executive Summary

This document synthesizes research from 6 areas to provide a clear implementation path for the Catalog Service - the core system enabling Literoom's primary workflow: folder selection → scanning → thumbnail display → culling.

### Key Decisions Made

| Area | Decision | Rationale |
|------|----------|-----------|
| **Storage** | Dexie.js for metadata, OPFS for binary blobs | Compound indexes for filtering, 2-4x faster binary I/O |
| **Scanning** | Async generator with batched yielding | Non-blocking, cancellable, streamable |
| **Thumbnails** | Priority queue with LRU cache | Viewport-aware generation, memory bounded |
| **State** | Normalized Pinia stores with shallowRef | O(1) lookups, efficient reactivity |
| **Permissions** | Existing FileSystemProvider abstraction | Already handles IndexedDB persistence |
| **Service Pattern** | Async factory, IService interface | Consistent with DecodeService patterns |

---

## 1. Architecture Overview

### System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                          Nuxt App                                │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  CatalogGrid │  │   LoupeView  │  │  FilterBar   │           │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                  │                 │                   │
│  ┌──────▼──────────────────▼─────────────────▼───────┐          │
│  │                 Pinia Stores                       │          │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐  │          │
│  │  │ catalogStore│ │catalogUIStore│ │selectionStore│ │          │
│  │  └──────┬──────┘ └──────┬──────┘ └─────────────┘  │          │
│  └─────────┼───────────────┼─────────────────────────┘          │
│            │               │                                     │
│  ┌─────────▼───────────────▼─────────────────────────┐          │
│  │               Catalog Service                      │          │
│  │  ┌──────────┐  ┌──────────────┐  ┌─────────────┐  │          │
│  │  │ScanService│ │ThumbnailService│ │CacheManager│  │          │
│  │  └────┬─────┘  └───────┬──────┘  └──────┬──────┘  │          │
│  └───────┼────────────────┼────────────────┼─────────┘          │
└──────────┼────────────────┼────────────────┼────────────────────┘
           │                │                │
           ▼                ▼                ▼
┌──────────────────┐ ┌─────────────┐ ┌──────────────────┐
│FileSystemProvider│ │DecodeService│ │ Storage Layer    │
│   (browser.ts)   │ │  (worker)   │ │ ┌────────────┐   │
└──────────────────┘ └─────────────┘ │ │ Dexie.js   │   │
                                     │ │ (IndexedDB)│   │
                                     │ └────────────┘   │
                                     │ ┌────────────┐   │
                                     │ │   OPFS     │   │
                                     │ │(thumbnails)│   │
                                     │ └────────────┘   │
                                     └──────────────────┘
```

### Data Flow: Folder Scan to Grid Display

```
1. User clicks "Choose Folder"
   └─► FileSystemProvider.selectDirectory()
       └─► Returns DirectoryHandle

2. ScanService iterates folder
   └─► Yields batches of ScannedFile[]
       └─► CatalogStore.addAssetBatch()
           └─► Triggers UI update

3. ThumbnailService processes visible assets
   └─► Priority queue orders by viewport position
       └─► DecodeService.generateThumbnail()
           └─► Cache in OPFS + memory LRU
               └─► CatalogStore.updateThumbnail()
                   └─► Grid component re-renders
```

---

## 2. Storage Architecture

### IndexedDB Schema (Dexie.js)

```typescript
// packages/core/src/catalog/db.ts
import Dexie, { Table } from 'dexie'

interface AssetRecord {
  id?: number              // Auto-increment PK
  folderId: number         // FK to folders
  path: string             // Relative path from folder root
  filename: string         // Filename without extension
  extension: string        // 'arw', 'jpg', 'jpeg'
  flag: 'none' | 'pick' | 'reject'
  captureDate: Date        // EXIF capture timestamp
  modifiedDate: Date       // File modification date
  fileSize: number
  width?: number
  height?: number
}

interface FolderRecord {
  id?: number
  path: string             // Unique folder path
  name: string             // Display name
  handleKey: string        // Key for FileSystemProvider.loadHandle()
  lastScanDate: Date
}

interface EditRecord {
  assetId: number          // 1:1 with asset
  schemaVersion: number    // For migrations
  updatedAt: Date
  settings: string         // JSON serialized edit settings
}

interface CacheMetadataRecord {
  assetId: number
  thumbnailReady: boolean
  preview1xReady: boolean
  preview2xReady: boolean
}

class LiteroomDB extends Dexie {
  assets!: Table<AssetRecord, number>
  folders!: Table<FolderRecord, number>
  edits!: Table<EditRecord, number>
  cacheMetadata!: Table<CacheMetadataRecord, number>

  constructor() {
    super('LiteroomCatalog')

    this.version(1).stores({
      assets: '++id, folderId, path, filename, flag, captureDate, [flag+captureDate], [folderId+captureDate]',
      folders: '++id, &path',
      edits: '&assetId, schemaVersion',
      cacheMetadata: '&assetId'
    })
  }
}

export const db = new LiteroomDB()
```

### OPFS Directory Structure

```
/literoom/
  /thumbnails/
    {assetId}.jpg           # 256px thumbnails (~50KB each)
  /previews/
    {assetId}_1x.jpg        # 2560px previews (~500KB each)
    {assetId}_2x.jpg        # 5120px previews (optional)
```

### Key Query Patterns

```typescript
// All picks sorted by date (uses compound index)
const picks = await db.assets
  .where('[flag+captureDate]')
  .between(['pick', Dexie.minKey], ['pick', Dexie.maxKey])
  .reverse()
  .toArray()

// Count by flag status (uses flag index)
const pickCount = await db.assets.where('flag').equals('pick').count()
```

---

## 3. Service Interfaces

### ICatalogService

```typescript
// packages/core/src/catalog/types.ts

export type CatalogServiceStatus = 'initializing' | 'ready' | 'scanning' | 'error'

export interface CatalogServiceState {
  status: CatalogServiceStatus
  error?: string
}

export interface ICatalogService {
  readonly state: CatalogServiceState
  readonly isReady: boolean

  // Folder management
  selectFolder(): Promise<void>
  getCurrentFolder(): DirectoryHandle | null

  // Scanning
  scanFolder(options?: ScanOptions): Promise<void>
  rescanFolder(): Promise<void>
  cancelScan(): void

  // Asset access
  getAsset(id: string): Asset | undefined
  getAssets(): Asset[]

  // Flag management
  setFlag(assetId: string, flag: FlagStatus): Promise<void>
  setFlagBatch(assetIds: string[], flag: FlagStatus): Promise<void>

  // Cleanup
  destroy(): void
}
```

### IThumbnailService

```typescript
export interface IThumbnailService {
  // Request thumbnail with priority
  getThumbnail(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority
  ): Promise<string>  // Returns object URL

  // Priority management
  updatePriority(assetId: string, priority: ThumbnailPriority): void
  cancel(assetId: string): void
  cancelAll(): void

  // Cache management
  clearMemoryCache(): void

  // Metrics
  readonly queueSize: number
}

export enum ThumbnailPriority {
  VISIBLE = 0,
  NEAR_VISIBLE = 1,
  PRELOAD = 2,
  BACKGROUND = 3
}
```

---

## 4. Pinia Store Structure

### catalogStore

```typescript
// stores/catalog.ts
export const useCatalogStore = defineStore('catalog', () => {
  // State (using shallowRef for large collections)
  const assets = shallowRef<Map<string, Asset>>(new Map())
  const assetIds = shallowRef<string[]>([])
  const folderPath = ref<string | null>(null)
  const isScanning = ref(false)

  // Getters
  const assetCount = computed(() => assetIds.value.length)

  // Actions
  function addAssetBatch(newAssets: Asset[]) {
    for (const asset of newAssets) {
      assets.value.set(asset.id, asset)
    }
    assetIds.value = [...assetIds.value, ...newAssets.map(a => a.id)]
    triggerRef(assets)
  }

  function updateThumbnail(assetId: string, status: ThumbnailStatus, url: string | null) {
    const asset = assets.value.get(assetId)
    if (asset) {
      if (asset.thumbnailUrl && url !== asset.thumbnailUrl) {
        URL.revokeObjectURL(asset.thumbnailUrl)
      }
      asset.thumbnailStatus = status
      asset.thumbnailUrl = url
      triggerRef(assets)
    }
  }

  function setFlag(assetId: string, flag: FlagStatus) {
    const asset = assets.value.get(assetId)
    if (asset) {
      asset.flag = flag
      triggerRef(assets)
    }
  }

  return { assets, assetIds, folderPath, isScanning, assetCount, addAssetBatch, updateThumbnail, setFlag }
})
```

### catalogUIStore

```typescript
// stores/catalogUI.ts
export const useCatalogUIStore = defineStore('catalogUI', () => {
  const catalogStore = useCatalogStore()

  const filterMode = ref<FilterMode>('all')
  const sortField = ref<SortField>('captureDate')
  const sortDirection = ref<SortDirection>('desc')
  const viewMode = ref<ViewMode>('grid')

  // Computed: filtered and sorted asset IDs
  const filteredAssetIds = computed<string[]>(() => {
    if (filterMode.value === 'all') return catalogStore.assetIds.value

    const flagMatch = filterMode.value === 'picks' ? 'pick'
      : filterMode.value === 'rejects' ? 'reject' : 'unflagged'

    return catalogStore.assetIds.value.filter(id => {
      const asset = catalogStore.assets.value.get(id)
      return asset?.flag === flagMatch
    })
  })

  const flagCounts = computed(() => {
    const counts = { all: 0, picks: 0, rejects: 0, unflagged: 0 }
    for (const id of catalogStore.assetIds.value) {
      const asset = catalogStore.assets.value.get(id)
      if (!asset) continue
      counts.all++
      if (asset.flag === 'pick') counts.picks++
      else if (asset.flag === 'reject') counts.rejects++
      else counts.unflagged++
    }
    return counts
  })

  return { filterMode, sortField, sortDirection, viewMode, filteredAssetIds, flagCounts }
})
```

### selectionStore

```typescript
// stores/selection.ts
export const useSelectionStore = defineStore('selection', () => {
  const currentId = ref<string | null>(null)
  const selectedIds = ref<Set<string>>(new Set())
  const lastClickedId = ref<string | null>(null)

  function selectSingle(assetId: string) {
    selectedIds.value.clear()
    selectedIds.value.add(assetId)
    currentId.value = assetId
    lastClickedId.value = assetId
  }

  function toggleSelection(assetId: string) {
    if (selectedIds.value.has(assetId)) {
      selectedIds.value.delete(assetId)
    } else {
      selectedIds.value.add(assetId)
    }
    currentId.value = assetId
    lastClickedId.value = assetId
  }

  function handleClick(assetId: string, event: MouseEvent) {
    if (event.shiftKey) selectRange(assetId)
    else if (event.metaKey || event.ctrlKey) toggleSelection(assetId)
    else selectSingle(assetId)
  }

  return { currentId, selectedIds, lastClickedId, selectSingle, toggleSelection, handleClick }
})
```

---

## 5. Implementation Phases

### Phase 1: Core Types and Database (1-2 hours)
- Create `packages/core/src/catalog/types.ts` with all interfaces
- Create `packages/core/src/catalog/db.ts` with Dexie schema
- Add `dexie` dependency

### Phase 2: Scan Service (2-3 hours)
- Create `packages/core/src/catalog/scan-service.ts`
- Async generator with batched yielding
- AbortController for cancellation
- Progress reporting
- Extension-based file detection

### Phase 3: Thumbnail Service (3-4 hours)
- Create `packages/core/src/catalog/thumbnail-service.ts`
- Priority queue implementation
- LRU memory cache
- OPFS persistent cache
- Integration with DecodeService

### Phase 4: Catalog Service (2-3 hours)
- Create `packages/core/src/catalog/catalog-service.ts`
- Async factory pattern (matches DecodeService)
- Composition of ScanService and ThumbnailService
- Database operations for persistence

### Phase 5: Pinia Stores (2-3 hours)
- Create `apps/web/stores/catalog.ts`
- Create `apps/web/stores/catalogUI.ts`
- Create `apps/web/stores/selection.ts`
- Type definitions and exports

### Phase 6: UI Components (3-4 hours)
- CatalogGrid with TanStack Virtual
- Thumbnail component
- Filter bar component
- Permission recovery modal

### Phase 7: Integration and Testing (2-3 hours)
- Wire up stores to CatalogService
- Integration testing
- E2E test with demo catalog

---

## 6. File Organization

```
packages/core/src/
├── catalog/
│   ├── types.ts              # Core types and interfaces
│   ├── db.ts                 # Dexie database schema
│   ├── scan-service.ts       # Folder scanning
│   ├── thumbnail-service.ts  # Thumbnail generation
│   ├── thumbnail-queue.ts    # Priority queue
│   ├── thumbnail-cache.ts    # LRU + OPFS caching
│   ├── catalog-service.ts    # Main service (composition)
│   ├── mock-catalog-service.ts
│   └── index.ts              # Public exports
├── filesystem/               # Existing
└── decode/                   # Existing

apps/web/
├── stores/
│   ├── catalog.ts            # Asset data store
│   ├── catalogUI.ts          # Filter/sort/view state
│   └── selection.ts          # Selection state
├── composables/
│   ├── useCatalog.ts         # CatalogService access
│   └── useVirtualCatalog.ts  # Virtual scroll integration
└── components/
    ├── catalog/
    │   ├── CatalogGrid.vue
    │   ├── CatalogThumbnail.vue
    │   ├── FilterBar.vue
    │   └── PermissionRecovery.vue
    └── ...
```

---

## 7. Dependencies to Add

```bash
# In packages/core
pnpm add dexie

# Optional for OPFS cache
# No additional deps - uses native APIs

# In apps/web (if not already present)
pnpm add @tanstack/vue-virtual
```

---

## 8. Key Patterns from Existing Code

### Follow DecodeService Patterns

1. **Async Factory**: `static async create(): Promise<CatalogService>`
2. **Interface-first**: `ICatalogService` interface for mocking
3. **State tracking**: `CatalogServiceState` with status enum
4. **Error class**: `CatalogError` with error codes
5. **Cleanup**: `destroy()` method for resource cleanup

### Follow FileSystemProvider Patterns

1. **Handle persistence**: Already in place via `saveHandle`/`loadHandle`
2. **Permission checking**: `queryPermission`/`requestPermission` wrappers
3. **Error mapping**: Convert DOMExceptions to typed errors

---

## 9. Verification Checklist

After implementation:

- [ ] `pnpm typecheck` passes
- [ ] Can select folder and persist handle
- [ ] Can scan folder and see file count
- [ ] Thumbnails generate with visible items first
- [ ] Filtering by flag status works
- [ ] Keyboard navigation works (arrow keys)
- [ ] Multi-select works (Shift/Ctrl+click)
- [ ] Flagging persists across reload
- [ ] Permission recovery UI shows when needed
- [ ] Demo catalog mode works for E2E tests

---

## 10. Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Large catalogs slow UI | Virtual scrolling, shallowRef, lazy loading |
| Thumbnail queue explosion | Max queue size (200), priority eviction |
| Memory leaks from Object URLs | Centralized revocation in store actions |
| OPFS browser differences | Firefox fallback to IndexedDB blobs |
| Permission state sync across tabs | BroadcastChannel for permission changes |

---

## Sources

Research documents in `docs/research/`:
- `2026-01-20-catalog-area-1-storage.md` - IndexedDB/OPFS patterns
- `2026-01-20-catalog-area-2-scanning.md` - Folder scanning patterns
- `2026-01-20-catalog-area-3-thumbnails.md` - Thumbnail pipeline
- `2026-01-20-catalog-area-4-state.md` - Vue/Pinia state management
- `2026-01-20-catalog-area-5-permissions.md` - Permission recovery
- `2026-01-20-catalog-area-6-codebase-review.md` - Existing patterns
