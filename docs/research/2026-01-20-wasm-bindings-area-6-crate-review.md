# Research Area 6: Existing literoom-wasm Crate Review

**Date**: 2026-01-20
**Research Plan**: [WASM Bindings Research Plan](./2026-01-20-wasm-bindings-research-plan.md)

## Objective

Review the current state of the `literoom-wasm` crate to understand existing patterns and determine what needs to be added for decode bindings.

---

## Current State

### Crate Structure

```
crates/literoom-wasm/
├── Cargo.toml
└── src/
    └── lib.rs
```

Single file implementation with ~210 lines of code.

### Dependencies (from Cargo.toml)

```toml
[dependencies]
literoom-core = { path = "../literoom-core" }
wasm-bindgen = { workspace = true }     # 0.2
js-sys = { workspace = true }           # 0.3
web-sys = { workspace = true }          # 0.3 with "console" feature
serde = { workspace = true }            # 1.0 with derive
serde-wasm-bindgen = { workspace = true } # 0.6

[dev-dependencies]
wasm-bindgen-test = "0.3"
```

### Crate Configuration

```toml
[lib]
crate-type = ["cdylib", "rlib"]
```

- `cdylib`: Required for WASM output
- `rlib`: Allows native Rust testing

---

## Established Patterns

### 1. Wrapper Struct Pattern

The crate uses a wrapper pattern to expose literoom-core types to JS:

```rust
#[wasm_bindgen]
pub struct BasicAdjustments {
    inner: literoom_core::BasicAdjustments,
}
```

**Benefits:**
- Separates WASM concerns from core logic
- Allows custom JS-facing API without modifying core types
- Core types remain pure Rust without WASM annotations

### 2. Constructor Pattern

```rust
#[wasm_bindgen]
impl BasicAdjustments {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: literoom_core::BasicAdjustments::new(),
        }
    }
}
```

Enables `new BasicAdjustments()` in JavaScript.

### 3. Getter/Setter Pattern

```rust
#[wasm_bindgen(getter)]
pub fn exposure(&self) -> f32 {
    self.inner.exposure
}

#[wasm_bindgen(setter)]
pub fn set_exposure(&mut self, value: f32) {
    self.inner.exposure = value;
}
```

Enables property-like access in JS: `adj.exposure = 1.5`

### 4. JSON Serialization Pattern

```rust
pub fn to_json(&self) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(&self.inner)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

pub fn from_json(value: JsValue) -> Result<BasicAdjustments, JsValue> {
    let inner: literoom_core::BasicAdjustments =
        serde_wasm_bindgen::from_value(value)
            .map_err(|e| JsValue::from_str(&e.to_string()))?;
    Ok(Self { inner })
}
```

Uses `serde-wasm-bindgen` for efficient JS object conversion.

### 5. Error Handling Pattern

```rust
Result<T, JsValue>  // Return type for fallible operations
JsValue::from_str(&e.to_string())  // Convert Rust errors to JS
```

Simple string-based error conversion. No structured error types yet.

### 6. Module Initialization

```rust
#[wasm_bindgen(start)]
pub fn init() {
    // Called automatically when WASM module loads
    // Future: Set up panic hook
}
```

### 7. Utility Functions

```rust
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Literoom WASM is ready.", name)
}
```

---

## What Needs to be Added for Decode Bindings

### 1. New Wrapper Types

| Type | Purpose | Notes |
|------|---------|-------|
| `JsDecodedImage` | Expose `DecodedImage` to JS | Need pixel buffer access strategy |
| `JsImageMetadata` | Expose `ImageMetadata` to JS | Can use serde-wasm-bindgen directly |

### 2. New Functions

| Function | Signature | Priority |
|----------|-----------|----------|
| `decode_jpeg` | `(bytes: &[u8]) -> Result<JsDecodedImage, JsValue>` | High |
| `extract_raw_thumbnail` | `(bytes: &[u8]) -> Result<Uint8Array, JsValue>` | High |
| `decode_raw_thumbnail` | `(bytes: &[u8]) -> Result<JsDecodedImage, JsValue>` | High |
| `resize` | `(img: &JsDecodedImage, w: u32, h: u32, filter: u8) -> JsDecodedImage` | High |
| `resize_to_fit` | `(img: &JsDecodedImage, max_edge: u32, filter: u8) -> JsDecodedImage` | Medium |
| `generate_thumbnail` | `(img: &JsDecodedImage, size: u32) -> JsDecodedImage` | High |
| `is_raw_file` | `(bytes: &[u8]) -> bool` | Medium |
| `get_raw_camera_info` | `(bytes: &[u8]) -> Result<JsValue, JsValue>` | Low |

### 3. Error Type Improvements

Current error handling is string-based. For decode operations, could improve to:

```rust
// Option A: Keep simple strings (consistent with current approach)
Err(JsValue::from_str(&err.to_string()))

// Option B: Structured errors (better for JS error handling)
#[wasm_bindgen]
pub enum JsDecodeErrorKind {
    InvalidFormat,
    UnsupportedCamera,
    CorruptedFile,
    OutOfMemory,
    NoThumbnail,
}
```

**Recommendation:** Start with string-based errors (Option A) for consistency, can improve later.

### 4. FilterType Conversion

Need to convert JS number to Rust `FilterType`:

```rust
fn filter_from_u8(value: u8) -> FilterType {
    match value {
        0 => FilterType::Nearest,
        1 => FilterType::Bilinear,
        2 => FilterType::Lanczos3,
        _ => FilterType::Bilinear, // Default
    }
}
```

### 5. Pixel Buffer Strategy

**Critical decision**: How to return pixel data to JS?

Options:
1. **Copy to new Uint8Array** - Safe but doubles memory
2. **Return view into WASM memory** - Zero-copy but memory can be invalidated
3. **Return owned Uint8Array** - Best of both worlds with `wasm-bindgen`'s Vec<u8> handling

Will research this in Area 1 (wasm-bindgen patterns for image data).

---

## Suggested File Organization

Current structure is single-file. For decode bindings, suggest modular approach:

```
crates/literoom-wasm/src/
├── lib.rs              # Module exports, init, version
├── adjustments.rs      # BasicAdjustments wrapper (move from lib.rs)
└── decode.rs           # New: all decode bindings
```

---

## Build Configuration Notes

### Workspace Cargo.toml (Release Profile)

```toml
[profile.release]
opt-level = "s"   # Optimize for size
lto = true        # Link-time optimization
```

Good defaults for WASM. May need to tune:
- `wasm-opt` level (handled by wasm-pack)
- Consider `codegen-units = 1` for smaller output

### Missing: wasm-pack Configuration

No `.cargo/config.toml` or `wasm-pack.toml` found. Will need to:
1. Add build scripts to `package.json` or Makefile
2. Configure output target (`--target web` vs `--target bundler`)
3. Set output directory (`packages/wasm/`)

---

## Existing Tests

```rust
#[cfg(test)]
mod tests {
    #[test]
    fn test_version() { ... }

    #[test]
    fn test_greet() { ... }

    #[test]
    fn test_basic_adjustments() { ... }
}
```

Native Rust tests only. No `wasm-bindgen-test` tests yet, though the dependency is present.

---

## Integration Plan

1. **Keep existing patterns** - Wrapper structs, getter/setter, JSON serialization
2. **Add decode module** - New file `decode.rs` for all decode bindings
3. **Focus on function API first** - Stateless functions are simpler than wrapper types
4. **Defer complex pixel buffer handling** - Start with simple copy, optimize later
5. **Test with wasm-bindgen-test** - Add browser-based tests for critical paths

---

## Summary

The `literoom-wasm` crate has a solid foundation:
- Clean wrapper pattern for exposing core types
- Good serialization setup with serde-wasm-bindgen
- Proper crate configuration for WASM output
- Release profile optimized for size

**Next research areas to complete before implementation:**
1. Area 1: Pixel buffer transfer patterns (critical)
2. Area 2: Memory management strategy
3. Area 3: Error handling refinements
4. Area 5: Build configuration and wasm-pack setup

Area 4 (TypeScript types) will largely be handled automatically by wasm-bindgen.
