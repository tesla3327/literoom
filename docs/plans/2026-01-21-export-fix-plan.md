# Export Fix Implementation Plan

**Date**: 2026-01-21
**Based on**: [Export Fix Research Synthesis](../research/2026-01-21-export-fix-synthesis.md)

## Overview

Fix the export feature so it actually produces output files. The main issues are:
1. Demo mode can't load image bytes (no real folder handle)
2. Errors are silently swallowed
3. MockDecodeService returns invalid JPEGs

## Implementation Phases

### Phase 1: Add Error Logging (Quick Win)

**Goal**: Make export failures visible for debugging.

**Files to modify**:
- `packages/core/src/export/export-service.ts`

**Changes**:
1. Add `console.error()` in the catch block that captures export failures
2. Include asset ID, filename, and full error details

```typescript
catch (error) {
  console.error(`[ExportService] Failed to export ${asset.filename}:`, error)
  result.failureCount++
  result.failures.push({
    assetId: asset.id,
    filename: asset.filename,
    error: error instanceof Error ? error.message : String(error),
  })
}
```

---

### Phase 2: Fix Demo Mode Export

**Goal**: Allow export to work in demo mode by loading bundled demo images.

**Approach**: Create a demo-aware `loadImageBytes` that:
1. Detects demo mode (via catalogService type or `isDemoMode` flag)
2. Fetches demo images from `/demo/images/` via HTTP
3. Returns the bytes for processing

**Files to modify**:
- `apps/web/app/composables/useExport.ts`
- `packages/core/src/catalog/mock-catalog-service.ts` (add method to get image bytes)

**Implementation**:

```typescript
// In useExport.ts - loadImageBytes function
async function loadImageBytes(asset: Asset): Promise<Uint8Array> {
  // Check if we're in demo mode
  const folder = catalogService.getCurrentFolder()

  if (!folder) {
    // Demo mode - load from bundled assets
    // Demo assets are stored at /demo/images/{asset.id}.jpg
    const response = await fetch(`/demo/images/${asset.id}.jpg`)
    if (!response.ok) {
      throw new Error(`Failed to load demo image: ${asset.filename}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return new Uint8Array(arrayBuffer)
  }

  // Real mode - navigate to file through folder handle
  // ... existing implementation
}
```

**Note**: Demo images must be pre-bundled in `public/demo/images/` directory.

---

### Phase 3: Use Real WASM Encoding (Not Mock)

**Goal**: In demo mode, use the real decode service for encoding instead of mock.

**Option A**: Switch demo mode to use real DecodeService for export
- Pros: Actually tests the full pipeline
- Cons: Requires WASM to be loaded in demo mode

**Option B**: Enhance MockDecodeService to produce valid JPEGs
- Create a canvas, draw pixels, export as JPEG
- Pros: Works without WASM
- Cons: Additional complexity

**Recommendation**: Option A - Use real service

**Files to modify**:
- `apps/web/app/composables/useExport.ts` - Pass real decode service for encoding

**Implementation**:
```typescript
// The useExport already injects decodeService
// We just need to ensure demo mode uses the real one for encoding
// OR we accept that demo export produces mock files (acceptable for testing)
```

**Decision**: For demo mode export, accept that files will be small mock JPEGs. Document this limitation. Real export with real folders will use the full pipeline.

---

### Phase 4: Show Export Errors in UI

**Goal**: Display export failures to users, not just toast success/error.

**Files to modify**:
- `apps/web/app/composables/useExport.ts`
- `apps/web/app/components/export/ExportModal.vue`

**Changes**:
1. If export has failures, show a detailed error list after completion
2. Include which files failed and why

```typescript
// In runExport() result handling
if (result.failureCount > 0) {
  // Log detailed failures
  console.warn('Export failures:', result.failures)

  // Show detailed error in toast
  const failedFiles = result.failures.map(f => f.filename).join(', ')
  toast.add({
    title: 'Some exports failed',
    description: `Failed: ${failedFiles}. Check console for details.`,
    color: 'warning',
  })
}
```

---

### Phase 5: Progress Indicator in Toolbar (Enhancement)

**Goal**: Show export progress outside the modal.

**Files to create/modify**:
- (New) `apps/web/app/components/export/ExportProgressBar.vue`
- `apps/web/app/components/catalog/FilterBar.vue` - Add progress bar

**Implementation**:
A small progress bar that appears in the toolbar during export:
- Shows current/total count
- Shows percentage
- Visible even if modal is closed
- Disappears when complete

---

## Execution Order

1. **Phase 1** (15 min): Add error logging - immediate debugging help
2. **Phase 4** (15 min): Show errors in UI - user feedback
3. **Phase 2** (30 min): Fix demo mode loading - makes demo export work
4. **Phase 5** (30 min): Progress in toolbar - polish

## Acceptance Criteria

- [ ] Export errors logged to console with full details
- [ ] Users see toast with failure details when export partially fails
- [ ] Demo mode export works (either produces valid files or clearly documents limitation)
- [ ] Real folder export produces valid JPEG files
- [ ] Progress visible during export

## Out of Scope (Future)

- Edit state persistence for batch exports
- Export queue management
- Export cancellation
- Export to different formats (PNG, TIFF)
