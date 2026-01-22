# Export Fix Research Synthesis

**Date**: 2026-01-21
**Topic**: Why export doesn't produce any output files

## Executive Summary

The export feature fails silently because:
1. **Demo mode breaks `loadImageBytes()`** - The function requires a real folder handle from `catalogService.getCurrentFolder()`, which returns `null` in demo mode
2. **No error logging** - Export errors are captured but never logged to console, making debugging impossible
3. **Mock JPEG encoding returns empty files** - Even if loading worked, `MockDecodeService.encodeJpeg()` returns minimal dummy bytes

## Detailed Analysis

### Issue 1: `loadImageBytes()` Cannot Load Demo Images

**File**: `apps/web/app/composables/useExport.ts:111-142`

```typescript
async function loadImageBytes(asset: Asset): Promise<Uint8Array> {
  const folder = catalogService.getCurrentFolder()
  if (!folder) {
    throw new Error('No folder selected')  // FAILS HERE IN DEMO MODE
  }
  // ... navigates through file path using FileSystemDirectoryHandle
}
```

**Problem**: In demo mode:
- `catalogService` is a `MockCatalogService`
- `getCurrentFolder()` returns `null` (no real folder)
- Every export attempt throws `'No folder selected'`

**Fix Required**: Add a demo-mode path that loads demo image bytes directly from bundled assets.

### Issue 2: Silent Error Handling

**File**: `packages/core/src/export/export-service.ts:145-152`

```typescript
catch (error) {
  result.failureCount++
  result.failures.push({
    assetId: asset.id,
    filename: asset.filename,
    error: error instanceof Error ? error.message : String(error),
  })
  // NO CONSOLE LOGGING - errors silently captured
}
```

**Problem**: When `processAsset()` fails, the error is stored but never displayed to:
- Console (for developers)
- UI (for users)

**Fix Required**: Add console.error logging and surface errors in UI.

### Issue 3: MockDecodeService Creates Empty JPEGs

**File**: `packages/core/src/decode/mock-decode-service.ts:574-609`

```typescript
async encodeJpeg(...): Promise<Uint8Array> {
  // Returns minimal "mock JPEG" - just SOI/EOI markers with headers
  // Total: ~20 bytes instead of actual encoded image
  const mockJpeg = new Uint8Array(mockJpegHeader.length + 2)
  // ...
  return mockJpeg
}
```

**Problem**: Even if demo mode could write files, they'd be corrupt (no actual image data).

**Fix Required**: In demo mode, use actual JPEG encoding via canvas or include pre-encoded demo JPEGs.

### Issue 4: Edit State Only Works for Current Image

**File**: `apps/web/app/composables/useExport.ts:153-168`

```typescript
async function getEditState(assetId: string): Promise<ExportEditState | null> {
  if (editStore.currentAssetId === assetId) {
    // Only returns edits for currently viewed image
    return { /* ... */ }
  }
  // TODO: Load from database once persistence is implemented
  return null  // All other images export WITHOUT their edits!
}
```

**Problem**: When exporting multiple images, only the currently viewed image preserves its edits. All others export unedited.

**Fix Required (Lower Priority)**: Implement edit state persistence in IndexedDB and load during export.

## Architecture Flow

```
Export Button Click
    ↓
useExport.runExport()
    ↓
ExportService.exportAssets(assets, options)
    ↓
For each asset:
    ├── loadImageBytes(asset) ← FAILS HERE ("No folder selected")
    │   ↓
    │   catalogService.getCurrentFolder() → null in demo mode
    │   ↓
    │   throw new Error('No folder selected')
    ↓
catch (error)
    ↓
result.failures.push({ error: 'No folder selected' })
    ↓
(NO console logging)
    ↓
Export "completes" with 100% failure rate
```

## Implementation Plan

### Phase 1: Add Error Logging
1. Add `console.error()` in export service catch block
2. Log detailed error information for debugging

### Phase 2: Fix Demo Mode Export
1. Check if running in demo mode (via `isDemoMode` or service type check)
2. For demo mode: Load images via `fetch()` from bundled `/demo/` assets
3. Use real WASM encoding even in demo mode (or pre-encode demo images)

### Phase 3: Add Progress UI in Toolbar
1. Add progress bar to main toolbar during export
2. Show current file/total count
3. Show errors in real-time

### Phase 4: Edit State Persistence (Future)
1. Persist edit state to IndexedDB when changes are made
2. Load edit state during export for all selected images

## Files to Modify

| File | Changes |
|------|---------|
| `packages/core/src/export/export-service.ts` | Add console.error logging |
| `apps/web/app/composables/useExport.ts` | Demo mode image loading |
| `packages/core/src/decode/mock-decode-service.ts` | Real JPEG encoding or skip |
| `apps/web/app/components/export/ExportModal.vue` | Better error display |
| (New) Toolbar progress component | Export progress indicator |

## Testing Strategy

1. Test with real folder (production mode)
2. Test with demo catalog (verify demo export works)
3. Test error scenarios (permission denied, disk full simulation)
4. Verify exported JPEGs are valid and contain correct image data
