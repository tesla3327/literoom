# Research: IndexedDB/OPFS Architecture for Catalog Persistence (Area 1)

**Date**: 2026-01-20
**Focus Area**: Storage architecture for photo catalog persistence
**Related**: Catalog Service Research Plan - Area 1

---

## Executive Summary

For Literoom's photo catalog, the recommended architecture is:

1. **Dexie.js** for IndexedDB wrapper - provides excellent TypeScript support, simple schema migrations, and compound index queries essential for filtered views
2. **IndexedDB for metadata**, **OPFS for binary blobs** (thumbnails/previews) - IndexedDB excels at structured queries while OPFS offers 2-4x better performance for large binary files
3. **Compound indexes** for efficient filtering (flag + date) and sorting
4. **Version-based migrations** with Dexie's built-in upgrade system

This hybrid approach balances query performance for metadata with raw throughput for image data.

---

## 1. IndexedDB Schema Design

### 1.1 Recommended Schema Structure

```typescript
// Dexie schema definition
const db = new Dexie('LiteroomCatalog');

db.version(1).stores({
  // Core asset metadata
  assets: '++id, folderId, path, filename, extension, flag, captureDate, modifiedDate, [flag+captureDate], [folderId+captureDate]',

  // Folder handles and metadata
  folders: '++id, &path, name, lastScanDate',

  // Edit settings (JSON, versioned per-asset)
  edits: '&assetId, schemaVersion, updatedAt',

  // Cache metadata (thumbnails/previews stored in OPFS)
  cacheMetadata: '&assetId, thumbnailReady, preview1xReady, preview2xReady, thumbnailPath, preview1xPath, preview2xPath',

  // UI preferences (singleton store)
  preferences: 'key'
});
```

### 1.2 Asset Table Design

```typescript
interface Asset {
  id?: number;              // Auto-increment primary key
  folderId: number;         // Foreign key to folders
  path: string;             // Full relative path from folder root
  filename: string;         // Filename without extension
  extension: string;        // 'arw', 'jpg', 'jpeg'
  flag: 'none' | 'pick' | 'reject';  // Culling state
  captureDate: Date;        // EXIF capture timestamp
  modifiedDate: Date;       // File modification date
  fileSize: number;         // Bytes
  width?: number;           // Image dimensions (from EXIF or decode)
  height?: number;
  exifData?: ExifMetadata;  // Parsed EXIF as JSON
  fileHash?: string;        // Optional content hash for change detection
}
```

### 1.3 Index Strategy

| Index | Purpose | Query Pattern |
|-------|---------|---------------|
| `id` | Primary key lookup | `assets.get(id)` |
| `path` | Unique file lookup | `assets.where('path').equals(path)` |
| `flag` | Filter by flag state | `assets.where('flag').equals('pick')` |
| `captureDate` | Sort by date | `assets.orderBy('captureDate')` |
| `[flag+captureDate]` | **Compound** - Filter + Sort | `assets.where('[flag+captureDate]').between([flag, minDate], [flag, maxDate])` |
| `[folderId+captureDate]` | **Compound** - Folder + Sort | Filter by folder with date ordering |

**Key Insight**: Compound indexes are essential for filtered sorted views. Without `[flag+captureDate]`, filtering picks then sorting would require loading all picks into memory.

### 1.4 Edit Settings Schema

```typescript
interface EditSettings {
  assetId: number;          // Primary key (1:1 with asset)
  schemaVersion: number;    // For migrations (start at 1)
  updatedAt: Date;

  // Basic adjustments
  basic: {
    temperature: number;    // -100 to 100 (default 0)
    tint: number;
    exposure: number;
    contrast: number;
    highlights: number;
    shadows: number;
    whites: number;
    blacks: number;
    vibrance: number;
    saturation: number;
  };

  // Tone curve
  toneCurve: {
    points: Array<{ x: number; y: number }>;
  };

  // Crop/transform
  crop: {
    enabled: boolean;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;       // Degrees
    aspectLock: boolean;
    aspectRatio?: string;   // '16:9', '4:3', etc.
  };

  // Masks
  masks: Array<LinearMask | RadialMask>;
}
```

---

## 2. OPFS vs IndexedDB for Binary Blob Storage

### 2.1 Performance Comparison

| Metric | IndexedDB | OPFS (Worker + SyncAccessHandle) |
|--------|-----------|----------------------------------|
| **Write Speed** | Baseline | 2-4x faster |
| **Read Speed** | Baseline | 2-3x faster |
| **Large Files (>100KB)** | Slower due to serialization | Significantly faster |
| **Transaction Overhead** | High per-operation | Low (file-like access) |
| **Concurrent Tab Access** | Supported | **Limited** (exclusive locks) |

**Key Finding**: OPFS with `createSyncAccessHandle()` in a Web Worker is dramatically faster for large binary files, but requires exclusive file locks.

### 2.2 Recommendation: Hybrid Architecture

```
+------------------+     +------------------+
|    IndexedDB     |     |      OPFS        |
|  (via Dexie.js)  |     |  (Binary Files)  |
+------------------+     +------------------+
|                  |     |                  |
| - Asset metadata |     | - thumbnails/    |
| - Edit settings  |     |   {assetId}.jpg  |
| - Folder handles |     | - previews/      |
| - Cache metadata |     |   {assetId}_1x.jpg |
| - Preferences    |     |   {assetId}_2x.jpg |
|                  |     |                  |
+------------------+     +------------------+
```

**Rationale**:
1. **Thumbnails (~50KB)** and **Previews (~500KB)** are large binary blobs - OPFS excels here
2. **Metadata queries** (filtering picks, sorting by date) require IndexedDB indexes
3. **Cache metadata** in IndexedDB tracks which OPFS files exist
4. **No multi-tab conflict** since Literoom targets single-tab desktop workflow

### 2.3 OPFS Directory Structure

```
/literoom/
  /thumbnails/
    {assetId}.jpg           # 256px thumbnails
  /previews/
    {assetId}_1x.jpg        # 2560px previews
    {assetId}_2x.jpg        # 5120px previews (optional)
  /temp/
    # Working files during generation
```

### 2.4 OPFS Access Pattern

```typescript
// From a Web Worker (required for SyncAccessHandle)
class OPFSCacheWorker {
  private root: FileSystemDirectoryHandle | null = null;

  async init() {
    this.root = await navigator.storage.getDirectory();
    // Ensure directory structure
    await this.root.getDirectoryHandle('thumbnails', { create: true });
    await this.root.getDirectoryHandle('previews', { create: true });
  }

  async writeThumbnail(assetId: number, data: Uint8Array): Promise<void> {
    const dir = await this.root!.getDirectoryHandle('thumbnails');
    const file = await dir.getFileHandle(`${assetId}.jpg`, { create: true });

    // SyncAccessHandle for best performance (Worker only)
    const handle = await file.createSyncAccessHandle();
    try {
      handle.write(data);
      handle.flush();
    } finally {
      handle.close();
    }
  }

  async readThumbnail(assetId: number): Promise<Uint8Array | null> {
    try {
      const dir = await this.root!.getDirectoryHandle('thumbnails');
      const file = await dir.getFileHandle(`${assetId}.jpg`);
      const handle = await file.createSyncAccessHandle();
      try {
        const size = handle.getSize();
        const buffer = new Uint8Array(size);
        handle.read(buffer);
        return buffer;
      } finally {
        handle.close();
      }
    } catch {
      return null; // File doesn't exist
    }
  }
}
```

### 2.5 Browser Support

| Feature | Chrome | Firefox | Safari |
|---------|--------|---------|--------|
| IndexedDB | Full | Full | Full |
| OPFS | Full | **Partial** (no SyncAccessHandle) | Full |
| SyncAccessHandle | Full | No | Full |

**Mitigation for Firefox**: Fall back to async OPFS methods or IndexedDB blob storage. Given Literoom's Chromium-first target, this is acceptable.

---

## 3. Library Evaluation

### 3.1 Comparison Matrix

| Feature | Raw IndexedDB | idb-keyval | Dexie.js |
|---------|--------------|------------|----------|
| **Learning Curve** | High | Very Low | Medium |
| **TypeScript Support** | Manual | Basic | Excellent |
| **Compound Indexes** | Manual | No | Yes |
| **Schema Migrations** | Manual | No | Built-in |
| **Query Builder** | No | No | Yes |
| **Bundle Size** | 0KB | ~1KB | ~45KB |
| **Transactions** | Manual | Auto | Auto |
| **Reactive Queries** | No | No | liveQuery() |

### 3.2 Recommendation: Dexie.js

**Strong Reasons for Dexie**:

1. **Compound Index Support** - Essential for filtered/sorted views:
   ```typescript
   // Get all picks sorted by date
   db.assets
     .where('[flag+captureDate]')
     .between(['pick', Dexie.minKey], ['pick', Dexie.maxKey])
     .toArray();
   ```

2. **Built-in Migrations** - Critical for catalog versioning:
   ```typescript
   db.version(1).stores({
     assets: '++id, path, flag, captureDate'
   });

   db.version(2).stores({
     assets: '++id, path, flag, captureDate, [flag+captureDate]'
   }).upgrade(tx => {
     // Migration logic runs automatically
   });
   ```

3. **TypeScript-First API**:
   ```typescript
   const db = new Dexie('LiteroomCatalog') as Dexie & {
     assets: Table<Asset, number>;
     edits: Table<EditSettings, number>;
   };
   ```

4. **liveQuery for Vue Integration**:
   ```typescript
   // Reactive query that updates when data changes
   const picks = liveQuery(() =>
     db.assets.where('flag').equals('pick').toArray()
   );
   ```

**When NOT to use Dexie**:
- Simple key-value storage (use idb-keyval)
- Extreme bundle size constraints (<10KB total)
- Need for raw IDB features (e.g., advanced cursors)

### 3.3 idb-keyval Use Case

Use for simple singleton stores like preferences:

```typescript
import { get, set } from 'idb-keyval';

// UI preferences (no complex queries needed)
await set('gridSize', 'medium');
const gridSize = await get('gridSize');
```

**Recommendation**: Use idb-keyval only for the preferences store to minimize complexity. Use Dexie for everything else.

---

## 4. Query Patterns for Filtered Views

### 4.1 Core Query Requirements

| View | Filter | Sort | Index Needed |
|------|--------|------|--------------|
| All Assets | None | captureDate DESC | `captureDate` |
| Picks | flag = 'pick' | captureDate DESC | `[flag+captureDate]` |
| Rejects | flag = 'reject' | captureDate DESC | `[flag+captureDate]` |
| Unflagged | flag = 'none' | captureDate DESC | `[flag+captureDate]` |
| By Name | None | filename ASC | `filename` |
| Folder View | folderId = X | captureDate DESC | `[folderId+captureDate]` |

### 4.2 Dexie Query Examples

```typescript
// All assets sorted by date (newest first)
const allAssets = await db.assets
  .orderBy('captureDate')
  .reverse()
  .toArray();

// Picks only, sorted by date
const picks = await db.assets
  .where('[flag+captureDate]')
  .between(['pick', Dexie.minKey], ['pick', Dexie.maxKey])
  .reverse()
  .toArray();

// Paginated query (virtual scrolling support)
const pageSize = 100;
const page = await db.assets
  .where('[flag+captureDate]')
  .between(['pick', Dexie.minKey], ['pick', Dexie.maxKey])
  .reverse()
  .offset(pageIndex * pageSize)
  .limit(pageSize)
  .toArray();

// Sort by filename (secondary sort)
const byName = await db.assets
  .where('flag').equals('pick')
  .sortBy('filename');
```

### 4.3 Efficient Count Queries

```typescript
// Fast counts using indexes
const pickCount = await db.assets
  .where('flag').equals('pick')
  .count();

const rejectCount = await db.assets
  .where('flag').equals('reject')
  .count();

const unflaggedCount = await db.assets
  .where('flag').equals('none')
  .count();
```

### 4.4 Compound Index Ordering Note

**Important**: The order of fields in compound indexes matters.

```typescript
// Index: [flag+captureDate]
// Can query: flag only, OR flag + date range
// Cannot query: date only (must add separate captureDate index)

// This works (uses compound index):
db.assets.where('[flag+captureDate]')
  .between(['pick', new Date(2024, 0, 1)], ['pick', new Date(2024, 11, 31)])

// This does NOT use the compound index (needs separate index):
db.assets.where('captureDate')
  .above(new Date(2024, 0, 1))
```

---

## 5. Schema Migrations

### 5.1 Dexie Version Management

```typescript
const db = new Dexie('LiteroomCatalog');

// Version 1: Initial schema
db.version(1).stores({
  assets: '++id, path, flag, captureDate',
  folders: '++id, &path',
  edits: '&assetId',
  preferences: 'key'
});

// Version 2: Add compound index for filtered views
db.version(2).stores({
  assets: '++id, path, flag, captureDate, [flag+captureDate]',
  folders: '++id, &path',
  edits: '&assetId',
  preferences: 'key'
});

// Version 3: Add filename for sorting, folder compound index
db.version(3).stores({
  assets: '++id, path, flag, captureDate, filename, [flag+captureDate], [folderId+captureDate]',
  folders: '++id, &path, lastScanDate',
  edits: '&assetId, schemaVersion',
  preferences: 'key'
});
```

### 5.2 Data Migration Example

```typescript
db.version(3).stores({
  // ... schema
}).upgrade(async (tx) => {
  // Migrate edit settings to new schema version
  const edits = await tx.table('edits').toArray();

  for (const edit of edits) {
    if (edit.schemaVersion < 2) {
      // Add new fields with defaults
      await tx.table('edits').update(edit.assetId, {
        schemaVersion: 2,
        crop: edit.crop ?? { enabled: false, x: 0, y: 0, width: 1, height: 1, rotation: 0 }
      });
    }
  }
});
```

### 5.3 Migration Best Practices

1. **Never delete stores in production** - mark as deprecated instead
2. **Add default values** for new required fields
3. **Use schemaVersion field** in edit settings for granular migrations
4. **Test migrations** with realistic data volumes
5. **Handle blocked upgrades** (other tabs have DB open):
   ```typescript
   db.on('blocked', () => {
     alert('Please close other tabs to upgrade the catalog.');
   });
   ```

### 5.4 Edit Settings Versioning

Separate from IndexedDB schema versioning, track edit settings format:

```typescript
const CURRENT_EDIT_SCHEMA_VERSION = 2;

function migrateEditSettings(edit: EditSettings): EditSettings {
  if (edit.schemaVersion === CURRENT_EDIT_SCHEMA_VERSION) {
    return edit;
  }

  // Version 1 -> 2: Add masks array
  if (edit.schemaVersion < 2) {
    edit = {
      ...edit,
      masks: edit.masks ?? [],
      schemaVersion: 2
    };
  }

  return edit;
}
```

---

## 6. Performance Best Practices for Large Catalogs

### 6.1 Transaction Batching

```typescript
// BAD: One transaction per asset (slow)
for (const asset of assets) {
  await db.assets.put(asset);
}

// GOOD: Bulk operations (fast)
await db.assets.bulkPut(assets);
```

**Rule**: Batch writes whenever possible. Each transaction has ~2ms overhead in Chrome.

### 6.2 Virtual Scrolling Integration

For catalogs with 1000s of assets:

```typescript
// Don't load all assets into memory
// Use pagination that matches virtual scroll viewport

class VirtualAssetList {
  private pageSize = 100;
  private cache = new Map<number, Asset[]>();

  async getPage(pageIndex: number, filter: AssetFilter): Promise<Asset[]> {
    const cacheKey = `${filter.flag}-${filter.sort}-${pageIndex}`;

    if (!this.cache.has(pageIndex)) {
      const assets = await db.assets
        .where('[flag+captureDate]')
        .between([filter.flag, Dexie.minKey], [filter.flag, Dexie.maxKey])
        .reverse()
        .offset(pageIndex * this.pageSize)
        .limit(this.pageSize)
        .toArray();

      this.cache.set(pageIndex, assets);
    }

    return this.cache.get(pageIndex)!;
  }

  invalidateCache() {
    this.cache.clear();
  }
}
```

### 6.3 Relaxed Durability for Import

During folder import (many writes), use relaxed durability:

```typescript
// Chromium-only optimization
await db.transaction('rw', { durability: 'relaxed' }, db.assets, async () => {
  await db.assets.bulkPut(newAssets);
});
```

**Tradeoff**: Data might be lost if browser crashes mid-import. Acceptable for initial import since user can rescan.

### 6.4 Background OPFS Operations

Move all OPFS reads/writes to a dedicated worker:

```typescript
// main thread
const cacheWorker = new Worker('./cache.worker.ts', { type: 'module' });

// Request thumbnail
cacheWorker.postMessage({
  type: 'read-thumbnail',
  assetId: 123
});

// Worker handles OPFS I/O without blocking UI
cacheWorker.onmessage = (e) => {
  if (e.data.type === 'thumbnail-ready') {
    displayThumbnail(e.data.assetId, e.data.data);
  }
};
```

### 6.5 Memory Management

```typescript
// For large catalogs, don't keep all assets in Vue reactive state
// Use computed properties that query on-demand

const visibleAssetIds = computed(() => {
  // Only IDs for virtual scroll
  return allAssetIds.value.slice(startIndex.value, endIndex.value);
});

// Load full asset data only when needed
const visibleAssets = computed(() => {
  return visibleAssetIds.value.map(id => assetCache.get(id));
});
```

### 6.6 Startup Performance

```typescript
// Fast catalog open sequence
async function openCatalog(): Promise<CatalogStats> {
  // 1. Quick count query (uses indexes, fast)
  const counts = await db.transaction('r', db.assets, async () => ({
    total: await db.assets.count(),
    picks: await db.assets.where('flag').equals('pick').count(),
    rejects: await db.assets.where('flag').equals('reject').count()
  }));

  // 2. Load first page only (for virtual scroll initial render)
  const firstPage = await db.assets
    .orderBy('captureDate')
    .reverse()
    .limit(100)
    .toArray();

  return { counts, firstPage };
}
```

---

## 7. Recommended Architecture Summary

### 7.1 Storage Layers

```
+-------------------------------------------------------------+
|                      Application Layer                       |
+-------------------------------------------------------------+
           |                                   |
           v                                   v
+---------------------+           +------------------------+
|   CatalogService    |           |    CacheService        |
|   (Dexie.js)        |           |    (OPFS Worker)       |
+---------------------+           +------------------------+
           |                                   |
           v                                   v
+---------------------+           +------------------------+
|     IndexedDB       |           |         OPFS           |
| - assets            |           | - thumbnails/          |
| - folders           |           | - previews/            |
| - edits             |           |                        |
| - cacheMetadata     |           |                        |
+---------------------+           +------------------------+
```

### 7.2 Technology Choices

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Metadata Storage | Dexie.js (IndexedDB) | Compound indexes, TypeScript, migrations |
| Binary Storage | OPFS via Worker | 2-4x faster for thumbnails/previews |
| Preferences | idb-keyval | Simple key-value, minimal overhead |
| Queries | Dexie Query Builder | Type-safe, index-aware |
| Migrations | Dexie.version() | Built-in, sequential |

### 7.3 Final Schema

```typescript
import Dexie, { Table } from 'dexie';

interface Asset {
  id?: number;
  folderId: number;
  path: string;
  filename: string;
  extension: string;
  flag: 'none' | 'pick' | 'reject';
  captureDate: Date;
  modifiedDate: Date;
  fileSize: number;
  width?: number;
  height?: number;
}

interface Folder {
  id?: number;
  path: string;
  name: string;
  handleId: string;  // Serialized FileSystemDirectoryHandle
  lastScanDate: Date;
}

interface EditSettings {
  assetId: number;
  schemaVersion: number;
  updatedAt: Date;
  basic: BasicAdjustments;
  toneCurve: ToneCurve;
  crop: CropSettings;
  masks: Mask[];
}

interface CacheMetadata {
  assetId: number;
  thumbnailReady: boolean;
  preview1xReady: boolean;
  preview2xReady: boolean;
}

class LiteroomDB extends Dexie {
  assets!: Table<Asset, number>;
  folders!: Table<Folder, number>;
  edits!: Table<EditSettings, number>;
  cacheMetadata!: Table<CacheMetadata, number>;

  constructor() {
    super('LiteroomCatalog');

    this.version(1).stores({
      assets: '++id, folderId, path, filename, flag, captureDate, [flag+captureDate], [folderId+captureDate]',
      folders: '++id, &path',
      edits: '&assetId, schemaVersion',
      cacheMetadata: '&assetId'
    });
  }
}

export const db = new LiteroomDB();
```

---

## 8. Action Items for Implementation

1. **Install Dependencies**:
   ```bash
   pnpm add dexie idb-keyval
   ```

2. **Create Database Module**: `packages/core/src/catalog/db.ts`

3. **Create OPFS Cache Worker**: `packages/core/src/catalog/cache.worker.ts`

4. **Define TypeScript Interfaces**: `packages/core/src/catalog/types.ts`

5. **Implement CatalogService**: Wraps Dexie DB with business logic

6. **Implement CacheService**: Manages OPFS worker communication

7. **Add Firefox Fallback**: IndexedDB blob storage when OPFS unavailable

---

## Sources

- [MDN - Using IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API/Using_IndexedDB)
- [JavaScript.info - IndexedDB](https://javascript.info/indexeddb)
- [LogRocket - Offline-first frontend apps in 2025](https://blog.logrocket.com/offline-first-frontend-apps-2025-indexeddb-sqlite/)
- [RxDB - LocalStorage vs IndexedDB vs OPFS](https://rxdb.info/articles/localstorage-indexeddb-cookies-opfs-sqlite-wasm.html)
- [RxDB - Solving IndexedDB Slowness](https://rxdb.info/slow-indexeddb.html)
- [RxDB - OPFS Database Performance](https://rxdb.info/rx-storage-opfs.html)
- [Autodesk - OPFS Caching Performance](https://aps.autodesk.com/blog/viewer-performance-update-part-2-3-opfs-caching)
- [web.dev - Origin Private File System](https://web.dev/articles/origin-private-file-system)
- [Dexie.js Documentation](https://dexie.org/)
- [Dexie.js - Compound Index](https://dexie.org/docs/Compound-Index)
- [Dexie.js - Version Upgrades](https://dexie.org/docs/Version/Version.upgrade())
- [npm-compare - idb vs dexie](https://npm-compare.com/dexie,idb)
- [DEV Community - IndexedDB Upgrade Version Conflict](https://dev.to/ivandotv/handling-indexeddb-upgrade-version-conflict-368a)
- [Nolan Lawson - Speeding up IndexedDB reads and writes](https://nolanlawson.com/2021/08/22/speeding-up-indexeddb-reads-and-writes/)
- [Medium - IndexedDB Pagination](https://gautampanickarss.medium.com/tech-applying-pagination-in-indexeddb-data-read-ce5bdaa73fb)
