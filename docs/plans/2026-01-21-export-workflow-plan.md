# Export Workflow Implementation Plan

**Created**: 2026-01-21 17:00 EST
**Based on**: `docs/research/2026-01-21-export-workflow-synthesis.md`
**Status**: Ready for Implementation

## Overview

The Export workflow is the last major v1 requirement. Users need to export edited photos as JPEGs with configurable quality, optional resizing, and customizable filename templates.

### v1 Requirements (from spec section 3.7)

- [x] Destination folder selection via folder picker
- [x] File naming template with tokens: `{orig}`, `{seq:N}`, `{date}`
- [x] JPEG quality slider
- [x] Resize option (none or long-edge pixels)
- [x] Export scope: Picks only (default), current selection, or all
- [x] Rejects excluded unless explicitly included
- [x] Collision handling: auto-increment
- [x] Progress dialog with count tracking
- [x] On completion: show destination path

## Implementation Phases

### Phase 1: JPEG Encoding in WASM

**Goal**: Add JPEG encoding capability to the Rust/WASM pipeline.

**Files to Create**:
1. `crates/literoom-core/src/encode/mod.rs`
2. `crates/literoom-core/src/encode/jpeg.rs`
3. `crates/literoom-wasm/src/encode.rs`

**Files to Modify**:
4. `crates/literoom-core/src/lib.rs` - Export encode module
5. `crates/literoom-wasm/src/lib.rs` - Add encode binding exports

**Implementation Details**:

```rust
// crates/literoom-core/src/encode/jpeg.rs
use image::{RgbImage, ImageEncoder};
use image::codecs::jpeg::JpegEncoder;

#[derive(Debug, thiserror::Error)]
pub enum EncodeError {
    #[error("Invalid pixel data: expected {expected} bytes, got {actual}")]
    InvalidPixelData { expected: usize, actual: usize },
    #[error("Encoding failed: {0}")]
    EncodingFailed(String),
}

pub fn encode_jpeg(
    pixels: &[u8],
    width: u32,
    height: u32,
    quality: u8,  // 0-100
) -> Result<Vec<u8>, EncodeError> {
    let expected_len = (width * height * 3) as usize;
    if pixels.len() != expected_len {
        return Err(EncodeError::InvalidPixelData {
            expected: expected_len,
            actual: pixels.len(),
        });
    }

    let img = RgbImage::from_raw(width, height, pixels.to_vec())
        .ok_or_else(|| EncodeError::InvalidPixelData {
            expected: expected_len,
            actual: pixels.len(),
        })?;

    let mut buffer = Vec::new();
    let encoder = JpegEncoder::new_with_quality(&mut buffer, quality.clamp(1, 100));
    encoder.encode(
        &img,
        width,
        height,
        image::ExtendedColorType::Rgb8,
    ).map_err(|e| EncodeError::EncodingFailed(e.to_string()))?;

    Ok(buffer)
}
```

```rust
// crates/literoom-wasm/src/encode.rs
use wasm_bindgen::prelude::*;
use crate::JsDecodedImage;

#[wasm_bindgen]
pub fn encode_jpeg_to_bytes(
    image: &JsDecodedImage,
    quality: u8,
) -> Result<Vec<u8>, JsValue> {
    literoom_core::encode::encode_jpeg(
        &image.pixels,
        image.width,
        image.height,
        quality,
    )
    .map_err(|e| JsValue::from_str(&e.to_string()))
}
```

**Tests**:
```rust
// crates/literoom-core/src/encode/tests.rs
#[test]
fn test_encode_jpeg_basic() {
    let width = 100;
    let height = 100;
    let pixels = vec![128u8; width * height * 3];

    let result = encode_jpeg(&pixels, width as u32, height as u32, 90);
    assert!(result.is_ok());

    let jpeg_bytes = result.unwrap();
    // Check JPEG magic bytes
    assert_eq!(&jpeg_bytes[0..2], &[0xFF, 0xD8]);
}

#[test]
fn test_encode_jpeg_quality_range() {
    let pixels = vec![128u8; 100 * 100 * 3];

    let low_q = encode_jpeg(&pixels, 100, 100, 20).unwrap();
    let high_q = encode_jpeg(&pixels, 100, 100, 95).unwrap();

    // Higher quality = larger file (generally)
    assert!(high_q.len() > low_q.len());
}
```

---

### Phase 2: Worker Integration

**Goal**: Expose JPEG encoding through the decode worker.

**Files to Modify**:
1. `packages/core/src/decode/worker-messages.ts`
2. `packages/core/src/decode/decode-worker.ts`
3. `packages/core/src/decode/decode-service.ts`
4. `packages/core/src/decode/types.ts`
5. `packages/core/src/decode/index.ts`

**Implementation Details**:

```typescript
// packages/core/src/decode/worker-messages.ts
export type DecodeRequest =
  | { type: 'decode-jpeg'; id: string; data: Uint8Array }
  | { type: 'decode-raw-thumbnail'; id: string; data: Uint8Array }
  | { type: 'resize'; id: string; data: Uint8Array; width: number; height: number; mode: ResizeMode; filter: FilterType }
  | { type: 'compute-histogram'; id: string; data: Uint8Array; width: number; height: number }
  | { type: 'apply-adjustments'; id: string; data: Uint8Array; width: number; height: number; adjustments: Adjustments }
  | { type: 'apply-tone-curve'; id: string; data: Uint8Array; width: number; height: number; points: ToneCurvePoint[] }
  | { type: 'apply-rotation'; id: string; data: Uint8Array; width: number; height: number; rotation: RotationParameters }
  | { type: 'apply-crop'; id: string; data: Uint8Array; width: number; height: number; crop: CropRectangle }
  | { type: 'encode-jpeg'; id: string; data: Uint8Array; width: number; height: number; quality: number }  // NEW

export type DecodeResponse =
  | { type: 'decoded'; id: string; data: Uint8Array; width: number; height: number }
  | { type: 'resized'; id: string; data: Uint8Array; width: number; height: number }
  | { type: 'histogram'; id: string; histogram: HistogramData }
  | { type: 'adjusted'; id: string; data: Uint8Array; width: number; height: number }
  | { type: 'rotated'; id: string; data: Uint8Array; width: number; height: number }
  | { type: 'cropped'; id: string; data: Uint8Array; width: number; height: number }
  | { type: 'encoded'; id: string; data: Uint8Array }  // NEW - JPEG bytes
  | { type: 'error'; id: string; error: string }
```

```typescript
// packages/core/src/decode/decode-worker.ts - Add handler
case 'encode-jpeg': {
  const { id, data, width, height, quality } = request
  try {
    const image = new wasm.JsDecodedImage(data, width, height)
    const jpegBytes = wasm.encode_jpeg_to_bytes(image, quality)
    image.free()

    self.postMessage({
      type: 'encoded',
      id,
      data: jpegBytes,
    } as DecodeResponse)
  } catch (err) {
    self.postMessage({
      type: 'error',
      id,
      error: String(err),
    } as DecodeResponse)
  }
  break
}
```

```typescript
// packages/core/src/decode/decode-service.ts
async encodeJpeg(
  pixels: Uint8Array,
  width: number,
  height: number,
  quality: number = 90,
): Promise<Uint8Array> {
  const id = crypto.randomUUID()

  return new Promise((resolve, reject) => {
    this.pendingRequests.set(id, { resolve, reject })

    this.worker.postMessage({
      type: 'encode-jpeg',
      id,
      data: pixels,
      width,
      height,
      quality,
    })
  })
}
```

---

### Phase 3: Filename Template Parser

**Goal**: Create a simple template parser for export filenames.

**Files to Create**:
1. `packages/core/src/export/filename-template.ts`
2. `packages/core/src/export/filename-template.test.ts`
3. `packages/core/src/export/index.ts`

**Implementation Details**:

```typescript
// packages/core/src/export/filename-template.ts
export interface TemplateContext {
  /** Original filename without extension */
  orig: string
  /** Sequence number (1-based) */
  seq: number
  /** Capture date in YYYY-MM-DD format */
  date?: string
}

export interface TemplateError {
  message: string
  position?: number
}

/**
 * Render a filename template with the given context
 *
 * Supported tokens:
 * - {orig} - Original filename without extension
 * - {seq} - Sequence number (no padding)
 * - {seq:N} - Sequence number with N-digit zero padding (e.g., {seq:4} -> 0001)
 * - {date} - Capture date in YYYY-MM-DD format
 *
 * @example
 * renderTemplate('{orig}_{seq:4}', { orig: 'DSC1234', seq: 1 })
 * // Returns: 'DSC1234_0001'
 */
export function renderTemplate(template: string, context: TemplateContext): string {
  let result = template

  // Replace {orig}
  result = result.replace(/\{orig\}/g, context.orig)

  // Replace {seq:N} with zero-padded number
  result = result.replace(/\{seq:(\d+)\}/g, (_, padWidth) => {
    const width = parseInt(padWidth, 10)
    return context.seq.toString().padStart(width, '0')
  })

  // Replace {seq} without padding
  result = result.replace(/\{seq\}/g, context.seq.toString())

  // Replace {date}
  if (context.date) {
    result = result.replace(/\{date\}/g, context.date)
  } else {
    result = result.replace(/\{date\}/g, '')
  }

  return result
}

/**
 * Validate a filename template
 *
 * @returns Array of validation errors (empty if valid)
 */
export function validateTemplate(template: string): TemplateError[] {
  const errors: TemplateError[] = []

  // Check for empty template
  if (!template.trim()) {
    errors.push({ message: 'Template cannot be empty' })
    return errors
  }

  // Check for unmatched braces
  const openBraces = (template.match(/\{/g) || []).length
  const closeBraces = (template.match(/\}/g) || []).length
  if (openBraces !== closeBraces) {
    errors.push({ message: 'Unmatched braces in template' })
  }

  // Check for unknown tokens
  const tokenRegex = /\{([^}]+)\}/g
  let match
  while ((match = tokenRegex.exec(template)) !== null) {
    const token = match[1]
    if (token !== 'orig' && token !== 'date' && !token.match(/^seq(:\d+)?$/)) {
      errors.push({
        message: `Unknown token: {${token}}`,
        position: match.index,
      })
    }
  }

  // Validate {seq:N} padding width (1-10)
  const seqPadRegex = /\{seq:(\d+)\}/g
  while ((match = seqPadRegex.exec(template)) !== null) {
    const width = parseInt(match[1], 10)
    if (width < 1 || width > 10) {
      errors.push({
        message: `Sequence padding must be 1-10 digits, got ${width}`,
        position: match.index,
      })
    }
  }

  // Check for invalid filename characters
  const rendered = renderTemplate(template, { orig: 'test', seq: 1, date: '2026-01-21' })
  const invalidChars = /[<>:"/\\|?*]/
  if (invalidChars.test(rendered)) {
    errors.push({ message: 'Template contains invalid filename characters' })
  }

  return errors
}

/**
 * Extract the original filename from a full path/filename
 */
export function extractOriginalFilename(filename: string): string {
  // Remove path
  const basename = filename.split(/[/\\]/).pop() || filename
  // Remove extension
  const lastDot = basename.lastIndexOf('.')
  return lastDot > 0 ? basename.substring(0, lastDot) : basename
}
```

**Tests**:
```typescript
// packages/core/src/export/filename-template.test.ts
import { describe, it, expect } from 'vitest'
import { renderTemplate, validateTemplate, extractOriginalFilename } from './filename-template'

describe('renderTemplate', () => {
  it('replaces {orig} token', () => {
    expect(renderTemplate('{orig}', { orig: 'DSC1234', seq: 1 }))
      .toBe('DSC1234')
  })

  it('replaces {seq} token without padding', () => {
    expect(renderTemplate('{seq}', { orig: 'test', seq: 42 }))
      .toBe('42')
  })

  it('replaces {seq:N} token with zero padding', () => {
    expect(renderTemplate('{seq:4}', { orig: 'test', seq: 1 }))
      .toBe('0001')
    expect(renderTemplate('{seq:4}', { orig: 'test', seq: 999 }))
      .toBe('0999')
    expect(renderTemplate('{seq:4}', { orig: 'test', seq: 10000 }))
      .toBe('10000')
  })

  it('replaces {date} token', () => {
    expect(renderTemplate('{date}', { orig: 'test', seq: 1, date: '2026-01-21' }))
      .toBe('2026-01-21')
  })

  it('handles missing date', () => {
    expect(renderTemplate('{date}', { orig: 'test', seq: 1 }))
      .toBe('')
  })

  it('handles complex templates', () => {
    expect(renderTemplate('{orig}_{date}_{seq:3}', {
      orig: 'DSC1234',
      seq: 7,
      date: '2026-01-21'
    }))
      .toBe('DSC1234_2026-01-21_007')
  })

  it('preserves static text', () => {
    expect(renderTemplate('photo-{seq:4}-final', { orig: 'test', seq: 42 }))
      .toBe('photo-0042-final')
  })
})

describe('validateTemplate', () => {
  it('accepts valid templates', () => {
    expect(validateTemplate('{orig}')).toEqual([])
    expect(validateTemplate('{orig}_{seq:4}')).toEqual([])
    expect(validateTemplate('{date}_{orig}_{seq}')).toEqual([])
  })

  it('rejects empty template', () => {
    expect(validateTemplate('')).toHaveLength(1)
    expect(validateTemplate('   ')).toHaveLength(1)
  })

  it('rejects unmatched braces', () => {
    expect(validateTemplate('{orig')).toHaveLength(1)
    expect(validateTemplate('orig}')).toHaveLength(1)
  })

  it('rejects unknown tokens', () => {
    const errors = validateTemplate('{unknown}')
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('Unknown token')
  })

  it('rejects invalid padding width', () => {
    expect(validateTemplate('{seq:0}')).toHaveLength(1)
    expect(validateTemplate('{seq:11}')).toHaveLength(1)
  })
})

describe('extractOriginalFilename', () => {
  it('removes extension', () => {
    expect(extractOriginalFilename('DSC1234.ARW')).toBe('DSC1234')
    expect(extractOriginalFilename('photo.jpeg')).toBe('photo')
  })

  it('removes path', () => {
    expect(extractOriginalFilename('/path/to/DSC1234.ARW')).toBe('DSC1234')
    expect(extractOriginalFilename('C:\\photos\\DSC1234.ARW')).toBe('DSC1234')
  })

  it('handles multiple dots', () => {
    expect(extractOriginalFilename('file.name.ext')).toBe('file.name')
  })

  it('handles no extension', () => {
    expect(extractOriginalFilename('filename')).toBe('filename')
  })
})
```

---

### Phase 4: Export Service

**Goal**: Create the export service to coordinate the export pipeline.

**Files to Create**:
1. `packages/core/src/export/export-service.ts`
2. `packages/core/src/export/types.ts`

**Files to Modify**:
3. `packages/core/src/export/index.ts` - Add new exports

**Implementation Details**:

```typescript
// packages/core/src/export/types.ts
import type { Asset } from '../catalog/types'

export type ExportScope = 'picks' | 'selected' | 'all'

export interface ExportOptions {
  /** Destination folder handle */
  destinationHandle: FileSystemDirectoryHandle
  /** Filename template (e.g., '{orig}_{seq:4}') */
  filenameTemplate: string
  /** JPEG quality (0-100, default 90) */
  quality: number
  /** Resize to long edge pixels (0 = no resize) */
  resizeLongEdge: number
  /** Export scope */
  scope: ExportScope
  /** Include rejected images (default false) */
  includeRejected?: boolean
  /** Start sequence number (default 1) */
  startSequence?: number
}

export interface ExportProgress {
  /** Total number of images to export */
  total: number
  /** Current image index (1-based) */
  current: number
  /** Current filename being processed */
  currentFilename: string
  /** Whether export is complete */
  complete: boolean
  /** Error message if failed */
  error?: string
}

export interface ExportResult {
  /** Number of images successfully exported */
  successCount: number
  /** Number of images that failed */
  failureCount: number
  /** List of failed exports with error messages */
  failures: Array<{ assetId: string; filename: string; error: string }>
  /** Destination folder path (for display) */
  destinationPath: string
}
```

```typescript
// packages/core/src/export/export-service.ts
import type { Asset, EditState, CropRectangle, RotationParameters, ToneCurvePoint, Adjustments } from '../catalog/types'
import type { IDecodeService } from '../decode/types'
import type { ExportOptions, ExportProgress, ExportResult } from './types'
import { renderTemplate, extractOriginalFilename } from './filename-template'

export interface ExportServiceDependencies {
  decodeService: IDecodeService
  getEditState: (assetId: string) => Promise<EditState | null>
  loadImageBytes: (asset: Asset) => Promise<Uint8Array>
}

export class ExportService {
  constructor(private deps: ExportServiceDependencies) {}

  /**
   * Export assets to the destination folder
   *
   * @param assets - Assets to export
   * @param options - Export options
   * @param onProgress - Progress callback
   */
  async exportAssets(
    assets: Asset[],
    options: ExportOptions,
    onProgress?: (progress: ExportProgress) => void,
  ): Promise<ExportResult> {
    const { decodeService, getEditState, loadImageBytes } = this.deps
    const {
      destinationHandle,
      filenameTemplate,
      quality,
      resizeLongEdge,
      startSequence = 1,
    } = options

    const result: ExportResult = {
      successCount: 0,
      failureCount: 0,
      failures: [],
      destinationPath: destinationHandle.name,
    }

    const usedFilenames = new Set<string>()

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i]
      const seq = startSequence + i

      // Report progress
      const origFilename = extractOriginalFilename(asset.filename)
      onProgress?.({
        total: assets.length,
        current: i + 1,
        currentFilename: asset.filename,
        complete: false,
      })

      try {
        // 1. Load original image
        const imageBytes = await loadImageBytes(asset)

        // 2. Decode image
        let decoded = await decodeService.decodeImage(imageBytes, asset.filename)

        // 3. Get edit state
        const editState = await getEditState(asset.id)

        // 4. Apply edits if present
        if (editState) {
          // Apply rotation
          if (editState.rotation && editState.rotation.angle !== 0) {
            decoded = await decodeService.applyRotation(
              decoded.data,
              decoded.width,
              decoded.height,
              editState.rotation,
            )
          }

          // Apply crop
          if (editState.crop) {
            decoded = await decodeService.applyCrop(
              decoded.data,
              decoded.width,
              decoded.height,
              editState.crop,
            )
          }

          // Apply adjustments
          if (editState.adjustments) {
            decoded = await decodeService.applyAdjustments(
              decoded.data,
              decoded.width,
              decoded.height,
              editState.adjustments,
            )
          }

          // Apply tone curve
          if (editState.toneCurve && editState.toneCurve.length > 0) {
            decoded = await decodeService.applyToneCurve(
              decoded.data,
              decoded.width,
              decoded.height,
              editState.toneCurve,
            )
          }
        }

        // 5. Resize if requested
        if (resizeLongEdge > 0) {
          const longEdge = Math.max(decoded.width, decoded.height)
          if (longEdge > resizeLongEdge) {
            const scale = resizeLongEdge / longEdge
            const newWidth = Math.round(decoded.width * scale)
            const newHeight = Math.round(decoded.height * scale)
            decoded = await decodeService.resize(
              decoded.data,
              decoded.width,
              decoded.height,
              newWidth,
              newHeight,
              'fit',
              'lanczos3',
            )
          }
        }

        // 6. Encode to JPEG
        const jpegBytes = await decodeService.encodeJpeg(
          decoded.data,
          decoded.width,
          decoded.height,
          quality,
        )

        // 7. Generate filename with collision handling
        const date = asset.captureDate
          ? asset.captureDate.toISOString().split('T')[0]
          : asset.modifiedDate?.toISOString().split('T')[0]

        let baseFilename = renderTemplate(filenameTemplate, {
          orig: origFilename,
          seq,
          date,
        })

        // Ensure .jpg extension
        if (!baseFilename.toLowerCase().endsWith('.jpg') &&
            !baseFilename.toLowerCase().endsWith('.jpeg')) {
          baseFilename += '.jpg'
        }

        // Handle collisions
        let finalFilename = baseFilename
        let collisionCount = 0
        while (usedFilenames.has(finalFilename.toLowerCase()) ||
               await this.fileExists(destinationHandle, finalFilename)) {
          collisionCount++
          const ext = finalFilename.substring(finalFilename.lastIndexOf('.'))
          const base = finalFilename.substring(0, finalFilename.lastIndexOf('.'))
          finalFilename = `${base}_${collisionCount}${ext}`
        }
        usedFilenames.add(finalFilename.toLowerCase())

        // 8. Write file
        const fileHandle = await destinationHandle.getFileHandle(finalFilename, { create: true })
        const writable = await fileHandle.createWritable()
        await writable.write(new Blob([jpegBytes], { type: 'image/jpeg' }))
        await writable.close()

        result.successCount++

      } catch (error) {
        result.failureCount++
        result.failures.push({
          assetId: asset.id,
          filename: asset.filename,
          error: String(error),
        })
      }
    }

    // Final progress
    onProgress?.({
      total: assets.length,
      current: assets.length,
      currentFilename: '',
      complete: true,
    })

    return result
  }

  private async fileExists(
    dirHandle: FileSystemDirectoryHandle,
    filename: string,
  ): Promise<boolean> {
    try {
      await dirHandle.getFileHandle(filename, { create: false })
      return true
    } catch (error) {
      return (error as Error).name !== 'NotFoundError'
    }
  }
}
```

---

### Phase 5: UI Components

**Goal**: Create the Pinia store, composable, and modal for export.

**Files to Create**:
1. `apps/web/app/stores/export.ts`
2. `apps/web/app/composables/useExport.ts`
3. `apps/web/app/components/export/ExportModal.vue`

**Implementation Details**:

```typescript
// apps/web/app/stores/export.ts
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { ExportScope, ExportProgress } from '@literoom/core'

export const useExportStore = defineStore('export', () => {
  // Modal state
  const isModalOpen = ref(false)

  // Export options
  const destinationHandle = ref<FileSystemDirectoryHandle | null>(null)
  const destinationName = ref<string>('')
  const filenameTemplate = ref('{orig}_{seq:4}')
  const quality = ref(90)
  const resizeLongEdge = ref(0) // 0 = no resize
  const scope = ref<ExportScope>('picks')
  const includeRejected = ref(false)

  // Progress state
  const isExporting = ref(false)
  const progress = ref<ExportProgress | null>(null)

  // Actions
  function openModal() {
    isModalOpen.value = true
  }

  function closeModal() {
    isModalOpen.value = false
  }

  function setDestination(handle: FileSystemDirectoryHandle) {
    destinationHandle.value = handle
    destinationName.value = handle.name
  }

  function clearDestination() {
    destinationHandle.value = null
    destinationName.value = ''
  }

  function setProgress(p: ExportProgress | null) {
    progress.value = p
    isExporting.value = p !== null && !p.complete
  }

  function reset() {
    destinationHandle.value = null
    destinationName.value = ''
    filenameTemplate.value = '{orig}_{seq:4}'
    quality.value = 90
    resizeLongEdge.value = 0
    scope.value = 'picks'
    includeRejected.value = false
    progress.value = null
    isExporting.value = false
  }

  // Computed
  const isValid = computed(() => {
    return destinationHandle.value !== null && filenameTemplate.value.trim() !== ''
  })

  return {
    // State
    isModalOpen,
    destinationHandle,
    destinationName,
    filenameTemplate,
    quality,
    resizeLongEdge,
    scope,
    includeRejected,
    isExporting,
    progress,
    isValid,

    // Actions
    openModal,
    closeModal,
    setDestination,
    clearDestination,
    setProgress,
    reset,
  }
})
```

```typescript
// apps/web/app/composables/useExport.ts
import { useCatalogStore } from '~/stores/catalog'
import { useEditStore } from '~/stores/edit'
import { useExportStore } from '~/stores/export'
import { useCatalog } from '~/composables/useCatalog'
import { ExportService, validateTemplate } from '@literoom/core'
import type { Asset, ExportOptions, ExportResult } from '@literoom/core'

export function useExport() {
  const catalogStore = useCatalogStore()
  const editStore = useEditStore()
  const exportStore = useExportStore()
  const { catalogService, decodeService } = useCatalog()
  const toast = useToast()

  /**
   * Get assets to export based on current scope
   */
  function getAssetsToExport(): Asset[] {
    const allAssets = Array.from(catalogStore.assets.values())

    switch (exportStore.scope) {
      case 'picks':
        return allAssets.filter(a => a.flag === 'pick')
      case 'selected':
        // Use selection store if available
        return allAssets.filter(a => catalogStore.selectedIds.has(a.id))
      case 'all':
        if (exportStore.includeRejected) {
          return allAssets
        }
        return allAssets.filter(a => a.flag !== 'reject')
    }
  }

  /**
   * Select destination folder
   */
  async function selectDestination(): Promise<boolean> {
    try {
      const handle = await window.showDirectoryPicker({
        mode: 'readwrite',
        id: 'photo-export',
        startIn: 'pictures',
      })
      exportStore.setDestination(handle)
      return true
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        toast.add({
          title: 'Could not select folder',
          description: String(error),
          color: 'error',
        })
      }
      return false
    }
  }

  /**
   * Run the export
   */
  async function runExport(): Promise<ExportResult | null> {
    const { destinationHandle, filenameTemplate, quality, resizeLongEdge, scope, includeRejected } = exportStore

    if (!destinationHandle) {
      toast.add({
        title: 'No destination selected',
        description: 'Please select a destination folder',
        color: 'warning',
      })
      return null
    }

    // Validate template
    const templateErrors = validateTemplate(filenameTemplate)
    if (templateErrors.length > 0) {
      toast.add({
        title: 'Invalid filename template',
        description: templateErrors[0].message,
        color: 'error',
      })
      return null
    }

    const assets = getAssetsToExport()
    if (assets.length === 0) {
      toast.add({
        title: 'No images to export',
        description: scope === 'picks'
          ? 'No images are marked as picks'
          : 'No images selected',
        color: 'warning',
      })
      return null
    }

    // Create export service
    const exportService = new ExportService({
      decodeService: decodeService!,
      getEditState: async (assetId: string) => {
        // Get from store or database
        if (editStore.currentAssetId === assetId) {
          return {
            adjustments: editStore.adjustments,
            toneCurve: editStore.toneCurve,
            crop: editStore.crop,
            rotation: editStore.rotation,
          }
        }
        // Load from database
        return catalogService!.getEditState(assetId)
      },
      loadImageBytes: async (asset: Asset) => {
        return catalogService!.loadAssetBytes(asset)
      },
    })

    try {
      const result = await exportService.exportAssets(
        assets,
        {
          destinationHandle,
          filenameTemplate,
          quality,
          resizeLongEdge,
          scope,
          includeRejected,
        },
        (progress) => {
          exportStore.setProgress(progress)
        },
      )

      // Show result
      if (result.failureCount === 0) {
        toast.add({
          title: 'Export complete',
          description: `${result.successCount} images exported to ${result.destinationPath}`,
          color: 'success',
        })
      } else {
        toast.add({
          title: 'Export completed with errors',
          description: `${result.successCount} succeeded, ${result.failureCount} failed`,
          color: 'warning',
        })
      }

      exportStore.closeModal()
      return result

    } catch (error) {
      toast.add({
        title: 'Export failed',
        description: String(error),
        color: 'error',
      })
      return null
    } finally {
      exportStore.setProgress(null)
    }
  }

  return {
    getAssetsToExport,
    selectDestination,
    runExport,
  }
}
```

```vue
<!-- apps/web/app/components/export/ExportModal.vue -->
<script setup lang="ts">
import { useExportStore } from '~/stores/export'
import { useExport } from '~/composables/useExport'
import { validateTemplate } from '@literoom/core'

const exportStore = useExportStore()
const { getAssetsToExport, selectDestination, runExport } = useExport()

const templateErrors = computed(() => {
  return validateTemplate(exportStore.filenameTemplate)
})

const assetCount = computed(() => {
  return getAssetsToExport().length
})

const scopeOptions = [
  { value: 'picks', label: 'Picks only', description: 'Export only images marked as picks' },
  { value: 'selected', label: 'Selected', description: 'Export currently selected images' },
  { value: 'all', label: 'All images', description: 'Export all images in catalog' },
]

const presetSizes = [
  { value: 0, label: 'Original size' },
  { value: 2048, label: '2048px (Social media)' },
  { value: 3840, label: '3840px (4K)' },
  { value: 5120, label: '5120px (5K)' },
]

async function handleExport() {
  await runExport()
}
</script>

<template>
  <UModal v-model:open="exportStore.isModalOpen" :dismissible="!exportStore.isExporting">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-heroicons-arrow-up-tray" />
        <span>Export Images</span>
      </div>
    </template>

    <template #body>
      <div class="space-y-6">
        <!-- Destination -->
        <div>
          <label class="block text-sm font-medium mb-2">Destination Folder</label>
          <div class="flex gap-2">
            <UInput
              :model-value="exportStore.destinationName || 'No folder selected'"
              readonly
              class="flex-1"
            />
            <UButton
              @click="selectDestination"
              :disabled="exportStore.isExporting"
            >
              Choose Folder
            </UButton>
          </div>
        </div>

        <!-- Filename Template -->
        <div>
          <label class="block text-sm font-medium mb-2">Filename Template</label>
          <UInput
            v-model="exportStore.filenameTemplate"
            placeholder="{orig}_{seq:4}"
            :disabled="exportStore.isExporting"
          />
          <p class="text-xs text-gray-500 mt-1">
            Tokens: {orig} = original name, {seq:4} = sequence with padding, {date} = capture date
          </p>
          <p v-if="templateErrors.length > 0" class="text-xs text-red-500 mt-1">
            {{ templateErrors[0].message }}
          </p>
        </div>

        <!-- Export Scope -->
        <div>
          <label class="block text-sm font-medium mb-2">Export Scope</label>
          <URadioGroup
            v-model="exportStore.scope"
            :options="scopeOptions"
            :disabled="exportStore.isExporting"
          />
          <p class="text-sm text-gray-500 mt-2">
            {{ assetCount }} image{{ assetCount === 1 ? '' : 's' }} will be exported
          </p>
        </div>

        <!-- Quality -->
        <div>
          <label class="block text-sm font-medium mb-2">
            JPEG Quality: {{ exportStore.quality }}
          </label>
          <USlider
            v-model="exportStore.quality"
            :min="50"
            :max="100"
            :step="5"
            :disabled="exportStore.isExporting"
          />
        </div>

        <!-- Resize -->
        <div>
          <label class="block text-sm font-medium mb-2">Resize (Long Edge)</label>
          <USelect
            v-model="exportStore.resizeLongEdge"
            :options="presetSizes"
            option-attribute="label"
            value-attribute="value"
            :disabled="exportStore.isExporting"
          />
        </div>

        <!-- Progress -->
        <div v-if="exportStore.progress">
          <label class="block text-sm font-medium mb-2">
            Exporting {{ exportStore.progress.current }} of {{ exportStore.progress.total }}
          </label>
          <UProgress
            :model-value="exportStore.progress.current"
            :max="exportStore.progress.total"
          />
          <p class="text-xs text-gray-500 mt-1">
            {{ exportStore.progress.currentFilename }}
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          variant="ghost"
          @click="exportStore.closeModal"
          :disabled="exportStore.isExporting"
        >
          Cancel
        </UButton>
        <UButton
          @click="handleExport"
          :disabled="!exportStore.isValid || exportStore.isExporting || assetCount === 0"
          :loading="exportStore.isExporting"
        >
          Export {{ assetCount }} Image{{ assetCount === 1 ? '' : 's' }}
        </UButton>
      </div>
    </template>
  </UModal>
</template>
```

---

### Phase 6: Integration

**Goal**: Wire up export to the UI and add keyboard shortcut.

**Files to Modify**:
1. `apps/web/app/pages/index.vue` - Add export button to filter bar
2. `apps/web/app/components/catalog/FilterBar.vue` - Add export button

**Implementation Details**:

```vue
<!-- In FilterBar.vue, add export button -->
<UButton
  icon="i-heroicons-arrow-up-tray"
  variant="ghost"
  @click="exportStore.openModal"
  :disabled="pickCount === 0"
>
  Export
</UButton>
```

```vue
<!-- In index.vue, add modal and keyboard handler -->
<script setup lang="ts">
import { useExportStore } from '~/stores/export'

const exportStore = useExportStore()

// Add to existing keyboard handler
function handleKeydown(event: KeyboardEvent) {
  // ... existing handlers ...

  // Cmd/Ctrl+E for export
  if ((event.metaKey || event.ctrlKey) && event.key === 'e') {
    event.preventDefault()
    exportStore.openModal()
  }
}
</script>

<template>
  <!-- Add modal at end of template -->
  <ExportModal />
</template>
```

---

## Summary

| Phase | Description | Files | Status |
|-------|-------------|-------|--------|
| Phase 1 | JPEG Encoding in WASM | 5 | ✅ Complete |
| Phase 2 | Worker Integration | 5 | ✅ Complete |
| Phase 3 | Filename Template Parser | 3 | ✅ Complete |
| Phase 4 | Export Service | 3 | ✅ Complete |
| Phase 5 | UI Components | 3 | Pending |
| Phase 6 | Integration | 2 | Pending |

**Total**: ~21 files across 6 phases

## Testing Strategy

1. **Unit Tests**:
   - Rust encode module tests
   - Filename template parser tests
   - Export service mock tests

2. **Integration Tests**:
   - WASM binding tests
   - Worker communication tests

3. **E2E Tests** (demo mode):
   - Open export modal
   - Configure options
   - Mock export operation
   - Verify toast notification

## Dependencies

- Existing: `image` crate (for JPEG encoding)
- No new dependencies required
