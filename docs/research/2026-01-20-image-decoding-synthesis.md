# Research Synthesis: Image Decoding Pipeline

**Date**: 2026-01-20
**Status**: Complete
**Research Plan**: [2026-01-20-image-decoding-research-plan.md](./2026-01-20-image-decoding-research-plan.md)

## Executive Summary

This document synthesizes research findings for implementing a JPEG and Sony ARW RAW decoding pipeline in Rust/WASM. The recommended approach uses native Rust crates for maximum control and performance, with a two-path strategy: fast embedded JPEG extraction for thumbnails, and full demosaicing for quality previews.

---

## 1. Library Recommendations

### 1.1 JPEG Decoding

**Recommended: `image` crate**

The [image-rs/image](https://github.com/image-rs/image) crate is the most mature and widely-used option:

- Built-in JPEG encoding/decoding
- Well-tested WASM support
- Comprehensive image operations (resize, rotate, color adjustment)
- Active maintenance

**Configuration for WASM:**
```toml
[dependencies.image]
version = "0.25"
default-features = false
features = ["jpeg", "png"]  # Only enable needed formats
```

> **Important**: Disable default features to avoid multithreading issues in WASM. The default configuration enables multithreading which causes problems in single-threaded WASM environments.

**Alternative: `jpeg-decoder`**
- Lighter weight, JPEG-only
- ~24-36 CPU cycles per pixel in WASM (benchmark: 12 seconds for 1000 1024x1024 JPEGs)
- [lib.rs/crates/jpeg-decoder](https://lib.rs/crates/jpeg-decoder)

### 1.2 RAW File Decoding (Sony ARW)

**Recommended: `rawloader`**

The [pedrocr/rawloader](https://github.com/pedrocr/rawloader) crate is the best pure-Rust option:

- Supports 20+ camera formats including Sony ARW, SR2, SRF
- Extracts raw pixel data and metadata
- Provides camera color matrices for color space conversion
- LGPL-2.1 license
- 726+ commits, actively maintained

```toml
[dependencies]
rawloader = "0.37"
```

**Alternative: `rawler`**
- Fork/evolution of rawloader concepts
- Powers DNGLab
- Version 0.7.1 (October 2025)
- [lib.rs/crates/rawler](https://lib.rs/crates/rawler)

**Alternative: LibRaw-WASM**

If pure-Rust proves insufficient, LibRaw WASM ports exist:
- [ssssota/libraw.wasm](https://github.com/ssssota/libraw.wasm) - TypeScript-focused, MIT license
- [ybouane/LibRaw-Wasm](https://github.com/ybouane/LibRaw-Wasm) - Web Worker integration
- [discere-os/LibRaw.wasm](https://github.com/discere-os/LibRaw.wasm) - SIMD optimizations

These are C++ LibRaw compiled via Emscripten, not native Rust.

### 1.3 EXIF/Metadata Extraction

**Recommended: `kamadak-exif` or `exif-rs`**

For EXIF metadata (orientation, date, camera info):
```toml
[dependencies]
kamadak-exif = "0.5"
```

---

## 2. Sony ARW File Format

### 2.1 Format Structure

Sony ARW files are TIFF-based with Intel (little-endian) byte order:

| Version | Year | Bit Depth | Notes |
|---------|------|-----------|-------|
| ARW 1.0 | 2006 | 12-bit | Original format |
| ARW 2.1 | - | 12-bit | Lossy compression (11+7 bits) |
| ARW 2.3 | - | 14-bit | Higher precision |
| ARW 4.0 | 2021 | 14-bit | Lossless JPEG compression |

**Reference**: [lclevy/sony_raw](https://github.com/lclevy/sony_raw)

### 2.2 IFD Structure

```
ARW File
├── IFD0 (Primary IFD)
│   ├── EXIF SubIFD
│   │   └── MakerNoteSony
│   └── SubIFD (Full resolution RAW data)
│       └── Compression: 32767 (Sony proprietary)
├── IFD1 (Thumbnail/Preview)
│   └── Embedded JPEG
└── SR2Private (Sony-specific data)
```

### 2.3 Embedded JPEG Preview

**Key finding**: Sony ARW files contain embedded JPEG previews at **1616x1080** resolution.

- Located in **IFD1** of the TIFF structure
- Can be extracted directly without demosaicing
- This is what camera LCD displays and fast viewers use

**Extraction approach**: Use rawloader's metadata parsing to locate IFD1 JPEG offset and length, then extract bytes directly.

---

## 3. Thumbnail Generation Strategy

### 3.1 Two-Path Architecture

```
Path 1: Fast Thumbnails (< 50ms)
┌─────────────┐    ┌──────────────────┐    ┌────────────┐
│ ARW File    │───▶│ Extract embedded │───▶│ Thumbnail  │
│             │    │ JPEG from IFD1   │    │ (~1616px)  │
└─────────────┘    └──────────────────┘    └────────────┘

Path 2: Quality Previews (1-5s)
┌─────────────┐    ┌──────────────┐    ┌───────────┐    ┌──────────┐
│ ARW File    │───▶│ Decode RAW   │───▶│ Demosaic  │───▶│ Preview  │
│             │    │ (rawloader)  │    │ + Color   │    │ (2560px) │
└─────────────┘    └──────────────┘    └───────────┘    └──────────┘
```

### 3.2 Generation Order (per asset)

1. **Thumbnail** (immediate): Extract embedded JPEG, resize to ~256px
2. **Preview 1x** (background): Full decode + demosaic → 2560px long edge
3. **Preview 2x** (idle): Full decode + demosaic → 5120px long edge

### 3.3 Downscaling Algorithms

| Algorithm | Speed | Quality | Use Case |
|-----------|-------|---------|----------|
| Nearest | Fastest | Poor | Never for photos |
| Bilinear | Fast | Good | Thumbnails |
| Lanczos3 | Slow | Excellent | Final previews |

The `image` crate provides all these via `imageops::resize()`.

---

## 4. Demosaicing Algorithms

### 4.1 Algorithm Comparison

| Algorithm | Quality | Speed | Notes |
|-----------|---------|-------|-------|
| Bilinear | Low | Very Fast | Blurry, color artifacts |
| VNG | Medium | Medium | Better for low-frequency content |
| AHD | High | Slow | Industry standard, good color |
| AMaZE | Highest | Very Slow | Best quality, impractical for web |

### 4.2 Recommended Approach

For v1, implement **bilinear interpolation** for speed:
- Simple to implement
- Fast enough for real-time preview
- Acceptable quality for culling workflow

Later versions can add AHD for export-quality rendering.

**Basic bilinear demosaic pseudocode:**
```rust
// For each pixel, interpolate missing color channels
// from neighboring pixels in the Bayer pattern
fn demosaic_bilinear(raw: &[u16], width: usize, height: usize, cfa: &CFA) -> RgbImage {
    // R G R G R G
    // G B G B G B
    // R G R G R G
    // Interpolate each pixel's missing channels from neighbors
}
```

---

## 5. WASM Memory Management

### 5.1 Key Challenges

- **4GB limit**: WASM32 has max 4GB linear memory
- **Double allocation**: wasm-bindgen copies data between JS and WASM
- **Large files**: Sony ARW files can be 25-60MB

### 5.2 Recommended Patterns

**Direct memory access** (avoid copies):
```typescript
// JS side
const wasmMemory = instance.exports.memory;
const buffer = new Uint8Array(wasmMemory.buffer, ptr, len);
// buffer points directly to WASM memory
```

**Shared memory for workers** (if needed):
```typescript
// Use SharedArrayBuffer for worker communication
const shared = new SharedArrayBuffer(size);
postMessage({ buffer: shared }); // No copy
```

**Allocator choice**: Use `talc` allocator (2025 recommendation) - smaller and faster than dlmalloc for WASM.

### 5.3 Memory Budget

| Operation | Memory Required |
|-----------|-----------------|
| RAW file load | 25-60MB |
| Decoded RAW (14-bit) | ~100MB (6000x4000x2 bytes) |
| Demosaiced RGB | ~72MB (6000x4000x3 bytes) |
| Preview 1x | ~20MB (2560x1700x3) |
| Thumbnail | ~200KB |

**Strategy**: Process one image at a time, release buffers aggressively.

---

## 6. WASM Bindings Architecture

### 6.1 Recommended API

```rust
// crates/literoom-wasm/src/lib.rs

#[wasm_bindgen]
pub struct ImageDecoder {
    // Internal state
}

#[wasm_bindgen]
impl ImageDecoder {
    /// Decode JPEG bytes to RGB pixels
    #[wasm_bindgen]
    pub fn decode_jpeg(bytes: &[u8]) -> Result<DecodedImage, JsValue>;

    /// Extract embedded thumbnail from RAW file (fast path)
    #[wasm_bindgen]
    pub fn extract_raw_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, JsValue>;

    /// Full RAW decode with demosaicing
    #[wasm_bindgen]
    pub fn decode_raw(bytes: &[u8]) -> Result<DecodedImage, JsValue>;

    /// Resize image using specified algorithm
    #[wasm_bindgen]
    pub fn resize(image: &DecodedImage, width: u32, height: u32, filter: FilterType) -> DecodedImage;
}

#[wasm_bindgen]
pub struct DecodedImage {
    width: u32,
    height: u32,
    // RGB pixel data stored in WASM memory
}
```

### 6.2 Worker Integration Pattern

```typescript
// packages/core/src/worker/decode-worker.ts
import init, { ImageDecoder } from '@literoom/wasm';

let decoder: ImageDecoder | null = null;

self.onmessage = async (e) => {
    if (!decoder) {
        await init();
        decoder = new ImageDecoder();
    }

    const { id, type, data } = e.data;

    switch (type) {
        case 'decode_thumbnail':
            const thumb = decoder.extract_raw_thumbnail(data);
            self.postMessage({ id, result: thumb }, [thumb.buffer]);
            break;
        // ...
    }
};
```

### 6.3 Error Handling

```rust
#[wasm_bindgen]
pub enum DecodeError {
    InvalidFormat,
    UnsupportedCamera,
    CorruptedFile,
    OutOfMemory,
}

// Convert to JsValue for JS consumption
impl From<DecodeError> for JsValue {
    fn from(e: DecodeError) -> JsValue {
        JsValue::from_str(&format!("{:?}", e))
    }
}
```

---

## 7. Performance Expectations

### 7.1 Benchmarks (Estimates)

| Operation | Time | Notes |
|-----------|------|-------|
| JPEG decode (4000x3000) | 50-150ms | WASM, single-threaded |
| RAW thumbnail extract | 10-50ms | Just file parsing |
| RAW full decode | 500-2000ms | Including demosaic |
| Resize 6000→2560 | 100-300ms | Lanczos3 |

### 7.2 Optimization Priorities

1. **Thumbnail path**: Must be <100ms for smooth grid scrolling
2. **Preview 1x**: Can be background, but <2s for good UX
3. **Full quality**: Only needed at export time

---

## 8. Recommendations Summary

| Decision | Recommendation | Confidence |
|----------|----------------|------------|
| JPEG decoding | `image` crate | High |
| RAW decoding | `rawloader` crate | High |
| Thumbnail strategy | Embedded JPEG extraction | High |
| Demosaicing (v1) | Bilinear interpolation | Medium |
| WASM bindings | wasm-bindgen direct | High |
| Memory management | Single-image, aggressive release | High |
| Worker architecture | Dedicated decode worker | High |

---

## 9. Implementation Risks

1. **rawloader ARW support**: May not support newest Sony cameras (a6600 should be fine)
2. **WASM performance**: May need SIMD for acceptable speed
3. **Memory pressure**: Large files may stress browser memory limits
4. **Embedded JPEG quality**: 1616x1080 may not be enough for all use cases

---

## 10. Next Steps

1. Create implementation plan for image decoding pipeline
2. Set up rawloader in literoom-core
3. Implement embedded JPEG extraction
4. Implement basic demosaicing
5. Create WASM bindings
6. Integrate with Web Worker
7. Test with Sony a6600 ARW files

---

## Sources

- [image-rs/image](https://github.com/image-rs/image) - Rust image processing
- [pedrocr/rawloader](https://github.com/pedrocr/rawloader) - RAW file decoding
- [rawler crate](https://lib.rs/crates/rawler) - Alternative RAW decoder
- [RagnarVdB/rawloader-wasm](https://github.com/RagnarVdB/rawloader-wasm) - WASM port
- [lclevy/sony_raw](https://github.com/lclevy/sony_raw) - ARW format documentation
- [photon-rs](https://silvia-odwyer.github.io/photon/) - WASM image processing
- [libraw.wasm](https://github.com/ssssota/libraw.wasm) - LibRaw WASM port
- [WASM Memory Guide](https://radu-matei.com/blog/practical-guide-to-wasm-memory/)
- [Demosaicing - RawPedia](https://rawpedia.rawtherapee.com/Demosaicing)
