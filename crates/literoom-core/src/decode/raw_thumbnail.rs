//! RAW file thumbnail extraction for fast preview generation.
//!
//! This module provides functionality to extract embedded JPEG thumbnails
//! from RAW files without performing full demosaicing. This is the "fast path"
//! for generating thumbnails quickly (<50ms target).
//!
//! # Supported Formats
//!
//! - Sony ARW (a6600 and similar cameras)
//!
//! # Architecture
//!
//! Sony ARW files (and most RAW formats) embed a JPEG preview image
//! for quick display. This module extracts that embedded JPEG without
//! decoding the raw sensor data.
//!
//! ARW files are TIFF-based and store preview images in SubIFDs.
//! The preview is typically a full-resolution JPEG stored at a specific
//! offset within the file.

use std::io::{Cursor, Read, Seek, SeekFrom};

use super::{DecodeError, DecodedImage};
use crate::decode::jpeg::decode_jpeg;

// TIFF constants
const TIFF_MAGIC_LE: [u8; 4] = [0x49, 0x49, 0x2A, 0x00]; // II + 42
const TIFF_MAGIC_BE: [u8; 4] = [0x4D, 0x4D, 0x00, 0x2A]; // MM + 42

// TIFF tag IDs
const TAG_STRIP_OFFSETS: u16 = 0x0111;
const TAG_STRIP_BYTE_COUNTS: u16 = 0x0117;
const TAG_JPEG_OFFSET: u16 = 0x0201; // JpegInterchangeFormat
const TAG_JPEG_LENGTH: u16 = 0x0202; // JpegInterchangeFormatLength
const TAG_SUBIFD: u16 = 0x014A; // SubIFDs
const TAG_COMPRESSION: u16 = 0x0103;

// JPEG compression type
const COMPRESSION_JPEG: u16 = 6;
const COMPRESSION_JPEG_OLD: u16 = 7;

/// Extract the embedded JPEG thumbnail from a RAW file.
///
/// This extracts the raw JPEG bytes from the RAW file without decoding.
/// Use `decode_jpeg` on the result to get pixel data.
///
/// # Arguments
///
/// * `bytes` - Raw file bytes (e.g., Sony ARW)
///
/// # Returns
///
/// The embedded JPEG bytes, or an error if extraction fails.
///
/// # Errors
///
/// - `DecodeError::InvalidFormat` - Not a recognized RAW format
/// - `DecodeError::NoThumbnail` - RAW file has no embedded thumbnail
/// - `DecodeError::CorruptedFile` - RAW file is corrupted
///
/// # Example
///
/// ```ignore
/// use literoom_core::decode::{extract_raw_thumbnail, decode_jpeg};
///
/// let arw_bytes = std::fs::read("photo.ARW").unwrap();
/// let jpeg_bytes = extract_raw_thumbnail(&arw_bytes)?;
/// let image = decode_jpeg(&jpeg_bytes)?;
/// ```
pub fn extract_raw_thumbnail(bytes: &[u8]) -> Result<Vec<u8>, DecodeError> {
    let mut cursor = Cursor::new(bytes);

    // Detect byte order and validate TIFF header
    let mut header = [0u8; 4];
    cursor
        .read_exact(&mut header)
        .map_err(|e| DecodeError::CorruptedFile(format!("Failed to read header: {}", e)))?;

    let little_endian = if header == TIFF_MAGIC_LE {
        true
    } else if header == TIFF_MAGIC_BE {
        false
    } else {
        return Err(DecodeError::InvalidFormat);
    };

    // Read IFD0 offset
    let ifd0_offset = read_u32(&mut cursor, little_endian)?;
    cursor
        .seek(SeekFrom::Start(ifd0_offset as u64))
        .map_err(|e| DecodeError::CorruptedFile(format!("Failed to seek to IFD0: {}", e)))?;

    // Try to find preview in various locations:
    // 1. SubIFD (preferred for ARW - larger preview)
    // 2. IFD1 (standard EXIF thumbnail)
    // 3. JPEG data in IFD0

    // First, parse IFD0 to find SubIFD pointer
    let mut subifd_offset: Option<u32> = None;
    let mut ifd1_offset: Option<u32> = None;

    // Parse IFD0
    let (entries, next_ifd) = parse_ifd(&mut cursor, little_endian, bytes.len())?;

    for entry in &entries {
        if entry.tag == TAG_SUBIFD && entry.count > 0 {
            // SubIFD offset - this often contains the main preview
            subifd_offset = Some(entry.value_offset);
        }
    }

    // Check for IFD1 (next IFD after IFD0)
    if next_ifd != 0 {
        ifd1_offset = Some(next_ifd);
    }

    // Try SubIFD first (usually has larger preview for Sony cameras)
    if let Some(offset) = subifd_offset {
        if let Ok(jpeg) = extract_jpeg_from_ifd(&mut cursor, offset, little_endian, bytes) {
            if jpeg.len() > 10000 {
                // Likely a real preview, not a tiny thumbnail
                return Ok(jpeg);
            }
        }
    }

    // Try IFD1 (standard thumbnail location)
    if let Some(offset) = ifd1_offset {
        if let Ok(jpeg) = extract_jpeg_from_ifd(&mut cursor, offset, little_endian, bytes) {
            return Ok(jpeg);
        }
    }

    // Try extracting from IFD0 entries directly
    if let Ok(jpeg) = extract_jpeg_from_entries(&entries, bytes) {
        return Ok(jpeg);
    }

    // Last resort: scan for JPEG markers in the file
    if let Some(jpeg) = scan_for_jpeg(bytes) {
        return Ok(jpeg);
    }

    Err(DecodeError::NoThumbnail)
}

/// Extract and decode the embedded thumbnail from a RAW file.
///
/// This is a convenience function that extracts the embedded JPEG
/// and decodes it in one step.
///
/// # Arguments
///
/// * `bytes` - Raw file bytes (e.g., Sony ARW)
///
/// # Returns
///
/// A `DecodedImage` with the thumbnail's RGB pixel data.
pub fn decode_raw_thumbnail(bytes: &[u8]) -> Result<DecodedImage, DecodeError> {
    let jpeg_bytes = extract_raw_thumbnail(bytes)?;
    decode_jpeg(&jpeg_bytes)
}

/// Check if a file appears to be a RAW file based on its header.
///
/// This is a quick check that doesn't fully parse the file.
///
/// # Arguments
///
/// * `bytes` - First few bytes of the file (at least 12 bytes recommended)
///
/// # Returns
///
/// `true` if the file appears to be a supported RAW format (TIFF-based).
pub fn is_raw_file(bytes: &[u8]) -> bool {
    if bytes.len() < 4 {
        return false;
    }

    // Check for TIFF magic number (used by most RAW formats including ARW)
    bytes[..4] == TIFF_MAGIC_LE || bytes[..4] == TIFF_MAGIC_BE
}

/// Get information about the camera that produced a RAW file.
///
/// # Arguments
///
/// * `bytes` - Raw file bytes
///
/// # Returns
///
/// A tuple of (make, model) if available, or an error.
pub fn get_raw_camera_info(bytes: &[u8]) -> Result<(String, String), DecodeError> {
    use exif::{In, Reader, Tag};
    use std::io::BufReader;

    let cursor = Cursor::new(bytes);
    let mut buf_reader = BufReader::new(cursor);

    let exif = Reader::new()
        .read_from_container(&mut buf_reader)
        .map_err(|e| DecodeError::CorruptedFile(format!("Failed to read EXIF: {}", e)))?;

    let make = exif
        .get_field(Tag::Make, In::PRIMARY)
        .and_then(|f| f.display_value().to_string().into())
        .unwrap_or_default();

    let model = exif
        .get_field(Tag::Model, In::PRIMARY)
        .and_then(|f| f.display_value().to_string().into())
        .unwrap_or_default();

    // Clean up quotes from string values
    let make = make.trim_matches('"').to_string();
    let model = model.trim_matches('"').to_string();

    Ok((make, model))
}

// IFD entry structure
struct IfdEntry {
    tag: u16,
    #[allow(dead_code)]
    typ: u16,
    count: u32,
    value_offset: u32,
}

fn read_u16<R: Read>(reader: &mut R, little_endian: bool) -> Result<u16, DecodeError> {
    let mut buf = [0u8; 2];
    reader
        .read_exact(&mut buf)
        .map_err(|e| DecodeError::CorruptedFile(format!("Failed to read u16: {}", e)))?;
    Ok(if little_endian {
        u16::from_le_bytes(buf)
    } else {
        u16::from_be_bytes(buf)
    })
}

fn read_u32<R: Read>(reader: &mut R, little_endian: bool) -> Result<u32, DecodeError> {
    let mut buf = [0u8; 4];
    reader
        .read_exact(&mut buf)
        .map_err(|e| DecodeError::CorruptedFile(format!("Failed to read u32: {}", e)))?;
    Ok(if little_endian {
        u32::from_le_bytes(buf)
    } else {
        u32::from_be_bytes(buf)
    })
}

fn parse_ifd<R: Read + Seek>(
    reader: &mut R,
    little_endian: bool,
    file_size: usize,
) -> Result<(Vec<IfdEntry>, u32), DecodeError> {
    let entry_count = read_u16(reader, little_endian)?;

    if entry_count > 1000 {
        return Err(DecodeError::CorruptedFile(
            "Too many IFD entries".to_string(),
        ));
    }

    let mut entries = Vec::with_capacity(entry_count as usize);

    for _ in 0..entry_count {
        let tag = read_u16(reader, little_endian)?;
        let typ = read_u16(reader, little_endian)?;
        let count = read_u32(reader, little_endian)?;
        let value_offset = read_u32(reader, little_endian)?;

        // Validate offset doesn't exceed file size
        if value_offset as usize > file_size {
            continue; // Skip invalid entries
        }

        entries.push(IfdEntry {
            tag,
            typ,
            count,
            value_offset,
        });
    }

    let next_ifd = read_u32(reader, little_endian).unwrap_or(0);

    Ok((entries, next_ifd))
}

fn extract_jpeg_from_ifd<R: Read + Seek>(
    reader: &mut R,
    ifd_offset: u32,
    little_endian: bool,
    file_bytes: &[u8],
) -> Result<Vec<u8>, DecodeError> {
    reader
        .seek(SeekFrom::Start(ifd_offset as u64))
        .map_err(|e| DecodeError::CorruptedFile(format!("Failed to seek to IFD: {}", e)))?;

    let (entries, _) = parse_ifd(reader, little_endian, file_bytes.len())?;

    extract_jpeg_from_entries(&entries, file_bytes)
}

fn extract_jpeg_from_entries(
    entries: &[IfdEntry],
    file_bytes: &[u8],
) -> Result<Vec<u8>, DecodeError> {
    let mut jpeg_offset: Option<u32> = None;
    let mut jpeg_length: Option<u32> = None;
    let mut strip_offsets: Option<u32> = None;
    let mut strip_byte_counts: Option<u32> = None;
    let mut compression: Option<u16> = None;

    for entry in entries {
        match entry.tag {
            TAG_JPEG_OFFSET => jpeg_offset = Some(entry.value_offset),
            TAG_JPEG_LENGTH => jpeg_length = Some(entry.value_offset),
            TAG_STRIP_OFFSETS => strip_offsets = Some(entry.value_offset),
            TAG_STRIP_BYTE_COUNTS => strip_byte_counts = Some(entry.value_offset),
            TAG_COMPRESSION => compression = Some(entry.value_offset as u16),
            _ => {}
        }
    }

    // Try JPEG interchange format first (most common for thumbnails)
    if let (Some(offset), Some(length)) = (jpeg_offset, jpeg_length) {
        let offset = offset as usize;
        let length = length as usize;

        if offset + length <= file_bytes.len() && length > 0 {
            let jpeg_data = &file_bytes[offset..offset + length];
            // Validate it's actually JPEG
            if jpeg_data.len() >= 2 && jpeg_data[0] == 0xFF && jpeg_data[1] == 0xD8 {
                return Ok(jpeg_data.to_vec());
            }
        }
    }

    // Try strip-based JPEG (used by some cameras)
    if let (Some(offset), Some(length)) = (strip_offsets, strip_byte_counts) {
        // Check if this is JPEG compressed
        let is_jpeg = compression
            .map(|c| c == COMPRESSION_JPEG || c == COMPRESSION_JPEG_OLD)
            .unwrap_or(false);

        if is_jpeg {
            let offset = offset as usize;
            let length = length as usize;

            if offset + length <= file_bytes.len() && length > 0 {
                let data = &file_bytes[offset..offset + length];
                // Validate it's actually JPEG
                if data.len() >= 2 && data[0] == 0xFF && data[1] == 0xD8 {
                    return Ok(data.to_vec());
                }
            }
        }
    }

    Err(DecodeError::NoThumbnail)
}

/// Scan for embedded JPEG by looking for JPEG markers.
/// This is a fallback method when IFD parsing doesn't find the preview.
fn scan_for_jpeg(bytes: &[u8]) -> Option<Vec<u8>> {
    // Look for JPEG start marker (FFD8)
    // Skip the first few KB to avoid the main TIFF structure
    let start_offset = 8192.min(bytes.len());

    for i in start_offset..bytes.len().saturating_sub(2) {
        if bytes[i] == 0xFF && bytes[i + 1] == 0xD8 {
            // Found potential JPEG start, now find the end
            for j in (i + 2)..bytes.len().saturating_sub(1) {
                if bytes[j] == 0xFF && bytes[j + 1] == 0xD9 {
                    // Found JPEG end marker
                    let jpeg_data = &bytes[i..j + 2];

                    // Sanity check: preview JPEGs are typically > 50KB
                    if jpeg_data.len() > 50_000 {
                        return Some(jpeg_data.to_vec());
                    }
                }
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_raw_file_tiff_le() {
        let header = [0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00];
        assert!(is_raw_file(&header));
    }

    #[test]
    fn test_is_raw_file_tiff_be() {
        let header = [0x4D, 0x4D, 0x00, 0x2A, 0x00, 0x00, 0x00, 0x08];
        assert!(is_raw_file(&header));
    }

    #[test]
    fn test_is_raw_file_jpeg_not_raw() {
        // JPEG magic bytes
        let jpeg_header = [0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46];
        assert!(!is_raw_file(&jpeg_header));
    }

    #[test]
    fn test_is_raw_file_too_short() {
        assert!(!is_raw_file(&[0x49, 0x49]));
        assert!(!is_raw_file(&[]));
    }

    #[test]
    fn test_extract_raw_thumbnail_invalid_data() {
        // Random bytes that aren't a valid RAW file
        let invalid_bytes = vec![0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];
        let result = extract_raw_thumbnail(&invalid_bytes);
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_raw_thumbnail_empty_data() {
        let result = extract_raw_thumbnail(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_extract_raw_thumbnail_jpeg_input() {
        // JPEG files should fail (not a RAW format - wrong magic)
        let jpeg_bytes = vec![
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
        ];
        let result = extract_raw_thumbnail(&jpeg_bytes);
        assert!(matches!(result, Err(DecodeError::InvalidFormat)));
    }

    #[test]
    fn test_decode_raw_thumbnail_invalid_data() {
        let invalid_bytes = vec![0x00, 0x01, 0x02, 0x03];
        let result = decode_raw_thumbnail(&invalid_bytes);
        assert!(result.is_err());
    }

    #[test]
    fn test_read_u16_little_endian() {
        let data = [0x34, 0x12];
        let mut cursor = Cursor::new(&data[..]);
        let value = read_u16(&mut cursor, true).unwrap();
        assert_eq!(value, 0x1234);
    }

    #[test]
    fn test_read_u16_big_endian() {
        let data = [0x12, 0x34];
        let mut cursor = Cursor::new(&data[..]);
        let value = read_u16(&mut cursor, false).unwrap();
        assert_eq!(value, 0x1234);
    }

    #[test]
    fn test_read_u32_little_endian() {
        let data = [0x78, 0x56, 0x34, 0x12];
        let mut cursor = Cursor::new(&data[..]);
        let value = read_u32(&mut cursor, true).unwrap();
        assert_eq!(value, 0x12345678);
    }

    #[test]
    fn test_read_u32_big_endian() {
        let data = [0x12, 0x34, 0x56, 0x78];
        let mut cursor = Cursor::new(&data[..]);
        let value = read_u32(&mut cursor, false).unwrap();
        assert_eq!(value, 0x12345678);
    }

    // Note: Tests with actual ARW files would require test fixtures.
    // These can be added later with sample ARW files in a test_fixtures directory.
}
