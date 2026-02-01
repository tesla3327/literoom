# Preview Generation Performance - Research Synthesis

**Date**: 2026-01-31
**Task**: Investigate and optimize slow preview generation for better UX

## Executive Summary

The preview generation system in Literoom is architecturally sound but has one critical gap: **no automatic preloading of adjacent photos when the edit pipeline is idle**. This single optimization would dramatically improve perceived performance when navigating between photos in edit view.

## Current Architecture

### Preview Generation Pipeline

```
User Request
    ↓
ThumbnailService (Coordinator)
    ↓
Priority Queue (Min-Heap)
    ↓
Worker Pool (4-8 concurrent workers)
    ↓
WASM Decode/Resize
    ↓
Two-Tier Cache (Memory LRU + OPFS)
    ↓
Display
```

### Key Components

| Component | File | Purpose |
|-----------|------|---------|
| ThumbnailService | `packages/core/src/catalog/thumbnail-service.ts` | Request coordination, queue management |
| ThumbnailQueue | `packages/core/src/catalog/thumbnail-queue.ts` | Priority-based min-heap queue |
| ThumbnailCache | `packages/core/src/catalog/thumbnail-cache.ts` | Memory LRU + OPFS persistence |
| DecodeService | `packages/core/src/decode/decode-service.ts` | Worker pool communication |
| useEditPreview | `apps/web/app/composables/useEditPreview.ts` | Edit view rendering coordination |
| EditPipeline | `packages/core/src/gpu/pipelines/edit-pipeline.ts` | GPU-accelerated processing |

### Priority System

```typescript
enum ThumbnailPriority {
  VISIBLE = 0,      // Currently visible in viewport
  NEAR_VISIBLE = 1, // Within one screen
  PRELOAD = 2,      // Within two screens
  BACKGROUND = 3,   // Low priority background
}
```

## Identified Bottlenecks

### 1. No Adjacent Photo Preloading (PRIMARY ISSUE)

**Current Behavior:**
- When viewing photo N in edit view, only photo N's preview is loaded
- Clicking to photo N+1 requires waiting for full preview generation
- No background preloading of N±1, N±2, etc.

**Impact:** User waits 300-800ms every time they navigate to adjacent photo

**Solution:** Implement automatic preloading when GPU pipeline is idle

### 2. GPU→CPU Readback Latency

**Current Behavior:**
- Full render requires reading GPU texture back to CPU
- `mapAsync()` synchronization: 15-30ms per frame

**Mitigation (Already Implemented):**
- WebGPU direct canvas rendering path eliminates readback for display
- Readback only needed for histogram computation (throttled to 500ms)

### 3. Progressive Refinement Delays

**Current Behavior:**
- Draft quality (0.5x) during interaction: 33ms throttle
- Full quality after interaction: 400ms debounce

**Impact:** User perceives lag between slider release and final quality

### 4. Cache Limitations

| Cache | Limit | Issue |
|-------|-------|-------|
| Preview Memory | 20 items | May thrash with large galleries |
| Thumbnail Memory | 150 items | Generally sufficient |
| OPFS | Unlimited | No quota monitoring |

### 5. Edited Preview Not Cached

- After editing, only 256px thumbnail is cached
- Full preview (1280px) regenerated from scratch every edit view visit
- No caching of GPU-rendered output

## Performance Characteristics

### Generation Times (Estimated)

| Operation | Duration | Notes |
|-----------|----------|-------|
| JPEG decode | 50-100ms | Size dependent |
| Lanczos3 resize (1280px) | 100-300ms | Quality algorithm, expensive |
| GPU adjustments | 5-15ms | Very fast with WebGPU |
| GPU tone curve | 3-8ms | LUT lookup |
| GPU masks | 5-20ms | Per-mask overhead |
| Canvas JPEG encode | 50-200ms | Resolution dependent |
| **Total raw preview** | **200-600ms** | Without edits |
| **Total edited preview** | **300-800ms** | Full pipeline |

### GPU Pipeline Performance

- Single submission model: All stages in one command buffer
- Uber-pipeline optimization: Adjustments + tone curve in single pass (75% bandwidth reduction)
- Texture pooling: 8 pre-allocated textures for intermediates
- Triple-buffered readback: Fire-and-forget async pattern

## Optimization Opportunities

### Primary Recommendation: Adjacent Photo Preloading

**Implementation Strategy:**

1. **Idle Detection** - Hook into `useEditPreview`'s render state machine:
   ```typescript
   // When state transitions to 'idle' after full render
   if (renderState.value === 'idle') {
     preloadAdjacentPhotos()
   }
   ```

2. **Preload Range** - N±1 immediately, N±2 after short delay:
   ```typescript
   function preloadAdjacentPhotos() {
     const currentIdx = filteredIds.indexOf(currentAssetId)

     // Immediate neighbors at BACKGROUND priority
     requestPreview(filteredIds[currentIdx - 1], ThumbnailPriority.BACKGROUND)
     requestPreview(filteredIds[currentIdx + 1], ThumbnailPriority.BACKGROUND)

     // Extended range after delay
     setTimeout(() => {
       requestPreview(filteredIds[currentIdx - 2], ThumbnailPriority.BACKGROUND)
       requestPreview(filteredIds[currentIdx + 2], ThumbnailPriority.BACKGROUND)
     }, 100)
   }
   ```

3. **Cancel on Interaction** - Stop preloading when user resumes editing:
   ```typescript
   // When state transitions to 'interacting'
   if (renderState.value === 'interacting') {
     cancelBackgroundPreloads()
   }
   ```

**Files to Modify:**
- `apps/web/app/composables/useEditPreview.ts` - Add idle callback
- `apps/web/app/composables/useCatalog.ts` - Add `cancelPreload()` method
- `packages/core/src/catalog/thumbnail-service.ts` - Add cancellation support

### Secondary Optimizations

| Optimization | Effort | Impact | Priority |
|--------------|--------|--------|----------|
| Adjacent preloading | Medium | High | 1 |
| Increase preview cache to 50 | Low | Medium | 2 |
| Cache edited previews | High | Medium | 3 |
| Reduce debounce to 300ms | Low | Low | 4 |
| Add cache metrics | Medium | Low | 5 |

## Architecture Strengths

1. **Priority Queue** - Visible items processed first
2. **Worker Pool** - 4-8 parallel decoders
3. **Two-Tier Cache** - Memory + persistent storage
4. **GPU Direct Render** - Eliminates readback for display
5. **Generation Counters** - Prevents stale renders
6. **Progressive Refinement** - Draft during interaction

## Recommended Implementation Plan

### Phase 1: Adjacent Photo Preloading (This Iteration)

1. Add `preloadAdjacentPreviews()` function to `useCatalog.ts`
2. Call it when `useEditPreview` enters idle state
3. Use `ThumbnailPriority.BACKGROUND` (3) for preloads
4. Cancel preloads when user starts interacting

### Phase 2: Extended Preloading (Future)

1. Extend EditFilmstrip to preload N±5 beyond visible range
2. Implement `requestIdleCallback()` wrapper for true background priority
3. Add priority aging to prevent queue starvation

### Phase 3: Cache Improvements (Future)

1. Increase preview memory cache to 50 items
2. Add edited preview caching (post-GPU render)
3. Implement cache metrics (hit rate, eviction count)

## Files Reference

### Core Pipeline
- `/packages/core/src/catalog/thumbnail-service.ts` (674 lines)
- `/packages/core/src/catalog/thumbnail-queue.ts` (350 lines)
- `/packages/core/src/catalog/thumbnail-cache.ts` (434 lines)
- `/packages/core/src/decode/decode-service.ts` (392 lines)
- `/packages/core/src/decode/decode-worker.ts` (512 lines)

### GPU Pipeline
- `/packages/core/src/gpu/pipelines/edit-pipeline.ts` (1413 lines)
- `/packages/core/src/gpu/pipelines/uber-pipeline.ts` - Combined pass
- `/packages/core/src/gpu/pipelines/histogram-pipeline.ts` - Async histogram

### Web Layer
- `/apps/web/app/composables/useEditPreview.ts` (1766 lines)
- `/apps/web/app/composables/useCatalog.ts` - Request API
- `/apps/web/app/components/edit/EditFilmstrip.vue` - Filmstrip UI

## Conclusion

The preview generation system is well-architected with sophisticated caching, priority queuing, and GPU acceleration. The single highest-impact improvement is **implementing automatic adjacent photo preloading when the edit pipeline is idle**. This would eliminate the wait time when navigating between photos in edit view, which is the most common complaint about perceived slowness.

The infrastructure to support this optimization already exists (priority queue, background priority level, cancellation support). Implementation requires adding ~50-100 lines of code to coordinate preloading with the render state machine.
