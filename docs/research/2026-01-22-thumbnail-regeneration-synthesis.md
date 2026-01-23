# Thumbnail Regeneration After Edits - Research Synthesis

**Date**: 2026-01-22
**Issue**: Gallery thumbnails don't reflect edits made in edit view

## Executive Summary

This research synthesizes findings from 6 parallel research agents analyzing the thumbnail system, edit state management, cache architecture, and performance implications. The goal is to design a system where thumbnails reflect edits made in the edit view.

**Key Findings:**
1. Current thumbnails are generated from original files only - no edit support
2. Edit state is already cached in memory and persisted to IndexedDB
3. Cache invalidation infrastructure exists (delete methods available)
4. Export pipeline provides a template for applying edits during generation
5. Performance impact is significant: +140-390ms per edited thumbnail
6. Regeneration should use BACKGROUND priority to avoid blocking UI

## Current Architecture

### Thumbnail Generation Flow
```
File Bytes → Decode (WASM) → Resize to 512px → JPEG Encode → Cache → Object URL
```

### Cache Layers
1. **Memory LRU Cache**: 150 items (45MB), O(1) access, auto-eviction
2. **OPFS Persistent Cache**: Unlimited, survives page reload, async write

### Priority Queue
- 4 priority levels: VISIBLE (0) → NEAR_VISIBLE (1) → PRELOAD (2) → BACKGROUND (3)
- 4 concurrent workers (up to 8 max)
- Max queue size: 200 items
- Lower priority items evicted first when queue full

### Edit State Management
- **editStore.editCache**: In-memory Map<assetId, EditState>
- Edits saved on every change via `markDirty()` → `saveToCache()`
- IndexedDB persistence for cross-session survival
- `getEditStateForAsset()` retrieves edits for any asset

## Proposed Solution

### Architecture Overview

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

### Key Components

#### 1. New Worker Message: `generate-edited-thumbnail`

```typescript
interface GenerateEditedThumbnailRequest {
  id: string
  type: 'generate-edited-thumbnail'
  bytes: Uint8Array
  size: number
  editState: ExportEditState
}
```

#### 2. Edit Pipeline in Worker

Order of operations (same as export):
1. Decode image
2. Apply rotation (angle + straighten)
3. Apply crop
4. Apply adjustments (basic settings)
5. Apply tone curve
6. Apply masked adjustments (linear/radial gradients)
7. Resize to 512px
8. Encode as JPEG

#### 3. Cache Invalidation

```typescript
async invalidateThumbnail(assetId: string): Promise<void> {
  // Cancel any in-flight requests
  this.queue.remove(assetId)
  this.activeRequests.delete(assetId)

  // Delete from both caches
  this.memoryCache.delete(assetId)  // Sync, revokes Object URL
  await this.opfsCache.delete(assetId)  // Async
}
```

#### 4. Regeneration Trigger

Best location: `onBeforeUnmount` in `edit/[id].vue`:

```typescript
onBeforeUnmount(async () => {
  const id = assetId.value
  if (id && editStore.hasModifications) {
    // Request regeneration with low priority
    regenerateThumbnail(id, ThumbnailPriority.BACKGROUND)
  }
})
```

#### 5. Visual Feedback

Two approaches (both supported):

**Option A: Keep old thumbnail visible** (recommended)
- Show existing thumbnail while regenerating
- Slight opacity reduction (0.7) during regeneration
- No jarring transitions

**Option B: New "regenerating" status**
- Add `ThumbnailStatus = 'regenerating'`
- Show thumbnail + subtle spinner overlay
- More explicit feedback

## Implementation Files

### Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/decode/worker-messages.ts` | Add `GenerateEditedThumbnailRequest` type |
| `packages/core/src/decode/decode-worker.ts` | Handle `generate-edited-thumbnail` message |
| `packages/core/src/decode/decode-service.ts` | Add `generateEditedThumbnail()` method |
| `packages/core/src/catalog/thumbnail-service.ts` | Add `regenerateThumbnail()` method, invalidation |
| `packages/core/src/catalog/thumbnail-cache.ts` | Add `invalidate()` alias (exists as `delete()`) |
| `apps/web/app/composables/useCatalog.ts` | Export `regenerateThumbnail()` |
| `apps/web/app/pages/edit/[id].vue` | Trigger regeneration on unmount |

### Files to Create

None - all functionality can be added to existing files.

## Performance Considerations

### Per-Thumbnail Cost

| Operation | Time |
|-----------|------|
| Decode | 50-100ms |
| Apply rotation | 50-100ms |
| Apply crop | 5-10ms |
| Apply adjustments | 20-40ms |
| Apply tone curve | 10-20ms |
| Apply masked adjustments | 50-150ms |
| Resize + encode | 20-40ms |
| **Total with edits** | **205-460ms** |
| **Original (no edits)** | **70-140ms** |

### Throughput

- 4 workers at 300ms avg: ~13 thumbnails/second
- 1000 edited thumbnails: ~80 seconds
- Uses BACKGROUND priority: won't block visible thumbnail loading

### Memory Impact

- Regenerating 150+ thumbnails evicts entire LRU cache
- OPFS cache handles persistence
- Memory pressure manageable with LRU eviction

### Mitigation Strategies

1. **Only regenerate if edits exist**: Check `hasModifications` before regenerating
2. **Use BACKGROUND priority**: Never block visible thumbnails
3. **Pause during scrolling**: Detect user activity, pause regeneration
4. **Batch regeneration**: Process in batches of 10-20 with delays
5. **Limit concurrent regeneration**: Use 1-2 workers max for regeneration

## Race Condition Handling

### Scenario: Delete during generation

**Problem**: Thumbnail being generated while cache deleted

**Solution**: Generation number tracking
```typescript
private generationNumbers = new Map<string, number>()

invalidate(assetId: string) {
  const gen = (this.generationNumbers.get(assetId) ?? 0) + 1
  this.generationNumbers.set(assetId, gen)
  // ... delete cache
}

processItem(assetId: string, generation: number) {
  // After generation completes
  if (generation === this.generationNumbers.get(assetId)) {
    // Safe to cache
  }
  // Otherwise discard stale result
}
```

## UI Integration

### Triggering Regeneration

```typescript
// In edit/[id].vue
onBeforeUnmount(() => {
  if (assetId.value && editStore.hasModifications) {
    const { regenerateThumbnail } = useCatalog()
    regenerateThumbnail(assetId.value)
  }
})
```

### Catalog Store Updates

```typescript
// In catalog.ts
function setThumbnailRegenerating(assetId: string): void {
  updateAsset(assetId, {
    thumbnailStatus: 'loading', // Reuse existing status
  })
  // Keep thumbnailUrl - show old thumbnail while regenerating
}
```

### Component Display

```vue
<!-- In CatalogThumbnail.vue -->
<img
  v-if="asset.thumbnailUrl"
  :src="asset.thumbnailUrl"
  :class="{ 'opacity-70': asset.thumbnailStatus === 'loading' && asset.thumbnailUrl }"
  class="transition-opacity duration-200"
/>
```

## Recommended Approach

### Phase 1: Core Infrastructure (Priority: High)

1. Add `generate-edited-thumbnail` worker message
2. Implement edit pipeline in decode worker
3. Add `generateEditedThumbnail()` to DecodeService
4. Add `regenerateThumbnail()` to ThumbnailService
5. Add generation number tracking for race conditions

### Phase 2: Integration (Priority: High)

1. Export `regenerateThumbnail()` from useCatalog
2. Trigger regeneration in edit page unmount
3. Test with demo mode

### Phase 3: UX Polish (Priority: Medium)

1. Add opacity transition during regeneration
2. Implement activity-based throttling
3. Add regeneration progress to FilterBar (optional)

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Performance degradation during regeneration | Medium | Use BACKGROUND priority, throttle during activity |
| Memory pressure from regeneration | Low | LRU eviction handles automatically |
| Race conditions | Medium | Generation number tracking |
| Stale thumbnails if regeneration fails | Medium | Retry on error, keep old thumbnail |
| Complex edit state serialization | Low | Reuse existing ExportEditState format |

## Success Criteria

1. Edited photo's thumbnail shows edits in gallery after returning from edit view
2. No visible UI jank during regeneration
3. Visible thumbnails always load before regeneration items
4. Regeneration completes within 2 seconds for a single photo
5. All existing tests pass

## Code References

- Thumbnail Service: `packages/core/src/catalog/thumbnail-service.ts`
- Thumbnail Cache: `packages/core/src/catalog/thumbnail-cache.ts`
- Edit Store: `apps/web/app/stores/edit.ts`
- Export Service: `packages/core/src/export/export-service.ts`
- Decode Worker: `packages/core/src/decode/decode-worker.ts`
- Edit Page: `apps/web/app/pages/edit/[id].vue`
