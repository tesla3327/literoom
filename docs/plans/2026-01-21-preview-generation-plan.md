# Preview Generation Implementation Plan

**Date**: 2026-01-21
**Issue**: Edit preview uses thumbnail instead of full preview (Critical)
**Research**: `docs/research/2026-01-21-preview-generation-synthesis.md`

## Overview

This plan implements proper preview generation for the edit view. Currently, the edit view uses 512px thumbnails which makes accurate editing decisions impossible. We need to generate 2560px previews (preview1x) for the edit view.

## Phase 1: Extend Asset Interface

**File**: `packages/core/src/catalog/types.ts`

Add preview URL and status fields to Asset interface:

```typescript
export interface Asset {
  // ... existing fields ...

  // Preview 1x (2560px long edge)
  preview1xStatus?: ThumbnailStatus  // Reuse existing ThumbnailStatus enum
  preview1xUrl?: string | null
}
```

**Notes**:
- Reuse existing `ThumbnailStatus` enum ('pending' | 'loading' | 'ready' | 'error')
- Fields are optional for backwards compatibility with existing code
- Skip preview2x for v1 - can be added later

## Phase 2: Create Preview Cache

**File**: `packages/core/src/catalog/thumbnail-cache.ts`

Add `PreviewCache` class following the same pattern as `ThumbnailCache` but with different configuration:

```typescript
export class PreviewCache {
  private memoryCache: LRUCache<string, string>  // assetId -> blob URL
  private opfsDirectory: string = 'previews'  // Separate from thumbnails

  constructor(options: {
    maxMemoryItems?: number  // Default: 20 (vs 150 for thumbnails)
  })

  get(assetId: string): string | null
  set(assetId: string, blob: Blob): Promise<string>  // Returns blob URL
  has(assetId: string): boolean
  loadFromOPFS(assetId: string): Promise<string | null>
  dispose(): void
}
```

**Key Differences from ThumbnailCache**:
- Smaller memory limit (20 vs 150) due to larger image sizes (~20MB decoded)
- Separate OPFS directory (`previews/` vs `thumbnails/`)
- Same blob URL lifecycle management

## Phase 3: Extend ThumbnailService for Preview Generation

**File**: `packages/core/src/catalog/thumbnail-service.ts`

Add preview generation capability to existing service:

```typescript
// Add to ThumbnailServiceConfig
interface ThumbnailServiceConfig {
  // ... existing ...
  previewSize?: number           // Default: 2560
  previewCacheMaxItems?: number  // Default: 20
}

// Add new method
class ThumbnailService {
  private previewCache: PreviewCache
  private previewQueue: PriorityQueue<PreviewRequest>
  private activePreviewGenerations: Map<string, Promise<void>>

  // New method - mirrors requestThumbnail() pattern
  requestPreview(
    assetId: string,
    getImageBytes: () => Promise<Uint8Array>,
    priority: ThumbnailPriority,
    callback: (url: string | null) => void
  ): void {
    // 1. Check memory cache -> callback immediately
    // 2. Check OPFS cache -> callback if found
    // 3. Queue for generation with priority
  }

  private async processPreviewRequest(request: PreviewRequest): Promise<void> {
    // Call decodeService.generatePreview() with maxEdge: 2560
  }
}
```

**Priority Queue**:
- Previews use same priority system as thumbnails
- Edit view requests use priority 0 (highest)
- Preloading uses lower priority

## Phase 4: Update Catalog Store

**File**: `apps/web/app/stores/catalog.ts`

Add preview-related actions:

```typescript
actions: {
  // ... existing ...

  updatePreviewStatus(assetId: string, status: ThumbnailStatus) {
    const asset = this.assets.get(assetId)
    if (asset) {
      this.assets.set(assetId, { ...asset, preview1xStatus: status })
    }
  },

  updatePreviewUrl(assetId: string, url: string | null) {
    const asset = this.assets.get(assetId)
    if (asset) {
      this.assets.set(assetId, { ...asset, preview1xUrl: url })
    }
  }
}
```

## Phase 5: Update Catalog Service

**File**: `packages/core/src/catalog/catalog-service.ts`

Add preview methods and callbacks:

```typescript
class CatalogService {
  // ... existing ...

  // Callback for UI updates
  onPreviewReady?: (assetId: string, url: string) => void

  // Request preview generation
  requestPreview(assetId: string, priority: ThumbnailPriority): void {
    const asset = this.getAsset(assetId)
    if (!asset) return

    this.thumbnailService.requestPreview(
      assetId,
      () => this.loadAssetBytes(assetId),
      priority,
      (url) => {
        if (url && this.onPreviewReady) {
          this.onPreviewReady(assetId, url)
        }
      }
    )
  }
}
```

## Phase 6: Wire Up Plugin

**File**: `apps/web/app/plugins/catalog.client.ts`

Connect preview callbacks:

```typescript
// After existing thumbnail wiring
catalogService.onPreviewReady = (assetId, url) => {
  const catalogStore = useCatalogStore()
  catalogStore.updatePreviewUrl(assetId, url)
}
```

## Phase 7: Update useEditPreview Composable

**File**: `apps/web/app/composables/useEditPreview.ts`

Two changes:

### 1. Prefer preview1x URL over thumbnail

```typescript
const sourceUrl = computed(() => {
  const asset = catalogStore.assets.get(assetId.value)
  // Prefer higher resolution preview, fall back to thumbnail
  return asset?.preview1xUrl ?? asset?.thumbnailUrl ?? null
})
```

### 2. Request preview on mount

```typescript
// In setup
const { $catalogService } = useNuxtApp()

// Watch for asset changes and request preview
watch(assetId, (newId) => {
  if (newId) {
    const asset = catalogStore.assets.get(newId)
    if (asset && !asset.preview1xUrl && asset.preview1xStatus !== 'loading') {
      $catalogService.requestPreview(newId, 0)  // Highest priority
    }
  }
}, { immediate: true })
```

## Phase 8: Update Mock Catalog Service

**File**: `packages/core/src/catalog/mock-catalog-service.ts`

Add mock preview support for demo mode:

```typescript
class MockCatalogService {
  // ... existing ...

  onPreviewReady?: (assetId: string, url: string) => void

  requestPreview(assetId: string, priority: number): void {
    // In demo mode, use the full demo image as preview
    // (already high resolution in demo assets)
    setTimeout(() => {
      const asset = this.assets.get(assetId)
      if (asset && this.onPreviewReady) {
        // Use existing demo image URL as preview
        this.onPreviewReady(assetId, asset.thumbnailUrl!)
      }
    }, 100)  // Simulate async generation
  }
}
```

## File Changes Summary

| Phase | File | Change Type | Description |
|-------|------|-------------|-------------|
| 1 | `packages/core/src/catalog/types.ts` | Modify | Add preview1xUrl/Status to Asset |
| 2 | `packages/core/src/catalog/thumbnail-cache.ts` | Modify | Add PreviewCache class |
| 3 | `packages/core/src/catalog/thumbnail-service.ts` | Modify | Add requestPreview() method |
| 4 | `apps/web/app/stores/catalog.ts` | Modify | Add preview update actions |
| 5 | `packages/core/src/catalog/catalog-service.ts` | Modify | Add requestPreview() method |
| 6 | `apps/web/app/plugins/catalog.client.ts` | Modify | Wire preview callbacks |
| 7 | `apps/web/app/composables/useEditPreview.ts` | Modify | Use preview1x, request on mount |
| 8 | `packages/core/src/catalog/mock-catalog-service.ts` | Modify | Add mock preview support |

## Testing Strategy

### Unit Tests
- Preview cache get/set/dispose
- Preview request queuing and prioritization
- Asset interface with preview fields

### Integration Tests
- Preview generation flow (real decode service)
- Cache persistence via OPFS

### Manual Testing
1. Open demo mode
2. Navigate to edit view
3. Verify preview loads (higher resolution than thumbnail)
4. Navigate between images - verify preview requests
5. Reload page - verify preview loads from cache

## Success Criteria

1. Edit view displays 2560px preview instead of 512px thumbnail
2. Preview uses progressive loading (thumbnail shown while preview generates)
3. Previews are cached in OPFS for instant reload
4. Memory usage stays reasonable (max ~400MB for 20 previews)
5. Demo mode works with mock preview service
6. No regression in existing thumbnail functionality

## Estimated Implementation Order

Implement in order (each phase builds on previous):
1. Phase 1 (types) - Foundation
2. Phase 2 (cache) - Storage
3. Phase 3 (service) - Core logic
4. Phase 4 (store) - State management
5. Phase 5 (catalog) - Integration
6. Phase 6 (plugin) - Wiring
7. Phase 7 (composable) - UI integration
8. Phase 8 (mock) - Demo mode

## Notes

- Skip preview2x for v1 - the infrastructure supports it but adds complexity
- Use Lanczos3 filter for highest quality resizing (already supported in decode service)
- Consider lazy preview generation - only generate when entering edit view
- Future enhancement: preload previews for adjacent images in filmstrip
