# Edit Persistence - Research Synthesis

**Date**: 2026-01-22
**Status**: Research Complete - Solution Identified

## Executive Summary

**Surprising Finding**: Edit persistence is **already fully implemented** at the database level. The only missing piece is calling `editStore.initializeFromDb()` on app startup.

## Current Implementation

### Database Schema (Already Exists)

The `editStates` table exists in `packages/core/src/catalog/db.ts`:

```typescript
interface EditStateRecord {
  assetUuid: string        // Primary key
  schemaVersion: number    // Version 4 currently
  updatedAt: Date
  editState: string        // JSON serialized
}
```

### Save Path (Already Working)

When users edit photos, edits ARE being saved:
1. User makes edit → `setAdjustment()` → `markDirty()` → `saveToCache()`
2. `saveToCache()` updates in-memory cache AND calls `saveEditStateToDb()` async
3. Edits persist to IndexedDB automatically

### Load Path (Implemented But Not Called)

The load infrastructure exists in `apps/web/app/stores/edit.ts`:
1. `initializeFromDb()` - loads all edits from IndexedDB to memory cache
2. `loadForAsset(id)` - loads single asset's edits from cache or database
3. Migration support via `migrateEditState()` for schema version changes

### The Gap

**`initializeFromDb()` is NEVER called on app startup!**

This means:
- Edits are saved to IndexedDB ✓
- Edits survive browser refresh (data exists in DB) ✓
- But on reload, memory cache is empty ✗
- User sees default (zero) values instead of saved edits ✗

## Solution

### Option A: Plugin Initialization (Recommended)

Add edit store initialization to `catalog.client.ts` plugin:

```typescript
// In catalog.client.ts, after catalog initialization
const editStore = useEditStore()
await editStore.initializeFromDb()
```

**Pros:**
- Loads all edits once at startup
- Edits available before user navigates to edit view
- Simple, minimal code change

### Option B: Middleware Integration

Add to `ensure-catalog.ts` middleware:

```typescript
// After catalog initialization
const editStore = useEditStore()
if (!editStore.isInitialized) {
  await editStore.initializeFromDb()
}
```

**Pros:**
- Lazy loads edits only when needed
- Works for direct URL navigation

## Implementation Plan

### Phase 1: Add Initialization Call (5 min)

Modify `apps/web/app/plugins/catalog.client.ts`:
1. Import `useEditStore`
2. After `$initializeCatalog()`, call `editStore.initializeFromDb()`

### Phase 2: Add Initialization Guard (5 min)

Add `isInitialized` ref to edit store:
```typescript
const isInitialized = ref(false)

async function initializeFromDb() {
  if (isInitialized.value) return  // Already loaded
  // ... existing code ...
  isInitialized.value = true
}
```

### Phase 3: Verify Demo Mode (5 min)

Ensure demo mode also initializes (even though it has no persisted edits).

### Phase 4: Manual Testing (10 min)

1. Open app, enter edit view
2. Make edits (exposure, crop, etc.)
3. Refresh page
4. Return to same image
5. Verify edits are restored

## Files to Modify

| File | Change |
|------|--------|
| `apps/web/app/plugins/catalog.client.ts` | Add `editStore.initializeFromDb()` call |
| `apps/web/app/stores/edit.ts` | Add `isInitialized` guard |

## Schema Information

- **Current Edit Schema Version**: 4
- **Version History**:
  - v1: Initial adjustments
  - v2: Added tone curve
  - v3: Added crop transform
  - v4: Added masks (current)

Migration is handled automatically by `migrateEditState()` function.

## Risk Assessment

**Low Risk** - All infrastructure exists, just need to call initialization:
- Database schema is stable (version 3 with editStates table)
- Migration function handles old data
- Save path already working (just load is missing)
- No changes to data models needed

## Test Coverage

Existing tests in `packages/core/src/catalog/edit-types.test.ts`:
- Schema migration tests
- Default value tests
- Validation tests

No new tests needed for this fix.
