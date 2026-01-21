# Catalog Service Implementation Plan

**Date**: 2026-01-20
**Status**: In Progress
**Research**: [Catalog Service Synthesis](../research/2026-01-20-catalog-service-synthesis.md)

---

## Overview

The Catalog Service is the core system enabling Literoom's primary workflow:
1. User selects a folder
2. App scans folder and discovers assets
3. Thumbnails generate progressively (viewport-first)
4. User culls with Pick/Reject flags
5. Data persists across sessions

---

## Implementation Phases

### Phase 1: Core Types and Database ⬜

**Goal**: Define all TypeScript types and set up Dexie.js database schema.

#### 1.1 Create `packages/core/src/catalog/types.ts`

```typescript
// Asset and folder types
export interface Asset {
  id: string                    // UUID
  folderId: string
  path: string                  // Relative path from folder root
  filename: string              // Without extension
  extension: string             // 'arw', 'jpg', 'jpeg'
  flag: FlagStatus
  captureDate: Date | null
  modifiedDate: Date
  fileSize: number
  width?: number
  height?: number
  thumbnailStatus: ThumbnailStatus
  thumbnailUrl: string | null
}

export type FlagStatus = 'none' | 'pick' | 'reject'
export type ThumbnailStatus = 'pending' | 'loading' | 'ready' | 'error'
export type FilterMode = 'all' | 'picks' | 'rejects' | 'unflagged'
export type SortField = 'captureDate' | 'filename' | 'fileSize'
export type SortDirection = 'asc' | 'desc'
export type ViewMode = 'grid' | 'loupe'

// Service state
export type CatalogServiceStatus = 'initializing' | 'ready' | 'scanning' | 'error'

export interface CatalogServiceState {
  status: CatalogServiceStatus
  error?: string
  scanProgress?: ScanProgress
}

export interface ScanProgress {
  totalFound: number
  processed: number
  currentFile?: string
}

// Scan options
export interface ScanOptions {
  recursive?: boolean           // Default: true
  signal?: AbortSignal
}

// Error handling
export type CatalogErrorCode =
  | 'PERMISSION_DENIED'
  | 'FOLDER_NOT_FOUND'
  | 'SCAN_CANCELLED'
  | 'DATABASE_ERROR'
  | 'STORAGE_FULL'
  | 'UNKNOWN'

export class CatalogError extends Error {
  readonly code: CatalogErrorCode
  override readonly cause?: Error

  constructor(code: CatalogErrorCode, message: string, options?: { cause?: Error }) {
    super(message, options)
    this.name = 'CatalogError'
    this.code = code
    this.cause = options?.cause
  }
}
```

#### 1.2 Create `packages/core/src/catalog/db.ts`

```typescript
import Dexie, { type Table } from 'dexie'

// Database record types (internal)
export interface AssetRecord {
  id?: number                   // Auto-increment PK
  uuid: string                  // Application-level ID
  folderId: number
  path: string
  filename: string
  extension: string
  flag: 'none' | 'pick' | 'reject'
  captureDate: Date | null
  modifiedDate: Date
  fileSize: number
  width?: number
  height?: number
}

export interface FolderRecord {
  id?: number
  path: string                  // Unique folder path
  name: string                  // Display name
  handleKey: string             // Key for FileSystemProvider.loadHandle()
  lastScanDate: Date
}

export interface EditRecord {
  assetId: number               // FK to assets.id
  schemaVersion: number
  updatedAt: Date
  settings: string              // JSON serialized
}

export interface CacheMetadataRecord {
  assetId: number
  thumbnailReady: boolean
  preview1xReady: boolean
  preview2xReady: boolean
}

export class LiteroomDB extends Dexie {
  assets!: Table<AssetRecord, number>
  folders!: Table<FolderRecord, number>
  edits!: Table<EditRecord, number>
  cacheMetadata!: Table<CacheMetadataRecord, number>

  constructor() {
    super('LiteroomCatalog')

    this.version(1).stores({
      assets: '++id, &uuid, folderId, path, filename, flag, captureDate, [flag+captureDate], [folderId+captureDate]',
      folders: '++id, &path',
      edits: '&assetId, schemaVersion',
      cacheMetadata: '&assetId'
    })
  }
}

export const db = new LiteroomDB()
```

#### 1.3 Add dependency

```bash
cd packages/core && pnpm add dexie
```

#### 1.4 Create `packages/core/src/catalog/index.ts`

Export all public types.

#### 1.5 Verification

- [ ] TypeScript compiles without errors
- [ ] Can import types from `@literoom/core/catalog`
- [ ] Database can be instantiated

---

### Phase 2: Scan Service ⬜

**Goal**: Implement folder scanning with async generator pattern.

#### 2.1 Create `packages/core/src/catalog/scan-service.ts`

```typescript
export interface ScannedFile {
  path: string
  filename: string
  extension: string
  fileSize: number
  modifiedDate: Date
  getFile: () => Promise<File>
}

export interface IScanService {
  scan(
    directory: FileSystemDirectoryHandle,
    options?: ScanOptions
  ): AsyncGenerator<ScannedFile[], void, unknown>
}
```

Key implementation details:
- Use `for await...of` to iterate directory entries
- Yield batches of 50 files for UI responsiveness
- Support `AbortSignal` for cancellation
- Filter by supported extensions: `.arw`, `.jpg`, `.jpeg`
- Track progress via callback or state

#### 2.2 Key patterns

```typescript
async function* scanDirectory(
  dir: FileSystemDirectoryHandle,
  options: ScanOptions = {}
): AsyncGenerator<ScannedFile[]> {
  const { recursive = true, signal } = options
  const batch: ScannedFile[] = []
  const BATCH_SIZE = 50

  for await (const entry of dir.values()) {
    if (signal?.aborted) {
      throw new CatalogError('SCAN_CANCELLED', 'Scan was cancelled')
    }

    if (entry.kind === 'file') {
      const ext = getExtension(entry.name)
      if (SUPPORTED_EXTENSIONS.includes(ext)) {
        batch.push(await createScannedFile(entry, dir))
        if (batch.length >= BATCH_SIZE) {
          yield [...batch]
          batch.length = 0
        }
      }
    } else if (entry.kind === 'directory' && recursive) {
      yield* scanDirectory(entry, options)
    }
  }

  if (batch.length > 0) {
    yield batch
  }
}
```

#### 2.3 Verification

- [ ] Can scan a folder and yield batches
- [ ] Supports recursive scanning
- [ ] Can be cancelled via AbortController
- [ ] Ignores unsupported file types

---

### Phase 3: Thumbnail Service ⬜

**Goal**: Priority-based thumbnail generation with caching.

#### 3.1 Create `packages/core/src/catalog/thumbnail-queue.ts`

Priority queue with min-heap for viewport-aware ordering.

```typescript
export enum ThumbnailPriority {
  VISIBLE = 0,      // Currently in viewport
  NEAR_VISIBLE = 1, // Within 1 screen
  PRELOAD = 2,      // Within 2 screens
  BACKGROUND = 3    // Low priority
}

export interface QueueItem {
  assetId: string
  priority: ThumbnailPriority
  getBytes: () => Promise<Uint8Array>
}

export class ThumbnailQueue {
  private items: QueueItem[] = []
  private readonly maxSize = 200

  enqueue(item: QueueItem): void
  dequeue(): QueueItem | undefined
  updatePriority(assetId: string, priority: ThumbnailPriority): void
  remove(assetId: string): void
  clear(): void
  get size(): number
}
```

#### 3.2 Create `packages/core/src/catalog/thumbnail-cache.ts`

LRU memory cache + OPFS persistent storage.

```typescript
export interface ThumbnailCache {
  get(assetId: string): string | null     // Returns object URL
  set(assetId: string, blob: Blob): string
  has(assetId: string): boolean
  delete(assetId: string): void
  clear(): void
}

export class MemoryLRUCache implements ThumbnailCache {
  private cache = new Map<string, { url: string; blob: Blob }>()
  private readonly maxSize = 150

  // LRU eviction on set
}

export class OPFSCache {
  async get(assetId: string): Promise<Blob | null>
  async set(assetId: string, blob: Blob): Promise<void>
  async has(assetId: string): Promise<boolean>
  async delete(assetId: string): Promise<void>
}
```

#### 3.3 Create `packages/core/src/catalog/thumbnail-service.ts`

```typescript
export interface IThumbnailService {
  requestThumbnail(
    assetId: string,
    getBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority
  ): void

  updatePriority(assetId: string, priority: ThumbnailPriority): void
  cancel(assetId: string): void
  cancelAll(): void
  clearMemoryCache(): void

  onThumbnailReady: (assetId: string, url: string) => void
  onThumbnailError: (assetId: string, error: Error) => void

  readonly queueSize: number
  readonly isProcessing: boolean
}
```

Key implementation:
- Process queue items one at a time (concurrency: 1)
- Check memory cache → OPFS cache → generate
- Use DecodeService for generation
- Notify via callbacks

#### 3.4 Verification

- [ ] Queue maintains priority order
- [ ] LRU eviction works correctly
- [ ] OPFS caching persists across sessions
- [ ] Cancellation stops in-flight requests
- [ ] DecodeService integration works

---

### Phase 4: Catalog Service ⬜

**Goal**: Main service composing scan and thumbnail services.

#### 4.1 Create `packages/core/src/catalog/catalog-service.ts`

```typescript
export interface ICatalogService {
  readonly state: CatalogServiceState
  readonly isReady: boolean

  // Folder management
  selectFolder(): Promise<void>
  getCurrentFolder(): FileSystemDirectoryHandle | null

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

  // Thumbnail requests
  requestThumbnail(assetId: string, priority: ThumbnailPriority): void
  updateThumbnailPriority(assetId: string, priority: ThumbnailPriority): void

  // Events
  onAssetsAdded: (assets: Asset[]) => void
  onAssetUpdated: (asset: Asset) => void
  onThumbnailReady: (assetId: string, url: string) => void

  // Cleanup
  destroy(): void
}

export class CatalogService implements ICatalogService {
  private constructor(
    private readonly fileSystem: IFileSystemProvider,
    private readonly decodeService: IDecodeService,
    private readonly scanService: IScanService,
    private readonly thumbnailService: IThumbnailService
  ) {}

  static async create(
    fileSystem: IFileSystemProvider,
    decodeService: IDecodeService
  ): Promise<CatalogService>
}
```

#### 4.2 Verification

- [ ] Factory pattern works
- [ ] Folder selection persists
- [ ] Scanning updates state progressively
- [ ] Flag changes persist to database
- [ ] Thumbnail requests flow correctly

---

### Phase 5: Pinia Stores ⬜

**Goal**: Reactive state management for Vue components.

#### 5.1 Create `apps/web/app/stores/catalog.ts`

```typescript
export const useCatalogStore = defineStore('catalog', () => {
  const assets = shallowRef<Map<string, Asset>>(new Map())
  const assetIds = shallowRef<string[]>([])
  const folderPath = ref<string | null>(null)
  const isScanning = ref(false)
  const scanProgress = ref<ScanProgress | null>(null)

  function addAssetBatch(newAssets: Asset[]): void
  function updateAsset(assetId: string, updates: Partial<Asset>): void
  function updateThumbnail(assetId: string, status: ThumbnailStatus, url: string | null): void
  function setFlag(assetId: string, flag: FlagStatus): void
  function clear(): void
})
```

#### 5.2 Create `apps/web/app/stores/catalogUI.ts`

```typescript
export const useCatalogUIStore = defineStore('catalogUI', () => {
  const filterMode = ref<FilterMode>('all')
  const sortField = ref<SortField>('captureDate')
  const sortDirection = ref<SortDirection>('desc')
  const viewMode = ref<ViewMode>('grid')

  const filteredAssetIds = computed<string[]>(() => { ... })
  const flagCounts = computed(() => { ... })
})
```

#### 5.3 Create `apps/web/app/stores/selection.ts`

```typescript
export const useSelectionStore = defineStore('selection', () => {
  const currentId = ref<string | null>(null)
  const selectedIds = ref<Set<string>>(new Set())

  function selectSingle(assetId: string): void
  function toggleSelection(assetId: string): void
  function selectRange(assetId: string, orderedIds: string[]): void
  function handleClick(assetId: string, event: MouseEvent, orderedIds: string[]): void
  function clear(): void
})
```

#### 5.4 Verification

- [ ] Stores are reactive
- [ ] Filtering works correctly
- [ ] Flag counts update
- [ ] Selection supports Shift/Ctrl+click

---

### Phase 6: UI Components ⬜

**Goal**: Grid view, thumbnails, and filter bar.

#### 6.1 Create `apps/web/app/components/catalog/CatalogGrid.vue`

- Virtual scrolling with @tanstack/vue-virtual
- Viewport-aware thumbnail priority
- Grid layout with responsive columns
- Keyboard navigation (arrow keys)

#### 6.2 Create `apps/web/app/components/catalog/CatalogThumbnail.vue`

- Shows thumbnail or loading placeholder
- Selection state visualization
- Flag indicator (pick/reject badge)
- Click handling (single, Ctrl+click, Shift+click)

#### 6.3 Create `apps/web/app/components/catalog/FilterBar.vue`

- Filter buttons: All, Picks, Rejects, Unflagged
- Count badges
- Sort dropdown (date, filename, size)

#### 6.4 Create `apps/web/app/components/catalog/PermissionRecovery.vue`

- Modal for re-authorizing folders
- Lists folders with permission issues
- Re-select button per folder

#### 6.5 Add dependency

```bash
cd apps/web && pnpm add @tanstack/vue-virtual
```

#### 6.6 Verification

- [ ] Grid scrolls smoothly with 1000+ items
- [ ] Visible thumbnails load first
- [ ] Selection highlights correctly
- [ ] Filter buttons work
- [ ] Keyboard navigation works

---

### Phase 7: Integration and Testing ⬜

**Goal**: Wire everything together and add tests.

#### 7.1 Create Nuxt plugin `apps/web/app/plugins/catalog.client.ts`

```typescript
export default defineNuxtPlugin(async () => {
  const fileSystem = await BrowserFileSystemProvider.create()
  const decodeService = await DecodeService.create()
  const catalogService = await CatalogService.create(fileSystem, decodeService)

  return {
    provide: {
      catalogService
    }
  }
})
```

#### 7.2 Create composable `apps/web/app/composables/useCatalog.ts`

```typescript
export function useCatalog() {
  const { $catalogService } = useNuxtApp()
  return $catalogService as ICatalogService
}
```

#### 7.3 Create mock service `packages/core/src/catalog/mock-catalog-service.ts`

For demo mode and E2E testing.

#### 7.4 Unit tests

- `packages/core/src/catalog/types.test.ts`
- `packages/core/src/catalog/thumbnail-queue.test.ts`
- `packages/core/src/catalog/thumbnail-cache.test.ts`

#### 7.5 E2E tests

- Open folder → scan → display thumbnails
- Flag photos with keyboard
- Filter by flag status
- Permission recovery flow

#### 7.6 Verification

- [ ] Full workflow works end-to-end
- [ ] Demo mode works for E2E
- [ ] All unit tests pass
- [ ] TypeScript compiles without errors
- [ ] ESLint passes

---

## Dependencies Summary

```bash
# packages/core
pnpm add dexie

# apps/web
pnpm add @tanstack/vue-virtual
```

---

## File Organization

```
packages/core/src/catalog/
├── types.ts              # Core types and interfaces
├── db.ts                 # Dexie database schema
├── scan-service.ts       # Folder scanning
├── thumbnail-queue.ts    # Priority queue
├── thumbnail-cache.ts    # LRU + OPFS caching
├── thumbnail-service.ts  # Thumbnail generation
├── catalog-service.ts    # Main service
├── mock-catalog-service.ts
├── types.test.ts
├── thumbnail-queue.test.ts
├── thumbnail-cache.test.ts
└── index.ts              # Public exports

apps/web/app/
├── plugins/
│   └── catalog.client.ts
├── composables/
│   └── useCatalog.ts
├── stores/
│   ├── catalog.ts
│   ├── catalogUI.ts
│   └── selection.ts
└── components/catalog/
    ├── CatalogGrid.vue
    ├── CatalogThumbnail.vue
    ├── FilterBar.vue
    └── PermissionRecovery.vue
```

---

## Verification Checklist

After all phases complete:

- [ ] `pnpm typecheck` passes
- [ ] `pnpm test:unit` passes
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

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Large catalogs slow UI | Virtual scrolling, shallowRef, lazy loading |
| Thumbnail queue explosion | Max queue size (200), priority eviction |
| Memory leaks from Object URLs | Centralized revocation in store actions |
| OPFS browser differences | Fallback to IndexedDB blobs for Firefox |
| Permission state sync across tabs | BroadcastChannel for permission changes |
