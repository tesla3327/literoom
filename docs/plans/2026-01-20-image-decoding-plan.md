# Implementation Plan: Image Decoding Pipeline

**Date**: 2026-01-20
**Status**: In Progress
**Research**: [2026-01-20-image-decoding-synthesis.md](../research/2026-01-20-image-decoding-synthesis.md)
**Priority**: Critical (core functionality)

## Objective

Implement a complete image decoding pipeline in Rust/WASM that:
1. Decodes JPEG files
2. Extracts embedded JPEG thumbnails from Sony ARW files (fast path)
3. Performs full RAW decoding with demosaicing (quality path)
4. Exposes these capabilities via WASM bindings for use in Web Workers

---

## Phase 1: Dependencies and Core Types ✅ COMPLETE

### 1.1 Add Required Dependencies

- [x] Add `image` crate to `literoom-core` (JPEG decoding, resize)
- [x] Add `rawloader` crate to `literoom-core` (RAW file parsing)
- [x] Add `kamadak-exif` for EXIF metadata extraction
- [x] Configure features to minimize WASM bundle size

**Cargo.toml additions:**
```toml
[dependencies]
image = { version = "0.25", default-features = false, features = ["jpeg", "png"] }
rawloader = "0.37"
kamadak-exif = "0.5"
thiserror = "2.0"
```

### 1.2 Define Core Types

- [x] Create `DecodedImage` struct (width, height, RGB pixels)
- [x] Create `ImageMetadata` struct (dimensions, date, orientation, camera)
- [x] Create `DecodeError` enum (InvalidFormat, UnsupportedCamera, CorruptedFile, OutOfMemory)
- [x] Create `FilterType` enum for resize algorithms (Nearest, Bilinear, Lanczos3)
- [x] Create `Orientation` enum for EXIF orientation handling

**File:** `crates/literoom-core/src/decode/types.rs`

---

## Phase 2: JPEG Decoding ✅ COMPLETE

### 2.1 Implement JPEG Decoder

- [x] Create `decode_jpeg(bytes: &[u8]) -> Result<DecodedImage, DecodeError>`
- [x] Handle EXIF orientation during decode
- [x] Return RGB pixel buffer

**File:** `crates/literoom-core/src/decode/jpeg.rs`

### 2.2 Unit Tests

- [x] Test decoding valid JPEG
- [x] Test handling invalid/corrupt JPEG
- [x] Test orientation handling (rotated images)

---

## Phase 3: RAW Thumbnail Extraction (Fast Path) ✅ COMPLETE

### 3.1 Implement Embedded JPEG Extraction

- [x] Create `extract_raw_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, DecodeError>`
- [x] Parse TIFF structure to find embedded JPEG (custom implementation - rawloader doesn't expose previews)
- [x] Locate and extract embedded JPEG from SubIFD, IFD1, or via marker scanning
- [x] Return raw JPEG bytes (for further decode/resize)
- [x] Add `decode_raw_thumbnail()` convenience function
- [x] Add `is_raw_file()` header detection
- [x] Add `get_raw_camera_info()` for make/model extraction

**File:** `crates/literoom-core/src/decode/raw_thumbnail.rs`

### 3.2 Unit Tests

- [x] Test header detection (TIFF LE/BE)
- [x] Test handling non-RAW files (JPEG rejection)
- [x] Test invalid/empty data handling
- [x] Test byte order parsing (u16/u32)
- [ ] Test extraction from valid ARW file (requires test fixtures)

---

## Phase 4: Full RAW Decoding (Quality Path)

### 4.1 Implement RAW Decoder

- [ ] Create `decode_raw(bytes: &[u8]) -> Result<DecodedImage, DecodeError>`
- [ ] Use rawloader to get raw pixel data
- [ ] Extract CFA (Color Filter Array) pattern
- [ ] Extract color matrices for color correction

**File:** `crates/literoom-core/src/decode/raw.rs`

### 4.2 Implement Bilinear Demosaicing

- [ ] Create `demosaic_bilinear(raw: &RawImage) -> DecodedImage`
- [ ] Handle RGGB Bayer pattern (Sony standard)
- [ ] Handle edge pixels correctly
- [ ] Apply basic white balance

**File:** `crates/literoom-core/src/decode/demosaic.rs`

### 4.3 Color Space Conversion

- [ ] Apply camera color matrix (raw → XYZ)
- [ ] Convert XYZ → sRGB
- [ ] Apply gamma correction

**File:** `crates/literoom-core/src/decode/color.rs`

### 4.4 Unit Tests

- [ ] Test demosaic produces correct dimensions
- [ ] Test white balance application
- [ ] Test color matrix application
- [ ] Property test: output always valid RGB (0-255)

---

## Phase 5: Image Resizing ✅ COMPLETE

### 5.1 Implement Resize Functions

- [x] Create `resize(image: &DecodedImage, width: u32, height: u32, filter: FilterType) -> DecodedImage`
- [x] Create `resize_to_fit(image: &DecodedImage, max_edge: u32, filter: FilterType) -> DecodedImage`
- [x] Use `image` crate's `imageops::resize()`

**File:** `crates/literoom-core/src/decode/resize.rs`

### 5.2 Implement Thumbnail Generation

- [x] Create `generate_thumbnail(image: &DecodedImage, size: u32) -> DecodedImage`
- [x] Use bilinear filter for speed
- [x] Target ~256px for grid thumbnails

### 5.3 Unit Tests

- [x] Test basic resize operations (16 tests)
- [x] Test aspect ratio preservation
- [x] Test all filter types
- [x] Test error handling (zero dimensions)

---

## Phase 6: WASM Bindings

### 6.1 Create WASM API

- [ ] Expose `decode_jpeg(bytes: &[u8]) -> Result<JsDecodedImage, JsValue>`
- [ ] Expose `extract_raw_thumbnail(bytes: &[u8]) -> Result<Uint8Array, JsValue>`
- [ ] Expose `decode_raw(bytes: &[u8]) -> Result<JsDecodedImage, JsValue>`
- [ ] Expose `resize(image: JsDecodedImage, width: u32, height: u32, filter: u8) -> JsDecodedImage`

**File:** `crates/literoom-wasm/src/decode.rs`

### 6.2 Create JS-Friendly Wrapper Types

- [ ] Create `JsDecodedImage` with `width()`, `height()`, `pixels()` accessors
- [ ] Pixels returned as `Uint8Array` view into WASM memory (no copy)
- [ ] Implement proper memory cleanup via `Drop`

### 6.3 Build WASM Package

- [ ] Configure wasm-pack build
- [ ] Generate TypeScript type definitions
- [ ] Output to `packages/wasm/`

---

## Phase 7: TypeScript Integration

### 7.1 Create Decode Service

- [ ] Create `DecodeService` class in `packages/core/src/decode/`
- [ ] Implement worker-based architecture
- [ ] Handle WASM initialization

**File:** `packages/core/src/decode/decode-service.ts`

### 7.2 Create Web Worker

- [ ] Create dedicated decode worker
- [ ] Load and initialize WASM module
- [ ] Handle message passing for decode requests
- [ ] Implement request/response correlation

**File:** `packages/core/src/decode/decode-worker.ts`

### 7.3 TypeScript Types

- [ ] Create `DecodedImage` interface
- [ ] Create `DecodeRequest` and `DecodeResponse` types
- [ ] Create `ThumbnailOptions` and `PreviewOptions` types

**File:** `packages/core/src/decode/types.ts`

---

## Phase 8: Integration Testing

### 8.1 Rust Integration Tests

- [ ] Test full pipeline: ARW → thumbnail
- [ ] Test full pipeline: ARW → preview
- [ ] Test full pipeline: JPEG → thumbnail
- [ ] Performance benchmarks (optional)

### 8.2 WASM Integration Tests

- [ ] Test WASM module loads in Node.js
- [ ] Test decode functions work from JS
- [ ] Test memory is properly released

---

## File Structure (Target)

```
crates/literoom-core/src/
├── lib.rs
├── decode/
│   ├── mod.rs
│   ├── types.rs
│   ├── jpeg.rs
│   ├── raw.rs
│   ├── raw_thumbnail.rs
│   ├── demosaic.rs
│   ├── color.rs
│   └── resize.rs
└── ...

crates/literoom-wasm/src/
├── lib.rs
└── decode.rs

packages/core/src/
├── decode/
│   ├── index.ts
│   ├── types.ts
│   ├── decode-service.ts
│   └── decode-worker.ts
└── ...
```

---

## Performance Targets

| Operation | Target Time | Notes |
|-----------|-------------|-------|
| Thumbnail extraction (ARW) | <50ms | Embedded JPEG only |
| JPEG decode (4000x3000) | <150ms | Single-threaded WASM |
| Full RAW decode (24MP) | <2000ms | Including demosaic |
| Resize 6000→2560 | <300ms | Lanczos3 |
| Resize 6000→256 | <50ms | Bilinear |

---

## Completion Criteria

- [ ] Can decode JPEG files to RGB pixel buffer
- [ ] Can extract embedded thumbnail from Sony ARW files
- [ ] Can fully decode Sony ARW with demosaicing
- [ ] WASM bindings compile and work from JavaScript
- [ ] Web Worker integration functional
- [ ] All unit tests pass
- [ ] Memory usage stays within bounds (single image at a time)

---

## Risk Mitigation

1. **rawloader compatibility**: If rawloader doesn't support specific ARW variants, fallback to LibRaw-WASM
2. **Performance**: If WASM is too slow, investigate SIMD or WebAssembly threads
3. **Memory**: Implement progressive decoding if memory pressure is too high

---

## Implementation Order

1. **Phase 1**: Dependencies and types (foundation)
2. **Phase 2**: JPEG decoding (simplest, validates pipeline)
3. **Phase 3**: Thumbnail extraction (critical for UX)
4. **Phase 5**: Resizing (needed for thumbnails)
5. **Phase 6**: WASM bindings (integrate with JS)
6. **Phase 4**: Full RAW decode (most complex)
7. **Phase 7**: TypeScript integration
8. **Phase 8**: Integration testing
