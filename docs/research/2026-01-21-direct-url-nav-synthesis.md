# Direct URL Navigation Fix - Research Synthesis

**Date**: 2026-01-21
**Status**: Complete

## Problem Summary

When navigating directly to `/edit/[id]` via URL (e.g., refreshing the page or sharing a link), the edit page shows an empty state because the catalog hasn't been initialized with assets.

### Current Behavior
1. `catalog.client.ts` plugin creates the CatalogService and resolves `$catalogReady`
2. `ensure-catalog` middleware waits for `$catalogReady` - service exists ✅
3. BUT: `$catalogReady` only means service created, NOT assets loaded ❌
4. Edit page renders with empty `catalogStore.assets` Map
5. Result: "Loading..." forever, "0 / 0" position, no filmstrip

### Expected Behavior
- Direct URL navigation should work seamlessly
- In demo mode: auto-load demo catalog
- In real mode: restore from database or redirect to home

## Key Findings

### 1. Initialization Flow
- Home page's `onMounted()` calls `restoreSession()` which triggers asset loading
- In demo mode, `restoreSession()` calls `selectFolder()` which loads 50 demo assets
- This initialization never happens when navigating directly to edit page

### 2. Middleware Limitations
- ✅ Can access `$catalogService` and `$catalogReady`
- ❌ Cannot reliably call composables like `useCatalog()` or `useCatalogStore()`
- ❌ Middleware runs in limited context without full composable support
- Current middleware only verifies service exists, not that data is loaded

### 3. Edit Page Dependencies
- Depends on: `catalogStore.assets`, `uiStore.filteredAssetIds`, `editStore`
- Uses optional chaining (`asset?.filename`) so doesn't crash with missing data
- Watch on `assetId` runs immediately with `immediate: true`
- Page gracefully degrades but shows empty/loading state

### 4. Demo Mode
- Detected via `LITEROOM_DEMO_MODE=true` env variable
- Plugin creates `MockCatalogService` which generates 50 deterministic demo assets
- Assets only loaded when `scanFolder()` is called
- `scanFolder()` is triggered by `selectFolder()` in `useCatalog`

## Solution: Enhanced Plugin with Initialization Helper

The cleanest solution is to add a `$initializeCatalog` method to the plugin that can be called from middleware. This centralizes initialization logic and avoids issues with composable context.

### Why This Approach
1. **Plugin has full access** - Can access stores and services
2. **Middleware can await** - Middleware supports async/await
3. **Centralized logic** - All initialization in one place
4. **Works for both modes** - Demo auto-loads, real restores from DB

### Implementation
1. Plugin provides `$initializeCatalog()` async function
2. Function checks if assets exist, if not initializes catalog
3. Middleware calls this function after `$catalogReady`
4. Edit page loads with data ready

## Files to Modify

1. `apps/web/app/plugins/catalog.client.ts` - Add initialization helper
2. `apps/web/app/middleware/ensure-catalog.ts` - Call initialization helper
3. `apps/web/app/pages/edit/[id].vue` - Add loading state (optional, for better UX)
