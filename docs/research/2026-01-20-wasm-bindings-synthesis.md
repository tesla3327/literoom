# Research Synthesis: WASM Bindings for Image Decoding Pipeline

**Date**: 2026-01-20
**Research Plan**: [WASM Bindings Research Plan](./2026-01-20-wasm-bindings-research-plan.md)

## Overview

This document synthesizes findings from research into WASM bindings for the Literoom image decoding pipeline. The research covered pixel buffer patterns, memory management, error handling, and the existing crate structure.

---

## Key Decisions

### 1. Pixel Buffer Transfer Strategy

**Decision: Use `Vec<u8>` returns with copy semantics for v1**

| Aspect | Approach | Rationale |
|--------|----------|-----------|
| Return type | `Vec<u8>` → `Uint8Array` | wasm-bindgen handles conversion automatically |
| Input type | `&[u8]` from JS | Zero-copy view into JS memory (no copy on input) |
| Multi-step ops | Wrapper struct `JsDecodedImage` | Keeps data in WASM during chained operations |
| Zero-copy | Defer to v2 | Copy overhead (~10-50ms) acceptable vs decode time (50-2000ms) |

**Source**: [Research Area 1](./2026-01-20-wasm-bindings-area-1-pixel-buffers.md)

### 2. Memory Management

**Decision: Rely on wasm-bindgen automatic cleanup**

- Stateless functions: Rust allocates, processes, returns copy, deallocates
- Wrapper structs: wasm-bindgen generates finalizers for cleanup
- Explicit `.free()` method available for JS to call if needed
- No manual `std::mem::forget()` or view-based zero-copy patterns in v1

**WASM Memory Considerations**:
- 4GB limit for wasm32 (sufficient for 24MP images in RGB)
- One image at a time processing model prevents memory exhaustion
- Worker isolation provides clean memory boundaries

### 3. Error Handling

**Decision: String-based errors via `Result<T, JsValue>`**

```rust
Err(JsValue::from_str(&error.to_string()))
```

- Consistent with existing literoom-wasm patterns
- `DecodeError` enum already has good `Display` implementation
- Structured error types can be added later if JS needs to differentiate errors programmatically

### 4. TypeScript Types

**Decision: Let wasm-bindgen generate types automatically**

- wasm-pack generates `.d.ts` files with `--target web` or `--target bundler`
- JSDoc comments in Rust become TypeScript doc comments
- Custom types (like `JsDecodedImage`) will have full type definitions
- No manual type maintenance required

### 5. Build Configuration

**Decision: Use wasm-pack with `--target web`**

| Setting | Value | Reason |
|---------|-------|--------|
| Target | `web` | Direct browser usage without bundler, also works with bundlers |
| Profile | `release` | Smaller output, better performance |
| opt-level | `"s"` | Already configured - optimize for size |
| LTO | `true` | Already configured - link-time optimization |
| wasm-opt | Default | wasm-pack runs automatically |

**Output location**: `packages/wasm/`

---

## Implementation Architecture

### File Organization

```
crates/literoom-wasm/src/
├── lib.rs              # Module exports, init, version
├── adjustments.rs      # BasicAdjustments wrapper (move from lib.rs)
├── decode.rs           # NEW: decode bindings
└── types.rs            # NEW: shared WASM types (JsDecodedImage, etc.)
```

### Core Types

```rust
// types.rs
#[wasm_bindgen]
pub struct JsDecodedImage {
    width: u32,
    height: u32,
    pixels: Vec<u8>,
}

#[wasm_bindgen]
impl JsDecodedImage {
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 { self.width }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 { self.height }

    /// Returns RGB pixel data as Uint8Array (creates copy)
    pub fn pixels(&self) -> Vec<u8> {
        self.pixels.clone()
    }

    /// Explicitly free WASM memory (optional - finalizer handles this)
    pub fn free(self) {}
}
```

### Decode Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `decode_jpeg` | `(bytes: &[u8]) -> Result<JsDecodedImage, JsValue>` | Decode JPEG with EXIF orientation |
| `extract_raw_thumbnail_bytes` | `(bytes: &[u8]) -> Result<Vec<u8>, JsValue>` | Extract embedded JPEG from RAW |
| `decode_raw_thumbnail` | `(bytes: &[u8]) -> Result<JsDecodedImage, JsValue>` | Extract and decode RAW thumbnail |
| `is_raw_file` | `(bytes: &[u8]) -> bool` | Quick header check for RAW format |

### Resize Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| `resize` | `(img: &JsDecodedImage, width: u32, height: u32, filter: u8) -> Result<JsDecodedImage, JsValue>` | Resize to exact dimensions |
| `resize_to_fit` | `(img: &JsDecodedImage, max_edge: u32, filter: u8) -> Result<JsDecodedImage, JsValue>` | Fit within max edge, preserve aspect |
| `generate_thumbnail` | `(img: &JsDecodedImage, size: u32) -> Result<JsDecodedImage, JsValue>` | Generate grid thumbnail |

### Filter Type Mapping

```rust
// 0 = Nearest, 1 = Bilinear (default), 2 = Lanczos3
fn filter_from_u8(value: u8) -> FilterType {
    match value {
        0 => FilterType::Nearest,
        2 => FilterType::Lanczos3,
        _ => FilterType::Bilinear,
    }
}
```

---

## Build Integration

### Package.json Scripts

```json
{
  "scripts": {
    "wasm:build": "wasm-pack build crates/literoom-wasm --target web --out-dir ../../packages/wasm",
    "wasm:build:dev": "wasm-pack build crates/literoom-wasm --target web --dev --out-dir ../../packages/wasm"
  }
}
```

### CI Integration

The existing CI workflow already has a WASM build step. Update to:
1. Run `wasm-pack build` with `--target web`
2. Output to `packages/wasm/`
3. Verify `.d.ts` files generated

---

## TypeScript Integration Preview

After wasm-pack build, TypeScript code will be able to:

```typescript
import init, { decode_jpeg, resize, JsDecodedImage } from '@literoom/wasm';

// Initialize WASM module
await init();

// Decode JPEG
const fileBytes = new Uint8Array(await file.arrayBuffer());
const image: JsDecodedImage = decode_jpeg(fileBytes);

console.log(`Decoded ${image.width}x${image.height} image`);

// Resize for thumbnail
const thumbnail = generate_thumbnail(image, 256);

// Get pixel data for canvas
const pixels: Uint8Array = thumbnail.pixels();

// Clean up (optional - GC handles this)
image.free();
thumbnail.free();
```

---

## Performance Expectations

| Operation | Expected Time | Notes |
|-----------|---------------|-------|
| JPEG decode | 20-100ms | Depends on size, handled by `image` crate |
| RAW thumbnail extract | 5-20ms | Just finds and copies embedded JPEG |
| RAW thumbnail decode | 25-120ms | Extract + JPEG decode |
| Resize (thumbnail) | 10-50ms | Bilinear filter, depends on source/target size |
| Pixel buffer copy | 10-50ms | For 24MP image (~72MB RGB) |

---

## Testing Strategy

### Unit Tests (Rust)

Continue using `#[test]` for core logic testing (already in place).

### WASM Tests

Add `wasm-bindgen-test` tests for:
1. Round-trip: decode → get pixels → verify dimensions
2. Error handling: invalid JPEG bytes → proper error
3. Memory: decode large image → free → no leaks (manual verification)

### Integration Tests

Test from TypeScript in the web app:
1. Worker-based decode pipeline
2. Canvas rendering of decoded pixels
3. Thumbnail generation workflow

---

## Implementation Phases

### Phase 1: Core Decode Bindings (This Plan)
- Add `types.rs` with `JsDecodedImage`
- Add `decode.rs` with JPEG and RAW thumbnail functions
- Add resize wrapper functions
- Update lib.rs exports
- Add wasm-pack build scripts

### Phase 2: TypeScript Integration (Next Plan)
- Create Worker wrapper for WASM operations
- Add decode service abstraction
- Integrate with Nuxt app

### Phase 3: Optimization (Future)
- Profile copy overhead
- Consider zero-copy views if needed
- Canvas rendering directly from WASM

---

## Summary

The WASM bindings implementation will:
1. **Wrap literoom-core types** with thin WASM-compatible wrappers
2. **Use safe copy semantics** for pixel buffer transfer
3. **Rely on wasm-bindgen** for automatic memory management and TypeScript types
4. **Output to packages/wasm/** for consumption by the web app
5. **Build with wasm-pack --target web** for direct browser usage

This approach prioritizes safety and simplicity over zero-copy performance, with clear paths for optimization if profiling indicates it's needed.
