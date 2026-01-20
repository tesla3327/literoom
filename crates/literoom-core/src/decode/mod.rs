//! Image decoding pipeline for Literoom.
//!
//! This module provides functionality for:
//! - Decoding JPEG images
//! - Extracting embedded thumbnails from RAW files (fast path)
//! - Full RAW decoding with demosaicing (quality path)
//! - Image resizing for thumbnails and previews
//!
//! # Architecture
//!
//! The decoding pipeline is designed to be used from Web Workers via WASM bindings.
//! All operations are synchronous and single-threaded within WASM.
//!
//! # Performance Strategy
//!
//! For RAW files, we use a two-path strategy:
//! - **Fast path**: Extract the embedded JPEG thumbnail (<50ms) for immediate display
//! - **Quality path**: Full RAW decode with demosaicing (1-2s) for editing
//!
//! # Examples
//!
//! ```ignore
//! use literoom_core::decode::{decode_jpeg, DecodedImage};
//!
//! let jpeg_bytes = std::fs::read("photo.jpg").unwrap();
//! let image = decode_jpeg(&jpeg_bytes).unwrap();
//! println!("Decoded {}x{} image", image.width, image.height);
//! ```

mod jpeg;
mod raw_thumbnail;
mod resize;
mod types;

pub use jpeg::{decode_jpeg, decode_jpeg_no_orientation, get_orientation};
pub use raw_thumbnail::{
    decode_raw_thumbnail, extract_raw_thumbnail, get_raw_camera_info, is_raw_file,
};
pub use resize::{generate_thumbnail, resize, resize_to_fit};
pub use types::{DecodeError, DecodedImage, FilterType, ImageMetadata, Orientation};
