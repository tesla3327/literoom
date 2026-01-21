# Research Area 1: wasm-bindgen Patterns for Image Data

**Date**: 2026-01-20
**Research Plan**: [WASM Bindings Research Plan](./2026-01-20-wasm-bindings-research-plan.md)

## Objective

Determine the best approach for transferring large pixel buffers between Rust/WASM and JavaScript, balancing performance, safety, and simplicity.

---

## Key Questions Answered

### 1. How to return large pixel buffers from Rust to JS?

**Option A: Return `Vec<u8>` directly (Recommended for v1)**

```rust
#[wasm_bindgen]
pub fn decode_jpeg(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    // Returns as Uint8Array in JS
    // wasm-bindgen handles conversion automatically
}
```

- wasm-bindgen converts `Vec<u8>` to `Uint8Array` automatically
- **Creates a copy** under the hood for safety
- Simple, safe, no manual memory management
- Performance overhead acceptable for image processing timelines

**Option B: Return view into WASM memory (Zero-copy, unsafe)**

```rust
use js_sys::Uint8Array;

#[wasm_bindgen]
pub fn get_pixel_view(data: &[u8]) -> Uint8Array {
    // UNSAFE: View invalidated if WASM memory grows
    unsafe { Uint8Array::view(data) }
}
```

- Zero copy - JS sees directly into WASM linear memory
- **Critical danger**: View is invalidated by any memory growth (any Rust allocation)
- No lifetime tracking between JS and Rust
- Requires careful manual memory management

**Option C: Wrapper struct with explicit buffer access**

```rust
#[wasm_bindgen]
pub struct JsDecodedImage {
    pixels: Vec<u8>,
    width: u32,
    height: u32,
}

#[wasm_bindgen]
impl JsDecodedImage {
    // Return copy - safe
    pub fn pixels(&self) -> Vec<u8> {
        self.pixels.clone()
    }

    // OR return view - unsafe but zero-copy
    pub fn pixels_view(&self) -> Uint8Array {
        unsafe { Uint8Array::view(&self.pixels) }
    }
}
```

---

### 2. Should we return `Vec<u8>` or provide direct memory views?

**Recommendation: Return `Vec<u8>` for v1**

| Approach | Pros | Cons |
|----------|------|------|
| `Vec<u8>` return | Safe, simple, automatic cleanup | Copies data |
| `Uint8Array::view()` | Zero-copy | Unsafe, view invalidated by allocations |
| Shared memory | Zero-copy, controlled | Complex, manual lifetime management |

**Rationale:**
- Image decode operations take 50-2000ms; copy overhead (~10-50ms for 24MP) is acceptable
- Safety prevents hard-to-debug memory corruption bugs
- Real-world projects (Discourse, Squoosh) use copying for most operations
- Can optimize later if profiling shows copy is bottleneck

---

### 3. How do we avoid unnecessary copies between Rust and JS?

**Input side (JS → Rust): Use `&[u8]`**

```rust
#[wasm_bindgen]
pub fn decode_jpeg(bytes: &[u8]) -> Result<JsDecodedImage, JsValue> {
    // bytes is a view into the JS Uint8Array - no copy on input
    // wasm-bindgen handles this automatically
}
```

When accepting `&[u8]` as input, wasm-bindgen creates a view rather than copying.

**Output side (Rust → JS): Accept the copy**

For v1, accept the copy when returning pixel buffers. The alternatives are:
1. Complex manual memory management with `std::mem::forget()`
2. Risk of memory corruption if WASM memory grows
3. Difficult debugging when things go wrong

**Processing: Keep data in Rust when possible**

```rust
// Keep data on Rust side during multi-step operations
let decoded = decode_raw(bytes)?;
let resized = resize(&decoded, 2560)?;
// Only copy when returning final result
Ok(resized.pixels)
```

---

### 4. Memory ownership patterns for WASM image data

**Pattern 1: Stateless functions (Recommended)**

```rust
#[wasm_bindgen]
pub fn decode_jpeg(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    let image = decode(bytes)?;
    Ok(image.pixels)
}
// Image is dropped, memory freed when function returns
// JS owns the copied Uint8Array
```

- Function allocates, processes, returns copy, deallocates
- Clean ownership model
- GC handles JS-side cleanup

**Pattern 2: Wrapper structs for multi-step operations**

```rust
#[wasm_bindgen]
pub struct JsDecodedImage {
    inner: DecodedImage,
}

#[wasm_bindgen]
impl JsDecodedImage {
    pub fn width(&self) -> u32 { self.inner.width }
    pub fn height(&self) -> u32 { self.inner.height }
    pub fn pixels(&self) -> Vec<u8> { self.inner.pixels.clone() }

    // Allow resize without round-tripping pixel data
    pub fn resize(&self, width: u32, height: u32) -> JsDecodedImage {
        JsDecodedImage {
            inner: resize(&self.inner, width, height)
        }
    }
}
```

- Keeps image data on Rust side
- Avoids multiple JS→Rust→JS copies during chained operations
- JS must call `.free()` or let wasm-bindgen handle cleanup

---

## Real-World Lessons

### From Discourse (MozJPEG WASM implementation)
- Use browser native APIs when possible (they used `createImageBitmap()` for decoding)
- "Pragmatic tool selection wins" - don't reinvent what browsers do well
- WASM best for operations browsers can't do natively (encoding, demosaicing)

### From Squoosh/jSquash
- Process entirely in WASM, return results to JS
- Use Web Workers to prevent UI blocking
- Memory management requires careful architectural decisions
- "Always profile memory usage on large images and implement safeguards"

### From wasm-bindgen pitfalls article
- Ownership transfer can cause subtle bugs with objects
- Prefer stateless functions over complex object graphs across WASM boundary

---

## Recommended Implementation for Literoom

### Phase 1: Simple and Safe

```rust
// decode.rs

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

    /// Returns pixel data as Uint8Array (copies data)
    pub fn pixels(&self) -> Vec<u8> {
        self.pixels.clone()
    }

    /// Frees WASM memory (called automatically by finalizer, but can be explicit)
    pub fn free(self) {}
}

#[wasm_bindgen]
pub fn decode_jpeg(bytes: &[u8]) -> Result<JsDecodedImage, JsValue> {
    let decoded = literoom_core::decode::decode_jpeg(bytes)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(JsDecodedImage {
        width: decoded.width,
        height: decoded.height,
        pixels: decoded.pixels,
    })
}

#[wasm_bindgen]
pub fn resize(
    image: &JsDecodedImage,
    width: u32,
    height: u32,
    filter: u8
) -> Result<JsDecodedImage, JsValue> {
    // Reconstruct DecodedImage from wrapper
    let input = DecodedImage {
        width: image.width,
        height: image.height,
        pixels: image.pixels.clone(),
    };

    let resized = literoom_core::decode::resize(&input, width, height, filter.into())
        .map_err(|e| JsValue::from_str(&e.to_string()))?;

    Ok(JsDecodedImage {
        width: resized.width,
        height: resized.height,
        pixels: resized.pixels,
    })
}
```

### Phase 2: Optimization (if needed)

If profiling shows copy overhead is significant:

1. **Add zero-copy accessor with safety documentation**:
```rust
/// UNSAFE: Returns view into WASM memory.
/// View is invalidated by ANY WASM memory allocation.
/// Copy data immediately if you need to keep it.
pub fn pixels_view_unsafe(&self) -> Uint8Array {
    unsafe { Uint8Array::view(&self.pixels) }
}
```

2. **Consider rendering directly to canvas from WASM** (avoids JS copy entirely)

3. **Use `Clamped<Vec<u8>>` for direct ImageData creation**

---

## Summary

| Question | Recommendation |
|----------|----------------|
| Return type for pixel data | `Vec<u8>` → automatic `Uint8Array` conversion |
| Input type for image bytes | `&[u8]` → zero-copy view from JS |
| Memory ownership | Stateless functions; wasm-bindgen handles cleanup |
| Zero-copy optimization | Defer until profiling proves necessary |
| Multi-step operations | Use wrapper struct to keep data in WASM |

---

## Sources

- [wasm-bindgen Vec Parameters Pitfalls](https://www.rossng.eu/posts/2025-02-22-wasm-bindgen-vec-parameters/)
- [Pixel Buffer Rendering in WASM with Rust](https://tuttlem.github.io/2024/12/07/pixel-buffer-rendering-in-wasm-with-rust.html)
- [Discourse: Faster uploads with Rust, WASM and MozJPEG](https://blog.discourse.org/2021/07/faster-user-uploads-on-discourse-with-rust-webassembly-and-mozjpeg/)
- [wasm-bindgen Issue #1643: Uint8Array view_mut_raw](https://github.com/wasm-bindgen/wasm-bindgen/issues/1643)
- [wasm-bindgen Issue #111: Returning Vec](https://github.com/rustwasm/wasm-bindgen/issues/111)
- [js-sys Uint8Array documentation](https://docs.rs/js-sys/latest/js_sys/struct.Uint8Array.html)
- [jSquash: Browser-focused image codec WASM bundles](https://github.com/jamsinclair/jSquash)
