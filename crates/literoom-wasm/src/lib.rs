//! Literoom WASM - WebAssembly bindings for Literoom
//!
//! This crate provides WASM bindings to expose the literoom-core functionality
//! to JavaScript/TypeScript applications.
//!
//! # Module Structure
//!
//! - `adjustments` - Basic photo adjustments (exposure, contrast, etc.)
//! - `types` - WASM-compatible wrapper types for image data
//! - `decode` - Image decoding bindings (JPEG, RAW thumbnail extraction, resize)
//! - `encode` - Image encoding bindings (JPEG export)
//!
//! # Usage
//!
//! ```typescript
//! import init, { decode_jpeg, JsDecodedImage } from '@literoom/wasm';
//!
//! // Initialize WASM module (must call first)
//! await init();
//!
//! // Decode a JPEG file
//! const bytes = new Uint8Array(await file.arrayBuffer());
//! const image = decode_jpeg(bytes);
//! console.log(`Decoded ${image.width}x${image.height}`);
//! ```

use wasm_bindgen::prelude::*;

mod adjustments;
mod curve;
mod decode;
mod encode;
mod histogram;
mod transform;
mod types;

// Re-export public types
pub use adjustments::{apply_adjustments, BasicAdjustments};
pub use curve::{apply_tone_curve, JsToneCurveLut};
pub use decode::{
    decode_jpeg, decode_raw_thumbnail, extract_raw_thumbnail_bytes, generate_thumbnail,
    is_raw_file, resize, resize_to_fit,
};
pub use encode::{encode_jpeg, encode_jpeg_from_image};
pub use histogram::{compute_histogram, JsHistogram};
pub use transform::{apply_crop, apply_rotation};
pub use types::JsDecodedImage;

/// Initialize the WASM module (called automatically on load)
#[wasm_bindgen(start)]
pub fn init() {
    // Future: Set up panic hook for better error messages in browser console
    // when console_error_panic_hook feature is added
}

/// Get the version of the WASM module
#[wasm_bindgen]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Simple function to verify WASM is working
#[wasm_bindgen]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! Literoom WASM is ready.", name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        assert!(!version().is_empty());
    }

    #[test]
    fn test_greet() {
        assert_eq!(greet("World"), "Hello, World! Literoom WASM is ready.");
    }
}
