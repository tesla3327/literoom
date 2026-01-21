# Direct URL Navigation Fix - Research Plan

**Date**: 2026-01-21
**Issue**: When navigating directly to `/edit/[id]` via URL, the edit page shows empty state because the catalog hasn't been initialized.

## Background

The current implementation has a timing issue:
1. `catalog.client.ts` plugin creates the CatalogService and exposes `$catalogReady` promise
2. `ensure-catalog` middleware waits for `$catalogReady` - this ensures the service exists
3. But `$catalogReady` only means the service is created, NOT that assets are loaded
4. In demo mode, the home page's `onMounted()` calls `restoreSession()` which triggers asset loading
5. Direct URL navigation bypasses the home page, so assets are never loaded

## Research Areas

### Area 1: Current Initialization Flow
- How does the home page initialize the catalog?
- What happens in `restoreSession()` for demo vs real mode?
- Where is the demo catalog data loaded?

### Area 2: Middleware Capabilities
- Can Nuxt middleware trigger async operations like catalog loading?
- Can middleware access Pinia stores to check state?
- What are the limitations of middleware?

### Area 3: Edit Page Lifecycle
- When does the edit page's `onMounted` run vs middleware?
- Can the page show a loading state while catalog loads?
- How should the page handle missing asset data?

### Area 4: Demo Mode Specifics
- How is demo mode detected?
- What triggers demo catalog loading?
- Is there a difference in initialization between demo and real mode?

## Potential Solutions

### Solution A: Enhanced Middleware
Modify `ensure-catalog` middleware to:
1. Wait for `$catalogReady` (already done)
2. Check if catalog has assets
3. If empty AND demo mode, trigger `restoreSession()`
4. Wait for assets to load before allowing navigation

### Solution B: Edit Page Self-Loading
Modify edit page to:
1. Check if asset exists on mount
2. If not, show loading state
3. Trigger catalog initialization
4. Once loaded, re-check and display

### Solution C: App-Level Initialization
- Move catalog initialization to app.vue or a layout
- Ensures catalog is always loaded before any page
- May cause flash of loading on initial visit

### Solution D: Redirect Pattern
- If edit page has no asset data, redirect to home
- Home initializes catalog
- User navigates back to edit

## Recommendation

Solution A (Enhanced Middleware) seems cleanest because:
- Centralized logic in one place
- No user-visible redirect
- Middleware already exists
- Can handle both demo and real mode
