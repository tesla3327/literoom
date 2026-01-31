# Research Synthesis: Adjustments Not Persisted When Navigating

**Date**: 2026-01-31
**Issue**: Adjustments not persisted when navigating between photos in edit view

## Problem Statement

When editing a photo and making adjustments (Exposure, Contrast, etc.), the adjustments are lost when navigating to another photo in the filmstrip and then returning to the original photo. All slider values reset to 0/default.

## Root Cause Analysis

### Architecture Overview

The edit persistence system has a two-tier architecture:

1. **In-Memory Cache** (`editCache: Map<string, EditState>`)
   - Stores edit states per asset ID
   - Updated immediately on every edit via `markDirty()` -> `saveToCache()`

2. **IndexedDB Persistence** (`editStates` table)
   - Stores edit states for cross-session persistence
   - Updated asynchronously via `saveEditStateToDb()`

### Code Flow Analysis

When user edits photo A:
1. `setAdjustment('exposure', value)` called
2. `markDirty()` called:
   - Sets `isDirty.value = true`
   - Calls `saveToCache(currentAssetId.value)`:
     - `editCache.value.set(assetId, state)` - updates in-memory cache
     - `saveEditStateToDb(...)` - persists to IndexedDB async

When navigating from A to B:
1. URL changes from `/edit/A` to `/edit/B`
2. `assetId` computed changes
3. Watcher triggers `loadForAsset(B)`:
   - Saves current dirty state: `if (isDirty.value) { saveToCache(A) }`
   - Sets `currentAssetId = B`
   - Checks cache for B -> not found
   - Initializes with defaults

When returning from B to A:
1. Watcher triggers `loadForAsset(A)`
2. Should find A's edits in cache: `editCache.value.get(A)`
3. Apply cached state

### Potential Issues Found

1. **Vue Reactivity with `ref<Map>`**:
   - The `editCache` is defined as `ref<Map<string, EditState>>(new Map())`
   - Map mutations via `.set()` may not trigger Vue's reactivity system properly
   - The Map reference doesn't change, so watchers/computeds won't react

2. **Console Logging Shows Intent**:
   - Code has extensive `[EditStore]` logging
   - Logs show cache lookup results but may reveal timing issues

3. **Clear Function Called on Unmount**:
   - `editStore.clear()` is called in `onUnmounted()` of edit page
   - However, this should only trigger when leaving edit view entirely, not during navigation between photos

4. **Demo Mode Database State**:
   - In demo mode, IndexedDB is empty initially
   - `initializeFromDb()` returns 0 edit states
   - Session-only caching via `editCache` Map is the only persistence

## Files Analyzed

- `apps/web/app/stores/edit.ts` - Edit store with cache and persistence
- `apps/web/app/pages/edit/[id].vue` - Edit page with navigation
- `apps/web/app/plugins/catalog.client.ts` - Plugin initialization
- `packages/core/src/catalog/db.ts` - Database functions

## Recommended Fix

### Option 1: Use `shallowRef` for Map (Recommended)

Change `editCache` from `ref<Map>` to `shallowRef<Map>` and manually trigger reactivity when the Map contents change:

```typescript
const editCache = shallowRef<Map<string, EditState>>(new Map())

function saveToCache(assetId: string): void {
  const state = buildEditState(...)
  const newCache = new Map(editCache.value)
  newCache.set(assetId, state)
  editCache.value = newCache  // This triggers reactivity
  // ...
}
```

### Option 2: Use `reactive` with Object instead of Map

```typescript
const editCache = reactive<Record<string, EditState>>({})

function saveToCache(assetId: string): void {
  editCache[assetId] = state  // Reactive property assignment
}
```

### Option 3: Force Cache Refresh

Add explicit cache verification and logging to diagnose the issue:

```typescript
function loadForAsset(assetId: string): Promise<void> {
  console.log('[EditStore] Cache state:', {
    size: editCache.value.size,
    keys: Array.from(editCache.value.keys()),
    hasTarget: editCache.value.has(assetId)
  })
  // ...
}
```

## Implementation Plan

1. Add diagnostic logging to verify cache state during navigation
2. Change `editCache` to use `reactive` object pattern for better Vue integration
3. Ensure `saveToCache()` properly persists state
4. Add unit tests for navigation persistence scenario
5. Verify fix works in both demo and real mode
