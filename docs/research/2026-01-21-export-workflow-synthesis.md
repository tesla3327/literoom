# Export Workflow Research Synthesis

**Created**: 2026-01-21 16:55 EST
**Purpose**: Synthesize research findings for Export workflow feature implementation

## Executive Summary

The Export workflow is the last major v1 requirement. Research across 5 areas reveals that **~80% of infrastructure already exists**. The main gaps are:
1. **JPEG encoding in WASM** (straightforward addition to `image` crate already in use)
2. **Export coordination layer** (new service to orchestrate operations)
3. **Filename template parser** (simple regex-based implementation)

## Key Findings by Area

### 1. File System Access API - Writing Files ✅ Infrastructure Exists

**Existing Support**:
- `FileSystemProvider.writeFile()` already implemented in `packages/core/src/filesystem/`
- `FileSystemProvider.createFile()` already exists
- Permission management handled
- Browser File System Access API fully supported

**For Export**:
```javascript
// Request write access
const dirHandle = await window.showDirectoryPicker({
  mode: "readwrite",
  id: "photo-export",
  startIn: "pictures"
});

// Write JPEG file
const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
const writable = await fileHandle.createWritable();
await writable.write(jpegBlob);
await writable.close();
```

**Collision Detection**:
```javascript
async function checkFileExists(dirHandle, filename) {
  try {
    await dirHandle.getFileHandle(filename, { create: false });
    return true;
  } catch (error) {
    return error.name !== "NotFoundError" ? throw error : false;
  }
}
```

**Error Types to Handle**:
- `NotAllowedError` - Permission denied
- `NotFoundError` - File/folder not found
- `QuotaExceededError` - Disk full
- `NoModificationAllowedError` - File locked

### 2. JPEG Encoding in WASM ⚠️ Needs Implementation

**Recommendation**: Use existing `image` crate (already in dependencies)

**Why `image` crate**:
- Already used for JPEG decoding
- Pure Rust (no C dependencies - safe for WASM)
- Quality range: 0-100
- ~10-15% larger files than mozjpeg (acceptable trade-off)

**Implementation Pattern**:
```rust
// In literoom-core/src/encode/jpeg.rs (NEW)
pub fn encode_jpeg(
    pixels: &[u8],
    width: u32,
    height: u32,
    quality: u8,  // 0-100
) -> Result<Vec<u8>, EncodeError> {
    let img = image::RgbImage::from_raw(width, height, pixels.to_vec())
        .ok_or(EncodeError::InvalidPixelData)?;

    let mut buffer = vec![];
    let encoder = image::jpeg::JpegEncoder::new_with_quality(&mut buffer, quality);
    encoder.encode(&img, width as u16, height as u16, image::ColorType::Rgb8)?;

    Ok(buffer)
}
```

**WASM Binding**:
```rust
// In literoom-wasm/src/encode.rs (NEW)
#[wasm_bindgen]
pub fn encode_jpeg_to_bytes(
    image: &JsDecodedImage,
    quality: u8,
) -> Result<Vec<u8>, JsValue> {
    literoom_core::encode::encode_jpeg(
        &image.pixels,
        image.width,
        image.height,
        quality.clamp(0, 100),
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))
}
```

**Quality Recommendations**:
| Quality | Use Case | File Size |
|---------|----------|-----------|
| 95-100 | Archive/Master | Baseline |
| 85-90 | Default Export (recommended) | ~50-70% |
| 75-80 | Web/Sharing | ~40-50% |

**Default**: 90 (Lightroom standard)

### 3. Filename Template Parsing ⚠️ Needs Implementation

**Tokens Required** (from spec section 5.3):
- `{orig}` - Original filename without extension
- `{seq}` or `{seq:N}` - Sequence number with padding
- `{date}` - Capture date (optional)

**Recommended Approach**: Simple regex replacement

```typescript
interface TemplateContext {
  orig: string
  seq: number
  date?: string  // ISO format YYYY-MM-DD
}

function renderTemplate(template: string, context: TemplateContext): string {
  let result = template
  result = result.replace(/{orig}/g, context.orig)
  result = result.replace(/{seq:(\d+)}/g, (_, padWidth) =>
    context.seq.toString().padStart(parseInt(padWidth), '0'))
  result = result.replace(/{seq}(?!:)/g, context.seq.toString())
  if (context.date) {
    result = result.replace(/{date}/g, context.date)
  }
  return result
}
```

**Validation**:
```typescript
function validateTemplate(template: string): TemplateValidationError[] {
  const errors = []
  const knownTokens = ['orig', 'seq', 'date']
  // Check for mismatched braces
  // Check for unknown tokens
  // Validate {seq:N} padding width (1-10)
  return errors
}
```

**Date Handling**:
- `captureDate` field exists in Asset type but is currently null
- Use `modifiedDate` as fallback for v1
- `kamadak-exif` crate available in dependencies for future EXIF parsing

### 4. Current Codebase Infrastructure ✅ Mostly Ready

**Existing Components**:

| Component | Status | Notes |
|-----------|--------|-------|
| File Writing | ✅ Ready | `FileSystemProvider.writeFile()` exists |
| File Creation | ✅ Ready | `FileSystemProvider.createFile()` exists |
| Image Loading | ✅ Ready | Decode pipeline complete |
| Edit Application | ✅ Ready | Rotation, crop, adjustments, tone curve |
| Edit Retrieval | ⚠️ Partial | Current asset only; batch needs DB queries |
| Image Encoding | ❌ Missing | Add to WASM layer |
| Worker Communication | ✅ Ready | Pattern established |
| UI Components | ✅ Ready | Modal, button, toast patterns |
| Batch Operations | ❌ Missing | Need coordination layer |

**Edit Pipeline Flow** (existing):
```
1. Load image → decode to RGB pixels
2. Apply rotation → WASM apply_rotation()
3. Apply crop → WASM apply_crop()
4. Apply adjustments → WASM apply_adjustments()
5. Apply tone curve → WASM apply_tone_curve()
6. [NEW] Encode JPEG → WASM encode_jpeg()
7. [NEW] Write to file → FileSystemProvider.writeFile()
```

**Selection Store** (for export scope):
```typescript
const catalogStore = useCatalogStore()
const pickedAssets = Array.from(catalogStore.assets.values())
  .filter(asset => asset.flag === 'pick')
```

### 5. UI Components - Nuxt UI 4 ✅ Ready

**Modal Pattern** (from EditCopySettingsModal.vue):
```vue
<UModal v-model:open="showExportDialog" :dismissible="true">
  <template #header>Export Images</template>
  <template #body><!-- Form content --></template>
  <template #footer><!-- Action buttons --></template>
</UModal>
```

**Components to Use**:
| Element | Component | Notes |
|---------|-----------|-------|
| Modal | `UModal` | Use header/body/footer slots |
| Folder Button | `UButton` + hidden input | Use `webkitdirectory` |
| Template Input | `UInput` | Type: text |
| Quality Slider | `USlider` | Min: 0, Max: 100, Step: 5 |
| Resize Toggle | `UCheckbox` | Show UInput conditionally |
| Export Scope | `URadioGroup` | Variant: "card" |
| Progress Bar | `UProgress` | modelValue + max |
| Notifications | `useToast()` | Auto-imported |

**Toast Pattern**:
```typescript
const toast = useToast()
toast.add({
  title: 'Export complete',
  description: `${count} images exported successfully`,
  color: 'success',
})
```

## Complete Export Pipeline

```
User clicks "Export" button
    ↓
Show ExportModal (scope, folder, template, quality, resize)
    ↓
User selects destination folder (showDirectoryPicker with readwrite)
    ↓
User configures options and clicks "Export"
    ↓
Validate template (renderTemplate validation)
    ↓
For each asset in export scope:
  │
  ├─ Load edit state from database/store
  │
  ├─ Load original image bytes
  │
  ├─ Apply edits in order:
  │    ├─ Rotation (WASM apply_rotation)
  │    ├─ Crop (WASM apply_crop)
  │    ├─ Adjustments (WASM apply_adjustments)
  │    └─ Tone Curve (WASM apply_tone_curve)
  │
  ├─ Resize if enabled (WASM resize_image)
  │
  ├─ Encode to JPEG (WASM encode_jpeg) [NEW]
  │
  ├─ Generate filename (renderTemplate)
  │
  ├─ Check collision, auto-increment if needed
  │
  ├─ Write to file (FileSystemProvider.writeFile)
  │
  └─ Update progress
    ↓
Show completion toast with count
```

## Files to Create

### Rust/WASM (2 new files + 2 modified)

**New Files**:
1. `crates/literoom-core/src/encode/mod.rs` - Core encode module
2. `crates/literoom-core/src/encode/jpeg.rs` - JPEG encoding implementation

**Modified Files**:
3. `crates/literoom-core/src/lib.rs` - Export encode module
4. `crates/literoom-wasm/src/lib.rs` - Add encode binding exports
5. `crates/literoom-wasm/src/encode.rs` - WASM bindings (NEW)

### TypeScript/Core (3 new files)

6. `packages/core/src/export/filename-template.ts` - Template parser
7. `packages/core/src/export/export-service.ts` - Export coordinator
8. `packages/core/src/export/index.ts` - Module exports

### Vue/Web (3 new files + 2 modified)

**New Files**:
9. `apps/web/app/stores/export.ts` - Export state management
10. `apps/web/app/composables/useExport.ts` - Export logic composable
11. `apps/web/app/components/export/ExportModal.vue` - Export dialog

**Modified Files**:
12. `apps/web/app/pages/index.vue` - Add export button/action
13. `packages/core/src/decode/worker-messages.ts` - Add encode message type

### Tests (2 new files)

14. `packages/core/src/export/filename-template.test.ts` - Template tests
15. `crates/literoom-core/src/encode/tests.rs` - Rust encode tests

## Implementation Phases

### Phase 1: JPEG Encoding in WASM
- Add `encode` module to literoom-core
- Implement `encode_jpeg()` using image crate
- Add WASM bindings
- Add Rust tests

### Phase 2: Worker Integration
- Add encode message type to worker-messages.ts
- Update decode-worker.ts to handle encode requests
- Update DecodeService with encodeJpeg method

### Phase 3: Filename Template Parser
- Implement renderTemplate()
- Implement validateTemplate()
- Add comprehensive unit tests

### Phase 4: Export Service
- Create ExportService class
- Implement exportAssets() orchestration
- Handle batch processing with progress
- Collision detection and auto-increment

### Phase 5: UI Components
- Create export Pinia store
- Create useExport composable
- Create ExportModal component

### Phase 6: Integration
- Add export button to UI
- Wire up modal to composable
- Add keyboard shortcut (optional)
- E2E testing

## Estimated Effort

| Phase | Complexity | Files |
|-------|------------|-------|
| Phase 1: WASM Encoding | Medium | 5 |
| Phase 2: Worker Integration | Low | 2 |
| Phase 3: Template Parser | Low | 2 |
| Phase 4: Export Service | Medium | 3 |
| Phase 5: UI Components | Medium | 3 |
| Phase 6: Integration | Low | 2 |

**Total**: ~17 files, ~6 phases

## Risk Mitigation

1. **Memory for large images**: Process one image at a time, free WASM memory after each
2. **Slow exports**: Use worker pool for parallel processing (existing infrastructure)
3. **Browser compatibility**: Feature detect File System Access API, show warning on unsupported browsers
4. **Disk full errors**: Catch QuotaExceededError, show user-friendly message
5. **Permission revocation**: Re-check permission before each file write

## Conclusion

The Export workflow builds on solid existing infrastructure. The main implementation work is:
1. Adding JPEG encoding to the WASM layer (following existing patterns)
2. Creating a simple filename template parser
3. Building the UI modal and coordination service

All patterns for success are established in the codebase. This feature should be implementable with high confidence.
