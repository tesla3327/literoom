//! Image encoding pipeline for Literoom.
//!
//! This module provides functionality for:
//! - Encoding images to JPEG format with configurable quality
//!
//! # Architecture
//!
//! The encoding pipeline is designed to be used from Web Workers via WASM bindings.
//! All operations are synchronous and single-threaded within WASM.
//!
//! # Examples
//!
//! ```ignore
//! use literoom_core::encode::encode_jpeg;
//!
//! let pixels = vec![128u8; 100 * 100 * 3]; // Gray image
//! let jpeg_bytes = encode_jpeg(&pixels, 100, 100, 90).unwrap();
//! println!("Encoded {} bytes", jpeg_bytes.len());
//! ```

mod jpeg;

pub use jpeg::{encode_jpeg, EncodeError};
