# Thumbnail Regeneration After Edits - Research Plan

**Date**: 2026-01-22
**Issue**: Gallery thumbnails don't reflect edits made in edit view

## Problem Statement

When a user edits a photo (exposure, contrast, crop, etc.) and returns to the gallery, the thumbnail still shows the original unedited image. This creates a confusing disconnect between:
1. What the user sees in the gallery (original)
2. What they see when re-entering edit view (edited)
3. What gets exported (edited)

## Goals

1. Understand the current thumbnail generation and caching pipeline
2. Understand how edits are stored and when they're considered "saved"
3. Design a cache invalidation strategy that's performant
4. Determine how to generate thumbnails with edits applied
5. Plan UI feedback during thumbnail regeneration

## Research Areas

### Area 1: Current Thumbnail Pipeline Analysis (Agent 1)

**Files to Analyze**:
- `packages/core/src/catalog/thumbnail-service.ts`
- `packages/core/src/catalog/thumbnail-cache.ts`
- `packages/core/src/catalog/types.ts` (ThumbnailPriority, Asset)

**Questions to Answer**:
1. How are thumbnails generated? (Decode → Resize → Cache)
2. What are the cache layers? (Memory LRU, OPFS)
3. How does the priority queue work?
4. What message types go to the worker?
5. How are cache keys structured? (Are edits included in the key?)

### Area 2: Edit State Management (Agent 2)

**Files to Analyze**:
- `apps/web/app/stores/edit.ts` (editCache, isDirty, saveToCache)
- `apps/web/app/composables/useExport.ts` (how export gets edits)
- `packages/core/src/export/export-service.ts`

**Questions to Answer**:
1. When are edits saved to the editCache Map?
2. How does export retrieve edit state for each asset?
3. What edit properties exist? (adjustments, toneCurve, crop, rotation, masks)
4. Is there a "dirty" flag that indicates unsaved edits?
5. How do we know if an asset has been edited vs. default state?

### Area 3: Cache Invalidation Strategies (Agent 3)

**Research Topics**:
1. Common cache invalidation patterns in web apps
2. How to invalidate both memory and persistent (OPFS) caches
3. Trade-offs: immediate invalidation vs. lazy regeneration
4. Stale-while-revalidate pattern applicability

**Questions to Answer**:
1. Should we invalidate on edit, on navigation away, or on demand?
2. How to handle the race between invalidation and new requests?
3. Should we use a separate cache for edited thumbnails?
4. How to version/key edited thumbnails to distinguish from originals?

### Area 4: Thumbnail Generation with Edits Applied (Agent 4)

**Files to Analyze**:
- `packages/core/src/export/export-service.ts` (applies edits for export)
- `packages/core/src/decode/decode-worker.ts`
- `crates/literoom-wasm/src/lib.rs` (WASM functions)

**Questions to Answer**:
1. What's the export rendering pipeline? (Can we reuse it?)
2. What WASM functions apply edits? (apply_adjustments, apply_tone_curve, apply_masked_adjustments, apply_rotation, apply_crop)
3. What's the order of operations for a full edit pipeline?
4. Can we create a smaller "thumbnail with edits" worker message?
5. What's the performance cost of applying edits during thumbnail generation?

### Area 5: UI Integration (Agent 5)

**Files to Analyze**:
- `apps/web/app/components/catalog/CatalogThumbnail.vue`
- `apps/web/app/components/catalog/CatalogGrid.vue`
- `apps/web/app/composables/useCatalog.ts`
- `apps/web/app/stores/catalog.ts`

**Questions to Answer**:
1. How does CatalogThumbnail request and display thumbnails?
2. What visual state is shown during thumbnail loading?
3. How to show "regenerating" state without jarring the UI?
4. When should regeneration be triggered? (Exit edit view? Background job?)
5. How to handle rapid navigation (edit → gallery → edit → gallery)?

### Area 6: Performance Considerations (Agent 6)

**Research Topics**:
1. Impact of regenerating thumbnails on scroll performance
2. Memory pressure from holding edited thumbnails
3. Worker thread utilization during regeneration
4. Priority management (don't block new thumbnail requests)

**Questions to Answer**:
1. How many thumbnails might need regeneration after an edit session?
2. Should regeneration use the same priority queue or a separate one?
3. What's the memory cost of applying edits vs. just decoding?
4. How to batch regeneration without blocking the UI?

## Success Criteria

Research is complete when we can answer:

1. **What to invalidate**: Which cache layers need updating
2. **When to invalidate**: Trigger point for regeneration
3. **How to generate**: Reusing export pipeline or new path
4. **Performance impact**: Estimated cost and mitigation strategies
5. **UI changes needed**: Components that need updates

## Output

A synthesis document with:
1. Recommended architecture for thumbnail regeneration
2. List of files to modify
3. Sequence diagram of the regeneration flow
4. Risk assessment and mitigation strategies
