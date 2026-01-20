# Research Plan: Image Decoding Pipeline

**Date**: 2026-01-20
**Status**: In Progress
**Priority**: Critical (foundational for all image features)

## Research Objective

Research best approaches for decoding JPEG and Sony ARW RAW files in Rust/WASM, including thumbnail generation strategies, memory management, and WASM bindings architecture.

## Context

The Literoom app needs to:
1. Decode JPEG and Sony a6600 ARW (RAW) files
2. Generate thumbnails quickly for grid browsing
3. Generate preview images (1x at 2560px, 2x at 5120px long edge)
4. Run all heavy compute in a Web Worker (not main thread)
5. Be compatible with future Tauri desktop packaging

## Research Questions

### 1. JPEG Decoding in Rust/WASM

- What are the best Rust crates for JPEG decoding?
  - `image` crate vs `jpeg-decoder` vs others
- Performance characteristics in WASM context
- Memory usage patterns
- Streaming/progressive decoding support
- How to handle EXIF metadata extraction (orientation, date, etc.)

### 2. RAW File Decoding (Sony ARW)

- What Rust crates support Sony a6600 ARW files?
  - `rawloader` vs `rawler` vs others
- What is the ARW format structure?
- How to extract embedded JPEG previews from RAW files (fast path for thumbnails)
- Full demosaicing approaches (for full quality rendering)
- Color space handling (camera RGB → sRGB)
- Performance considerations for WASM

### 3. Thumbnail Generation Strategy

- Embedded JPEG extraction from RAW (fastest path)
- Downscaling algorithms (nearest, bilinear, Lanczos)
- Target sizes: thumbnail (~256px), preview 1x (2560px), preview 2x (5120px)
- Memory-efficient downscaling for large images
- Progressive generation order (thumb → 1x → 2x)

### 4. WASM Memory Management

- How to efficiently pass large image buffers between JS and WASM
- Typed arrays vs copying strategies
- Memory limits in WASM32 (4GB max)
- Strategies for handling very large files (100MB+ RAW files)

### 5. WASM Bindings Architecture

- Synchronous vs async WASM calls
- Worker thread integration patterns
- Error handling across JS/WASM boundary
- Return types (ImageData, raw bytes, encoded formats)

### 6. Existing Implementations and Prior Art

- How do other browser-based photo editors handle RAW decoding?
- LibRaw.js, dcraw.js, or other existing ports
- Performance benchmarks and tradeoffs

## Research Approach

1. Web search for Rust WASM image decoding libraries and benchmarks
2. Review RAW file format documentation and crate capabilities
3. Look at existing browser-based RAW photo viewers/editors
4. Research WASM memory management patterns
5. Review performance considerations for image processing in WASM

## Expected Outputs

- Synthesized document with:
  - Recommended crates for JPEG and RAW decoding
  - Architecture for the decode pipeline
  - Memory management strategy
  - WASM bindings design
  - Performance expectations
- Implementation plan with step-by-step instructions

## Research Queries to Execute

1. Rust WASM JPEG decoding performance and libraries
2. Rust RAW file decoding (Sony ARW) - rawloader, rawler crates
3. ARW file format structure and embedded JPEG extraction
4. WASM memory management for large image buffers
5. Browser-based RAW photo editors architecture
6. Image demosaicing algorithms in Rust
