# Direct URL Navigation Fix - Implementation Plan

**Date**: 2026-01-21
**Issue**: Edit page shows empty state when navigating directly via URL
**Severity**: Critical

## Overview

Add a `$initializeCatalog()` helper to the catalog plugin that middleware can call to ensure the catalog is populated before allowing navigation. This provides a clean, centralized solution that works for both demo and real modes.

## Phase 1: Enhanced Plugin with Initialization Helper

**File**: `apps/web/app/plugins/catalog.client.ts`

### Changes:
1. Add `initializeCatalog()` async function inside the plugin
2. Function checks if `catalogStore.assetIds.length === 0`
3. If empty and demo mode: call `service.selectFolder()` + `service.scanFolder()`
4. If empty and real mode: call `service.loadFromDatabase()`
5. Provide this function as `$initializeCatalog`

### Code:
```typescript
// Add initialization helper function
async function initializeCatalog(): Promise<boolean> {
  // Check if already initialized
  if (catalogStore.assetIds.length > 0) {
    return true
  }

  if (isDemoMode) {
    // Demo mode: auto-load demo catalog
    catalogStore.setFolderPath('Demo Photos')
    catalogStore.setScanning(true)
    try {
      await catalogService.selectFolder()
      await catalogService.scanFolder()
      return true
    } finally {
      catalogStore.setScanning(false)
    }
  } else {
    // Real mode: try to restore from database
    try {
      const restored = await catalogService.loadFromDatabase()
      if (restored) {
        const folder = catalogService.getCurrentFolder()
        if (folder) {
          catalogStore.setFolderPath(folder.name)
        }
        return true
      }
    } catch (e) {
      console.warn('Failed to restore catalog from database:', e)
    }
    return false
  }
}

// Provide it alongside other services
return {
  provide: {
    catalogService,
    decodeService,
    isDemoMode,
    initializeCatalog, // NEW
  },
}
```

## Phase 2: Enhanced Middleware

**File**: `apps/web/app/middleware/ensure-catalog.ts`

### Changes:
1. After awaiting `$catalogReady`, call `$initializeCatalog()`
2. If initialization fails in real mode, redirect to home
3. In demo mode, initialization should always succeed

### Code:
```typescript
export default defineNuxtRouteMiddleware(async () => {
  if (import.meta.server) {
    return
  }

  const nuxtApp = useNuxtApp()

  // Wait for catalog service to be created
  if (nuxtApp.$catalogReady) {
    await nuxtApp.$catalogReady
  }

  // Check if service is available
  if (!nuxtApp.$catalogService) {
    return navigateTo('/')
  }

  // Initialize catalog if not already populated
  if (nuxtApp.$initializeCatalog) {
    const initialized = await nuxtApp.$initializeCatalog()
    if (!initialized) {
      // Real mode: couldn't restore from database, redirect to home
      return navigateTo('/')
    }
  }
})
```

## Phase 3: TypeScript Type Augmentation

**File**: `apps/web/app/plugins/catalog.client.ts` (or new `.d.ts` file)

### Changes:
Add type augmentation for the new provided function:
```typescript
declare module '#app' {
  interface NuxtApp {
    $initializeCatalog: () => Promise<boolean>
  }
}
```

## Phase 4: Edit Page Loading State (Optional Enhancement)

**File**: `apps/web/app/pages/edit/[id].vue`

### Changes:
1. Add a loading state check for when catalog is being initialized
2. Show loading UI while waiting for data
3. Handle case where asset ID doesn't exist in catalog

This is optional because the middleware should handle initialization, but adds better UX.

## Verification Plan

1. **Direct URL Navigation (Demo Mode)**
   - Navigate directly to `/edit/demo-asset-5`
   - Verify: Page loads with correct asset, histogram, preview, filmstrip

2. **Page Refresh**
   - Load catalog via home page
   - Navigate to edit view
   - Refresh the page
   - Verify: Page reloads correctly with data

3. **Normal Navigation Flow**
   - Ensure home page → edit navigation still works
   - Verify: No double-loading or issues

4. **Real Mode (Manual)**
   - Test with real folder selection
   - Verify session restoration works

## Files Summary

| File | Action |
|------|--------|
| `apps/web/app/plugins/catalog.client.ts` | Add `initializeCatalog()` helper |
| `apps/web/app/middleware/ensure-catalog.ts` | Call initialization helper |
| `apps/web/app/pages/edit/[id].vue` | Optional: Add loading state |

## Risks and Mitigations

1. **Double initialization**: If user visits home then edit, catalog could initialize twice
   - Mitigation: Check `assetIds.length > 0` before initializing

2. **Race condition**: Multiple navigations could trigger multiple initializations
   - Mitigation: Add initialization flag/promise to prevent concurrent calls

3. **Slow initialization**: User sees blank page while waiting
   - Mitigation: Add loading state to edit page (Phase 4)
