# Thumbnail Regeneration Implementation Plan

**Date**: 2026-01-22
**Research**: `docs/research/2026-01-22-thumbnail-regeneration-synthesis.md`
**Issue**: Gallery thumbnails don't reflect edits made in edit view

## Overview

When a user edits a photo and returns to the gallery, the thumbnail should display the edited version, not the original. This plan outlines the implementation of thumbnail regeneration after edits.

## Architecture

```
[Edit View Exit]
     ↓
[Check if asset has modifications]
     ↓ (if yes)
[Invalidate old thumbnail in both caches]
     ↓
[Queue regeneration with BACKGROUND priority]
     ↓
[Worker: Decode → Apply Edits → Resize → Encode]
     ↓
[Cache new thumbnail]
     ↓
[Update UI via existing callback]
```

## Implementation Phases

### Phase 1: Worker Message Type (30 min)
**Status**: ✅ Complete

Add new worker message type for generating edited thumbnails.

**File**: `packages/core/src/decode/worker-messages.ts`

```typescript
export interface GenerateEditedThumbnailRequest {
  id: string
  type: 'generate-edited-thumbnail'
  bytes: Uint8Array
  size: number
  editState: ExportEditState
}

// Update WorkerRequest union type
export type WorkerRequest =
  | DecodeJpegRequest
  | DecodeRawThumbnailRequest
  | // ... existing types
  | GenerateEditedThumbnailRequest
```

**Tests**: Add type tests to verify discriminated union works correctly.

---

### Phase 2: Worker Handler (1 hr)
**Status**: ✅ Complete

Implement the edit pipeline in the decode worker.

**File**: `packages/core/src/decode/decode-worker.ts`

Add handler for `generate-edited-thumbnail` that:
1. Decodes the image
2. Applies rotation (if any)
3. Applies crop (if any)
4. Applies basic adjustments
5. Applies tone curve
6. Applies masked adjustments
7. Resizes to target size (512px)
8. Encodes as JPEG

**Order of Operations** (same as export):
```typescript
async function handleGenerateEditedThumbnail(request: GenerateEditedThumbnailRequest) {
  // 1. Decode
  let pixels = decodeJpeg(request.bytes)
  const { width, height } = pixels

  // 2. Apply rotation
  if (request.editState.rotation) {
    pixels = applyRotation(pixels, request.editState.rotation)
  }

  // 3. Apply crop
  if (request.editState.crop) {
    pixels = applyCrop(pixels, request.editState.crop)
  }

  // 4. Apply adjustments
  if (request.editState.adjustments) {
    pixels = applyAdjustments(pixels, request.editState.adjustments)
  }

  // 5. Apply tone curve
  if (request.editState.toneCurvePoints?.length > 0) {
    pixels = applyToneCurve(pixels, request.editState.toneCurvePoints)
  }

  // 6. Apply masked adjustments
  if (request.editState.masks?.length > 0) {
    pixels = applyMaskedAdjustments(pixels, request.editState.masks)
  }

  // 7. Resize
  const resized = resizeImage(pixels, request.size, request.size, 'cover')

  // 8. Encode
  const jpeg = encodeJpeg(resized.pixels, resized.width, resized.height, 85)

  return { jpegData: jpeg }
}
```

**Tests**: Unit tests with mock pixel data to verify edit pipeline order.

---

### Phase 3: DecodeService Method (30 min)
**Status**: ✅ Complete

Add `generateEditedThumbnail()` method to DecodeService.

**File**: `packages/core/src/decode/decode-service.ts`

```typescript
async generateEditedThumbnail(
  bytes: Uint8Array,
  size: number,
  editState: ExportEditState
): Promise<Uint8Array> {
  const response = await this.sendRequest({
    type: 'generate-edited-thumbnail',
    bytes,
    size,
    editState,
  })
  return response.jpegData
}
```

**Also update**:
- `IDecodeService` interface
- `MockDecodeService` implementation

---

### Phase 4: ThumbnailService Integration (1 hr)
**Status**: ✅ Complete

Add regeneration methods to ThumbnailService.

**File**: `packages/core/src/catalog/thumbnail-service.ts`

#### 4.1: Add generation tracking
```typescript
private generationNumbers = new Map<string, number>()
```

#### 4.2: Add invalidation method
```typescript
async invalidateThumbnail(assetId: string): Promise<void> {
  // Increment generation number
  const gen = (this.generationNumbers.get(assetId) ?? 0) + 1
  this.generationNumbers.set(assetId, gen)

  // Cancel any in-flight requests
  this.queue.remove(assetId)
  this.activeRequests.delete(assetId)

  // Delete from both caches
  this.cache.delete(assetId)  // Memory cache - revokes Object URL
  await this.opfsCache.delete(assetId)  // Persistent cache
}
```

#### 4.3: Add regeneration method
```typescript
async regenerateThumbnail(
  assetId: string,
  getBytes: () => Promise<Uint8Array>,
  editState: ExportEditState,
  priority: ThumbnailPriority = ThumbnailPriority.BACKGROUND
): Promise<void> {
  const generation = this.generationNumbers.get(assetId) ?? 0

  // Invalidate existing thumbnail
  await this.invalidateThumbnail(assetId)

  // Queue regeneration
  this.queue.add({
    assetId,
    priority,
    getBytes,
    editState,
    generation: generation + 1,
  })

  this.processQueue()
}
```

#### 4.4: Modify processItem to handle edits
```typescript
private async processItem(item: QueueItem): Promise<void> {
  const bytes = await item.getBytes()

  let jpegData: Uint8Array
  if (item.editState) {
    // Generate edited thumbnail
    jpegData = await this.decodeService.generateEditedThumbnail(
      bytes,
      this.thumbnailSize,
      item.editState
    )
  } else {
    // Generate original thumbnail (existing logic)
    // ...
  }

  // Check generation number before caching
  if (item.generation !== this.generationNumbers.get(item.assetId)) {
    return // Stale result, discard
  }

  // Cache and notify (existing logic)
  // ...
}
```

---

### Phase 5: CatalogService Integration (30 min)
**Status**: ✅ Complete

Expose regeneration through CatalogService.

**File**: `packages/core/src/catalog/catalog-service.ts`

```typescript
async regenerateThumbnail(
  assetId: string,
  editState: ExportEditState
): Promise<void> {
  const asset = await this.db.assets.get(assetId)
  if (!asset || !this._currentFolder) {
    throw new CatalogError('Asset not found', 'ASSET_NOT_FOUND')
  }

  const getBytes = async () => {
    const file = await this.getFileForAsset(asset)
    return new Uint8Array(await file.arrayBuffer())
  }

  await this.thumbnailService.regenerateThumbnail(
    assetId,
    getBytes,
    editState,
    ThumbnailPriority.BACKGROUND
  )
}
```

**Also update**:
- `ICatalogService` interface
- `MockCatalogService` implementation

---

### Phase 6: useCatalog Composable (15 min)
**Status**: ✅ Complete

Export regeneration function from composable.

**File**: `apps/web/app/composables/useCatalog.ts`

```typescript
async function regenerateThumbnail(assetId: string): Promise<void> {
  const editState = editStore.getEditStateForAsset(assetId)
  if (!editState) return

  await catalogService.regenerateThumbnail(assetId, editState)
}

return {
  // ... existing exports
  regenerateThumbnail,
}
```

---

### Phase 7: Edit Page Integration (30 min)
**Status**: ✅ Complete

Trigger regeneration when leaving edit view.

**File**: `apps/web/app/pages/edit/[id].vue`

```typescript
import { useCatalog } from '~/composables/useCatalog'

const { regenerateThumbnail } = useCatalog()
const editStore = useEditStore()

onBeforeUnmount(async () => {
  const id = assetId.value
  if (id && editStore.hasModifications) {
    try {
      await regenerateThumbnail(id)
    } catch (err) {
      console.warn('Failed to queue thumbnail regeneration:', err)
    }
  }
})
```

---

### Phase 8: Visual Feedback (30 min)
**Status**: ✅ Complete

Show subtle visual feedback during regeneration.

**File**: `apps/web/app/components/catalog/CatalogThumbnail.vue`

Keep old thumbnail visible but with reduced opacity during regeneration:

```vue
<img
  v-if="asset.thumbnailUrl"
  :src="asset.thumbnailUrl"
  :class="{
    'opacity-70': asset.thumbnailStatus === 'loading' && asset.thumbnailUrl
  }"
  class="transition-opacity duration-200"
/>
```

---

### Phase 9: Unit Tests (45 min)
**Status**: ✅ Complete

Add unit tests for the new functionality.

**Tests to add**:

1. **Worker message parsing**: Verify `generate-edited-thumbnail` message type
2. **DecodeService**: Test `generateEditedThumbnail()` method
3. **ThumbnailService**:
   - Test `invalidateThumbnail()` clears both caches
   - Test `regenerateThumbnail()` queues with correct priority
   - Test generation number prevents stale results
4. **Edit page**: Test regeneration triggered on unmount

---

## File Summary

### Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/decode/worker-messages.ts` | Add `GenerateEditedThumbnailRequest` type |
| `packages/core/src/decode/decode-worker.ts` | Handle `generate-edited-thumbnail` message |
| `packages/core/src/decode/decode-service.ts` | Add `generateEditedThumbnail()` method |
| `packages/core/src/decode/types.ts` | Update `IDecodeService` interface |
| `packages/core/src/decode/mock-decode-service.ts` | Add mock implementation |
| `packages/core/src/catalog/thumbnail-service.ts` | Add regeneration methods |
| `packages/core/src/catalog/catalog-service.ts` | Add `regenerateThumbnail()` method |
| `packages/core/src/catalog/types.ts` | Update `ICatalogService` interface |
| `packages/core/src/catalog/mock-catalog-service.ts` | Add mock implementation |
| `apps/web/app/composables/useCatalog.ts` | Export `regenerateThumbnail()` |
| `apps/web/app/pages/edit/[id].vue` | Trigger regeneration on unmount |
| `apps/web/app/components/catalog/CatalogThumbnail.vue` | Add opacity transition |

### Files to Create

None - all functionality can be added to existing files.

---

## Time Estimates

| Phase | Estimated Time |
|-------|----------------|
| Phase 1: Worker Message Type | 30 min |
| Phase 2: Worker Handler | 1 hr |
| Phase 3: DecodeService Method | 30 min |
| Phase 4: ThumbnailService Integration | 1 hr |
| Phase 5: CatalogService Integration | 30 min |
| Phase 6: useCatalog Composable | 15 min |
| Phase 7: Edit Page Integration | 30 min |
| Phase 8: Visual Feedback | 30 min |
| Phase 9: Unit Tests | 45 min |
| **Total** | **~5.5 hrs** |

---

## Success Criteria

1. ✅ Edited photo's thumbnail shows edits in gallery after returning from edit view
2. ✅ No visible UI jank during regeneration
3. ✅ Visible thumbnails always load before regeneration items (BACKGROUND priority)
4. ✅ Regeneration completes within 2 seconds for a single photo
5. ✅ All existing tests pass
6. ✅ New unit tests pass

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Performance degradation | Use BACKGROUND priority |
| Race conditions | Generation number tracking |
| Memory pressure | LRU eviction handles automatically |
| Stale thumbnails | Keep old thumbnail until new one ready |

---

## Dependencies

All dependencies already exist in the codebase:
- ExportEditState type for edit serialization
- WASM functions for all transformations
- Priority queue infrastructure
- Two-tier caching (memory + OPFS)
