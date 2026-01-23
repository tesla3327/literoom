# Preview Generation Research Synthesis

**Date**: 2026-01-21
**Status**: Complete
**Issue**: Edit preview uses thumbnail instead of full preview (Critical)

## Executive Summary

The current implementation uses 512px thumbnails as the edit preview source, making accurate editing decisions impossible. The system needs to generate proper 2560px (1x) and 5120px (2x) previews per the spec (section 2.3).

**Key Finding**: The infrastructure is 90% ready - the decode service, worker pool, caching system, and database schema already support preview generation. Only a few components need updating:
1. Asset type needs preview URL fields
2. ThumbnailService needs extension for preview generation
3. useEditPreview needs to prefer preview1x over thumbnail

## Current Architecture Analysis

### 1. Thumbnail Generation Pipeline

**Current Flow**:
```
Component Mount → requestThumbnail() → Check Cache (Memory + OPFS)
  ├─ Cache Hit → invoke callback immediately with URL
  └─ Cache Miss → Priority Queue → Process → DecodeService.generateThumbnail()
      → decodedImageToBlob() → Cache (Memory + OPFS) → invoke callback
```

**Key Components**:
- **ThumbnailService** (`packages/core/src/catalog/thumbnail-service.ts`)
  - Configurable: size=512px, queue=200, cache=150, concurrency=hardwareConcurrency
  - Concurrent processing with load balancing
  - Priority queue (VISIBLE > NEAR_VISIBLE > PRELOAD > BACKGROUND)

- **ThumbnailCache** (`packages/core/src/catalog/thumbnail-cache.ts`)
  - Two-tier: Memory LRU (150 items) + OPFS (persistent)
  - Fire-and-forget OPFS writes
  - Object URL lifecycle management

- **DecodeService** (`packages/core/src/decode/decode-service.ts`)
  - `generateThumbnail(bytes, {size: 512})` - returns RGB pixels
  - `generatePreview(bytes, {maxEdge, filter})` - **already exists**
  - Uses Web Worker with WASM backend
  - Can be pooled for parallel processing

### 2. Edit Preview Composable

**Current Implementation** (`apps/web/app/composables/useEditPreview.ts`):
```typescript
const sourceUrl = computed(() => {
  const asset = catalogStore.assets.get(assetId.value)
  // TODO: Use preview1x when available, fall back to thumbnail
  return asset?.thumbnailUrl ?? null
})
```

**Key Observations**:
- Already has a TODO comment for preview1x support
- Pipeline is format-agnostic (works with any image size)
- Stale render protection with generation counter
- Blob URL ownership tracking prevents conflicts
- Debounced rendering (300ms) during slider drag

### 3. Database Schema

**Ready for previews** (`packages/core/src/catalog/db.ts`):
```typescript
export interface CacheMetadataRecord {
  assetId: number
  thumbnailReady: boolean
  preview1xReady: boolean  // Already exists!
  preview2xReady: boolean  // Already exists!
}
```

### 4. Asset Interface

**Missing preview fields** (`packages/core/src/catalog/types.ts`):
```typescript
export interface Asset {
  thumbnailStatus: ThumbnailStatus
  thumbnailUrl: string | null
  // Missing: preview1xUrl, preview1xStatus, preview2xUrl, preview2xStatus
}
```

## What's Ready

1. **DecodeService.generatePreview()** - Already exists with maxEdge and filter options
2. **Database schema** - Already tracks preview1xReady/preview2xReady
3. **OPFS caching** - Extensible to separate previews/ directory
4. **Priority queue** - Can be reused for preview requests
5. **Worker pool** - Supports parallel preview generation
6. **useEditPreview pipeline** - Works with any pixel dimensions
7. **Blob URL management** - Ownership tracking ready

## What Needs Implementation

### Phase 1: Data Layer (Asset Interface)
**File**: `packages/core/src/catalog/types.ts`

Add to Asset interface:
```typescript
export interface Asset {
  // ... existing ...
  preview1xStatus?: ThumbnailStatus
  preview1xUrl?: string | null
  preview2xStatus?: ThumbnailStatus
  preview2xUrl?: string | null
}
```

### Phase 2: Extend ThumbnailService for Previews
**File**: `packages/core/src/catalog/thumbnail-service.ts`

Options:
- **Option A**: Extend ThumbnailService to handle both thumbnails and previews
- **Option B**: Create separate PreviewService with same patterns

Recommended: **Option A** - extend existing service:
- Add `requestPreview(assetId, getBytes, priority, density: '1x' | '2x')` method
- Separate queue for previews (lower priority than thumbnails)
- Separate OPFS directory (`previews/` vs `thumbnails/`)
- Smaller memory cache for previews (20 items vs 150)

### Phase 3: Catalog Store Updates
**File**: `apps/web/app/stores/catalog.ts`

Add actions:
- `updatePreview(assetId, density, status, url)`

### Phase 4: Catalog Service Integration
**File**: `packages/core/src/catalog/catalog-service.ts`

Add methods:
- `requestPreview(assetId, priority, density)`
- Wire up `onPreviewReady` callback

### Phase 5: useEditPreview Update
**File**: `apps/web/app/composables/useEditPreview.ts`

Update sourceUrl computed:
```typescript
const sourceUrl = computed(() => {
  const asset = catalogStore.assets.get(assetId.value)
  // Prefer higher quality, fall back to thumbnail
  return asset?.preview1xUrl ?? asset?.thumbnailUrl ?? null
})
```

Add preview request on mount:
```typescript
onMounted(() => {
  if (asset && !asset.preview1xUrl) {
    catalog.requestPreview(assetId.value, 0, '1x')
  }
})
```

### Phase 6: Plugin Wiring
**File**: `apps/web/app/plugins/catalog.client.ts`

Connect preview callbacks:
```typescript
catalogService.onPreviewReady = (assetId, url, density) => {
  catalogStore.updatePreview(assetId, density, 'ready', url)
}
```

## Memory and Performance Considerations

### Preview Sizes
- **Thumbnail**: 512px → ~50KB JPEG, ~0.75MB decoded
- **Preview 1x**: 2560px → ~500KB JPEG, ~20MB decoded
- **Preview 2x**: 5120px → ~2MB JPEG, ~80MB decoded

### Cache Sizing
- **Memory**: 20 previews × 20MB = 400MB max (adjust based on device)
- **OPFS**: Unlimited (browser storage quota, typically 10-20% of disk)

### Processing Time
- Thumbnail generation: ~100-200ms
- Preview 1x generation: ~500-800ms
- Preview 2x generation: ~1-2s

### Progressive Loading Strategy
1. **Immediate**: Show thumbnail as placeholder
2. **Priority 1**: Generate and display preview1x (~500ms)
3. **Background**: Generate preview2x for future zoom (optional in v1)

## Recommended Implementation Approach

### Minimal Viable Implementation (Recommended for v1)

Focus on preview1x only, skip preview2x for now:

1. **Extend Asset interface** with preview1xUrl/preview1xStatus
2. **Create PreviewCache class** - same pattern as ThumbnailCache but:
   - OPFS directory: `previews/`
   - Memory limit: 20 items
3. **Extend ThumbnailService** with `requestPreview()` method
4. **Update useEditPreview** to prefer preview1x URL
5. **Auto-request preview** when entering edit view

### File Changes Summary

| File | Change |
|------|--------|
| `packages/core/src/catalog/types.ts` | Add preview URL/status fields to Asset |
| `packages/core/src/catalog/thumbnail-cache.ts` | Add PreviewCache class |
| `packages/core/src/catalog/thumbnail-service.ts` | Add requestPreview() method |
| `packages/core/src/catalog/catalog-service.ts` | Wire preview service |
| `apps/web/app/stores/catalog.ts` | Add updatePreview action |
| `apps/web/app/plugins/catalog.client.ts` | Wire preview callbacks |
| `apps/web/app/composables/useEditPreview.ts` | Use preview1xUrl, request on mount |

## Alternative: Simple Approach (Even Simpler)

Instead of full preview infrastructure, could:
1. Keep using thumbnail system but increase size to 2560px
2. Modify ThumbnailService defaults: `thumbnailSize: 2560`
3. All existing code continues to work

**Pros**: Zero new code, immediate fix
**Cons**: Larger thumbnails slow down grid view, more memory for all images

**Recommendation**: Implement separate preview service for proper separation of concerns.

## Conclusion

The codebase is well-architected for this feature. The key insight is that 90% of the infrastructure already exists - we just need to:
1. Add preview fields to Asset type
2. Extend ThumbnailService for preview generation
3. Update useEditPreview to use previews

Estimated implementation time: 4-6 hours for core functionality.
