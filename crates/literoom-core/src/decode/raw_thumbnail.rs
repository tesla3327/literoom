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

    #[test]
    fn test_get_raw_camera_info_invalid_data() {
        // Random bytes that aren't valid TIFF/EXIF should return CorruptedFile error
        let invalid = vec![0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07];
        let result = get_raw_camera_info(&invalid);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_raw_camera_info_empty_data() {
        // Empty slice should return error
        let result = get_raw_camera_info(&[]);
        assert!(result.is_err());
    }

    #[test]
    fn test_get_raw_camera_info_jpeg_without_exif() {
        // Minimal JPEG header without EXIF data should return error
        // JPEG SOI marker + APP0 (JFIF) marker without EXIF APP1 segment
        let jpeg_no_exif = vec![
            0xFF, 0xD8, // SOI marker
            0xFF, 0xE0, // APP0 marker (JFIF, not EXIF)
            0x00, 0x10, // Length: 16 bytes
            0x4A, 0x46, 0x49, 0x46, 0x00, // "JFIF\0"
            0x01, 0x01, // Version 1.1
            0x00, // Aspect ratio units
            0x00, 0x01, // X density
            0x00, 0x01, // Y density
            0x00, 0x00, // No thumbnail
            0xFF, 0xD9, // EOI marker
        ];
        let result = get_raw_camera_info(&jpeg_no_exif);
        assert!(result.is_err());
    }

    /// Helper to create a little-endian TIFF header with given IFD0 offset.
    fn make_tiff_header_le(ifd0_offset: u32) -> Vec<u8> {
        let mut data = vec![0x49, 0x49, 0x2A, 0x00]; // Little-endian TIFF magic
        data.extend_from_slice(&ifd0_offset.to_le_bytes());
        data
    }

    #[test]
    fn test_extract_raw_thumbnail_valid_tiff_no_jpeg() {
        // Valid TIFF header pointing to IFD at offset 8
        let mut data = make_tiff_header_le(8);
        // IFD at offset 8 with 0 entries
        data.extend_from_slice(&0u16.to_le_bytes()); // 0 entries
        data.extend_from_slice(&0u32.to_le_bytes()); // no next IFD

        let result = extract_raw_thumbnail(&data);
        assert!(
            matches!(result, Err(DecodeError::NoThumbnail)),
            "Expected NoThumbnail error for valid TIFF with no JPEG entries, got {:?}",
            result
        );
    }

    #[test]
    fn test_extract_raw_thumbnail_truncated_ifd() {
        // Valid TIFF header pointing to IFD at offset 8
        let mut data = make_tiff_header_le(8);
        // Only add 1 byte of IFD data (entry count needs 2 bytes)
        data.push(0x00);

        let result = extract_raw_thumbnail(&data);
        assert!(
            result.is_err(),
            "Expected error for truncated IFD, got {:?}",
            result
        );
        // Should be a CorruptedFile error since we can't read the IFD
        assert!(
            matches!(result, Err(DecodeError::CorruptedFile(_))),
            "Expected CorruptedFile error for truncated IFD, got {:?}",
            result
        );
    }

    #[test]
    fn test_extract_raw_thumbnail_ifd_offset_past_eof() {
        // Valid TIFF header pointing to IFD at offset 1000 (way past EOF)
        let data = make_tiff_header_le(1000);
        // File is only 8 bytes (header), but IFD0 offset points to byte 1000

        let result = extract_raw_thumbnail(&data);
        assert!(
            result.is_err(),
            "Expected error for IFD offset past EOF, got {:?}",
            result
        );
        // Should be a CorruptedFile error since we can't seek to the IFD
        assert!(
            matches!(result, Err(DecodeError::CorruptedFile(_))),
            "Expected CorruptedFile error for IFD offset past EOF, got {:?}",
            result
        );
    }

    #[test]
    fn test_scan_for_jpeg_finds_large_jpeg() {
        // Create a 70KB buffer with JPEG markers after offset 8192
        let mut bytes = vec![0u8; 70_000];
        // Place JPEG start marker at offset 10000 (after 8192)
        bytes[10_000] = 0xFF;
        bytes[10_001] = 0xD8;
        // Place JPEG end marker at offset 65000 (gives >50KB JPEG)
        bytes[65_000] = 0xFF;
        bytes[65_001] = 0xD9;

        let result = scan_for_jpeg(&bytes);
        assert!(result.is_some());
        let jpeg = result.unwrap();
        // Should extract from 10000 to 65002 (inclusive of end marker)
        assert_eq!(jpeg.len(), 65_002 - 10_000);
        assert_eq!(jpeg[0], 0xFF);
        assert_eq!(jpeg[1], 0xD8);
        assert_eq!(jpeg[jpeg.len() - 2], 0xFF);
        assert_eq!(jpeg[jpeg.len() - 1], 0xD9);
    }

    #[test]
    fn test_scan_for_jpeg_ignores_small_jpeg() {
        // Create buffer with a small JPEG (< 50KB)
        let mut bytes = vec![0u8; 70_000];
        // Place JPEG start marker at offset 10000
        bytes[10_000] = 0xFF;
        bytes[10_001] = 0xD8;
        // Place JPEG end marker at offset 40000 (gives ~30KB JPEG, under 50KB threshold)
        bytes[40_000] = 0xFF;
        bytes[40_001] = 0xD9;

        let result = scan_for_jpeg(&bytes);
        assert!(result.is_none());
    }

    #[test]
    fn test_scan_for_jpeg_no_start_marker() {
        // Create buffer without JPEG start marker
        let mut bytes = vec![0u8; 70_000];
        // Only place end marker, no start marker
        bytes[65_000] = 0xFF;
        bytes[65_001] = 0xD9;

        let result = scan_for_jpeg(&bytes);
        assert!(result.is_none());
    }

    #[test]
    fn test_scan_for_jpeg_no_end_marker() {
        // Create buffer with start marker but no end marker
        let mut bytes = vec![0u8; 70_000];
        // Place JPEG start marker
        bytes[10_000] = 0xFF;
        bytes[10_001] = 0xD8;
        // No end marker

        let result = scan_for_jpeg(&bytes);
        assert!(result.is_none());
    }

    #[test]
    fn test_scan_for_jpeg_marker_before_8192() {
        // JPEG markers before offset 8192 should be ignored
        let mut bytes = vec![0u8; 70_000];
        // Place JPEG markers before 8192 offset
        bytes[1_000] = 0xFF;
        bytes[1_001] = 0xD8;
        bytes[60_000] = 0xFF;
        bytes[60_001] = 0xD9;

        let result = scan_for_jpeg(&bytes);
        // Should not find this JPEG because start marker is before 8192
        assert!(result.is_none());
    }

    #[test]
    fn test_scan_for_jpeg_empty_input() {
        let bytes: Vec<u8> = vec![];
        let result = scan_for_jpeg(&bytes);
        assert!(result.is_none());
    }

    #[test]
    fn test_scan_for_jpeg_small_input() {
        // Input smaller than 8192 bytes - start_offset becomes bytes.len()
        let mut bytes = vec![0u8; 5_000];
        // Place markers - but since input is < 8192, start_offset = 5000
        // and there's nothing to scan after that
        bytes[1_000] = 0xFF;
        bytes[1_001] = 0xD8;
        bytes[4_000] = 0xFF;
        bytes[4_001] = 0xD9;

        let result = scan_for_jpeg(&bytes);
        // Should return None because scanning starts at bytes.len() (5000)
        // and there's nothing after that
        assert!(result.is_none());
    }

    // Helper function to create an IFD entry in little-endian format
    fn make_ifd_entry_le(tag: u16, value: u32) -> Vec<u8> {
        let mut entry = Vec::new();
        entry.extend_from_slice(&tag.to_le_bytes());
        entry.extend_from_slice(&4u16.to_le_bytes()); // type LONG
        entry.extend_from_slice(&1u32.to_le_bytes()); // count
        entry.extend_from_slice(&value.to_le_bytes());
        entry
    }

    #[test]
    fn test_extract_jpeg_from_ifd_valid_jpeg() {
        // Build file bytes with:
        // - IFD at offset 100 with 2 entries (JPEG_OFFSET and JPEG_LENGTH)
        // - JPEG data at offset 200

        let ifd_offset: u32 = 100;
        let jpeg_offset: u32 = 200;
        let jpeg_data = vec![0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46]; // JPEG header
        let jpeg_length: u32 = jpeg_data.len() as u32;

        // Create file bytes large enough to hold everything
        let mut file_bytes = vec![0u8; 300];

        // Write IFD at offset 100
        // IFD format: u16 entry_count, then entries (12 bytes each), then u32 next_ifd
        let entry_count: u16 = 2;
        file_bytes[ifd_offset as usize..ifd_offset as usize + 2]
            .copy_from_slice(&entry_count.to_le_bytes());

        // Entry 1: TAG_JPEG_OFFSET (0x0201) pointing to offset 200
        let entry1 = make_ifd_entry_le(TAG_JPEG_OFFSET, jpeg_offset);
        let entry1_start = ifd_offset as usize + 2;
        file_bytes[entry1_start..entry1_start + 12].copy_from_slice(&entry1);

        // Entry 2: TAG_JPEG_LENGTH (0x0202) with the length
        let entry2 = make_ifd_entry_le(TAG_JPEG_LENGTH, jpeg_length);
        let entry2_start = entry1_start + 12;
        file_bytes[entry2_start..entry2_start + 12].copy_from_slice(&entry2);

        // Next IFD offset (0 = no more IFDs)
        let next_ifd_offset = entry2_start + 12;
        file_bytes[next_ifd_offset..next_ifd_offset + 4].copy_from_slice(&0u32.to_le_bytes());

        // Write JPEG data at offset 200
        file_bytes[jpeg_offset as usize..jpeg_offset as usize + jpeg_data.len()]
            .copy_from_slice(&jpeg_data);

        // Test extraction
        let mut cursor = Cursor::new(&file_bytes[..]);
        let result = extract_jpeg_from_ifd(&mut cursor, ifd_offset, true, &file_bytes);

        assert!(result.is_ok());
        let extracted = result.unwrap();
        assert_eq!(extracted, jpeg_data);
    }

    #[test]
    fn test_extract_jpeg_from_ifd_seek_error() {
        // Create small file bytes but use an IFD offset past the end
        let file_bytes = vec![0u8; 50];
        let ifd_offset: u32 = 1000; // Way past end of file_bytes

        let mut cursor = Cursor::new(&file_bytes[..]);
        let result = extract_jpeg_from_ifd(&mut cursor, ifd_offset, true, &file_bytes);

        assert!(result.is_err());
        match result {
            Err(DecodeError::CorruptedFile(msg)) => {
                assert!(msg.contains("seek") || msg.contains("Failed"));
            }
            _ => panic!("Expected CorruptedFile error for seek past end"),
        }
    }

    #[test]
    fn test_extract_jpeg_from_ifd_no_jpeg_in_entries() {
        // Build file bytes with valid IFD but entries that don't point to JPEG
        let ifd_offset: u32 = 100;

        // Create file bytes
        let mut file_bytes = vec![0u8; 200];

        // Write IFD at offset 100 with 1 entry (not a JPEG tag)
        let entry_count: u16 = 1;
        file_bytes[ifd_offset as usize..ifd_offset as usize + 2]
            .copy_from_slice(&entry_count.to_le_bytes());

        // Entry: Some random tag (not JPEG_OFFSET or JPEG_LENGTH)
        let random_tag: u16 = 0x0100; // ImageWidth tag
        let entry = make_ifd_entry_le(random_tag, 1024);
        let entry_start = ifd_offset as usize + 2;
        file_bytes[entry_start..entry_start + 12].copy_from_slice(&entry);

        // Next IFD offset (0 = no more IFDs)
        let next_ifd_offset = entry_start + 12;
        file_bytes[next_ifd_offset..next_ifd_offset + 4].copy_from_slice(&0u32.to_le_bytes());

        // Test extraction - should fail with NoThumbnail
        let mut cursor = Cursor::new(&file_bytes[..]);
        let result = extract_jpeg_from_ifd(&mut cursor, ifd_offset, true, &file_bytes);

        assert!(result.is_err());
        assert!(matches!(result, Err(DecodeError::NoThumbnail)));
    }

    #[test]
    fn test_extract_jpeg_from_entries_jpeg_interchange_format() {
        // Create synthetic file bytes with JPEG data at offset 100
        let mut file_bytes = vec![0u8; 200];
        // Place JPEG markers at offset 100
        file_bytes[100] = 0xFF;
        file_bytes[101] = 0xD8;
        // Add some content and end marker
        file_bytes[110] = 0xFF;
        file_bytes[111] = 0xD9;

        let entries = vec![
            IfdEntry {
                tag: TAG_JPEG_OFFSET,
                typ: 4, // LONG
                count: 1,
                value_offset: 100,
            },
            IfdEntry {
                tag: TAG_JPEG_LENGTH,
                typ: 4, // LONG
                count: 1,
                value_offset: 12, // Length of JPEG data
            },
        ];

        let result = extract_jpeg_from_entries(&entries, &file_bytes);
        assert!(result.is_ok());
        let jpeg_data = result.unwrap();
        assert_eq!(jpeg_data.len(), 12);
        assert_eq!(jpeg_data[0], 0xFF);
        assert_eq!(jpeg_data[1], 0xD8);
    }

    #[test]
    fn test_extract_jpeg_from_entries_strip_based_jpeg() {
        // Create synthetic file bytes with JPEG data at offset 50
        let mut file_bytes = vec![0u8; 150];
        // Place JPEG markers at offset 50
        file_bytes[50] = 0xFF;
        file_bytes[51] = 0xD8;
        // Add end marker
        file_bytes[68] = 0xFF;
        file_bytes[69] = 0xD9;

        let entries = vec![
            IfdEntry {
                tag: TAG_STRIP_OFFSETS,
                typ: 4, // LONG
                count: 1,
                value_offset: 50,
            },
            IfdEntry {
                tag: TAG_STRIP_BYTE_COUNTS,
                typ: 4, // LONG
                count: 1,
                value_offset: 20, // Length of strip data
            },
            IfdEntry {
                tag: TAG_COMPRESSION,
                typ: 3, // SHORT
                count: 1,
                value_offset: COMPRESSION_JPEG as u32,
            },
        ];

        let result = extract_jpeg_from_entries(&entries, &file_bytes);
        assert!(result.is_ok());
        let jpeg_data = result.unwrap();
        assert_eq!(jpeg_data.len(), 20);
        assert_eq!(jpeg_data[0], 0xFF);
        assert_eq!(jpeg_data[1], 0xD8);
    }

    #[test]
    fn test_extract_jpeg_from_entries_strip_based_old_compression() {
        // Create synthetic file bytes with JPEG data at offset 50
        let mut file_bytes = vec![0u8; 150];
        // Place JPEG markers at offset 50
        file_bytes[50] = 0xFF;
        file_bytes[51] = 0xD8;
        // Add end marker
        file_bytes[68] = 0xFF;
        file_bytes[69] = 0xD9;

        let entries = vec![
            IfdEntry {
                tag: TAG_STRIP_OFFSETS,
                typ: 4, // LONG
                count: 1,
                value_offset: 50,
            },
            IfdEntry {
                tag: TAG_STRIP_BYTE_COUNTS,
                typ: 4, // LONG
                count: 1,
                value_offset: 20, // Length of strip data
            },
            IfdEntry {
                tag: TAG_COMPRESSION,
                typ: 3, // SHORT
                count: 1,
                value_offset: COMPRESSION_JPEG_OLD as u32, // Old-style JPEG compression (7)
            },
        ];

        let result = extract_jpeg_from_entries(&entries, &file_bytes);
        assert!(result.is_ok());
        let jpeg_data = result.unwrap();
        assert_eq!(jpeg_data.len(), 20);
        assert_eq!(jpeg_data[0], 0xFF);
        assert_eq!(jpeg_data[1], 0xD8);
    }

    #[test]
    fn test_extract_jpeg_from_entries_invalid_jpeg_magic() {
        // Create file bytes with data that doesn't start with JPEG magic
        let mut file_bytes = vec![0u8; 200];
        // Place invalid magic bytes at offset 100 (not 0xFF 0xD8)
        file_bytes[100] = 0x00;
        file_bytes[101] = 0x00;

        let entries = vec![
            IfdEntry {
                tag: TAG_JPEG_OFFSET,
                typ: 4, // LONG
                count: 1,
                value_offset: 100,
            },
            IfdEntry {
                tag: TAG_JPEG_LENGTH,
                typ: 4, // LONG
                count: 1,
                value_offset: 50,
            },
        ];

        let result = extract_jpeg_from_entries(&entries, &file_bytes);
        assert!(result.is_err());
        assert!(matches!(result, Err(DecodeError::NoThumbnail)));
    }

    #[test]
    fn test_extract_jpeg_from_entries_offset_out_of_bounds() {
        // Create small file bytes
        let file_bytes = vec![0u8; 50];

        // Set offset + length to exceed file size
        let entries = vec![
            IfdEntry {
                tag: TAG_JPEG_OFFSET,
                typ: 4, // LONG
                count: 1,
                value_offset: 40, // Offset near end of file
            },
            IfdEntry {
                tag: TAG_JPEG_LENGTH,
                typ: 4, // LONG
                count: 1,
                value_offset: 20, // Length that exceeds file bounds (40 + 20 > 50)
            },
        ];

        let result = extract_jpeg_from_entries(&entries, &file_bytes);
        assert!(result.is_err());
        assert!(matches!(result, Err(DecodeError::NoThumbnail)));
    }

    #[test]
    fn test_extract_jpeg_from_entries_zero_length() {
        // Create file bytes with valid JPEG magic
        let mut file_bytes = vec![0u8; 200];
        file_bytes[100] = 0xFF;
        file_bytes[101] = 0xD8;

        let entries = vec![
            IfdEntry {
                tag: TAG_JPEG_OFFSET,
                typ: 4, // LONG
                count: 1,
                value_offset: 100,
            },
            IfdEntry {
                tag: TAG_JPEG_LENGTH,
                typ: 4, // LONG
                count: 1,
                value_offset: 0, // Zero length
            },
        ];

        let result = extract_jpeg_from_entries(&entries, &file_bytes);
        assert!(result.is_err());
        assert!(matches!(result, Err(DecodeError::NoThumbnail)));
    }

    #[test]
    fn test_extract_jpeg_from_entries_no_jpeg_tags() {
        // Create file bytes
        let file_bytes = vec![0u8; 200];

        // Entries without any JPEG-related tags
        let entries = vec![
            IfdEntry {
                tag: 0x0100, // ImageWidth - not a JPEG tag
                typ: 3,     // SHORT
                count: 1,
                value_offset: 1920,
            },
            IfdEntry {
                tag: 0x0101, // ImageLength - not a JPEG tag
                typ: 3,     // SHORT
                count: 1,
                value_offset: 1080,
            },
        ];

        let result = extract_jpeg_from_entries(&entries, &file_bytes);
        assert!(result.is_err());
        assert!(matches!(result, Err(DecodeError::NoThumbnail)));
    }

    #[test]
    fn test_parse_ifd_single_entry_le() {
        // Create a synthetic little-endian IFD with one entry
        // IFD structure:
        // - 2 bytes: entry count (1)
        // - 12 bytes: entry (tag=0x0111, type=0x0003, count=1, value_offset=0x1000)
        // - 4 bytes: next IFD offset (0)
        let mut data = Vec::new();

        // Entry count: 1 (little-endian)
        data.extend_from_slice(&1u16.to_le_bytes());

        // Entry 1: tag=0x0111 (StripOffsets), type=0x0003 (SHORT), count=1, value_offset=0x1000
        data.extend_from_slice(&0x0111u16.to_le_bytes()); // tag
        data.extend_from_slice(&0x0003u16.to_le_bytes()); // type
        data.extend_from_slice(&1u32.to_le_bytes()); // count
        data.extend_from_slice(&0x1000u32.to_le_bytes()); // value_offset

        // Next IFD offset: 0
        data.extend_from_slice(&0u32.to_le_bytes());

        let mut cursor = Cursor::new(&data[..]);
        let file_size = 0x2000; // Large enough to include the offset

        let (entries, next_ifd) = parse_ifd(&mut cursor, true, file_size).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].tag, 0x0111);
        assert_eq!(entries[0].typ, 0x0003);
        assert_eq!(entries[0].count, 1);
        assert_eq!(entries[0].value_offset, 0x1000);
        assert_eq!(next_ifd, 0);
    }

    #[test]
    fn test_parse_ifd_multiple_entries_be() {
        // Create a synthetic big-endian IFD with 3 entries
        let mut data = Vec::new();

        // Entry count: 3 (big-endian)
        data.extend_from_slice(&3u16.to_be_bytes());

        // Entry 1: tag=0x0100 (ImageWidth), type=0x0003, count=1, value_offset=4000
        data.extend_from_slice(&0x0100u16.to_be_bytes());
        data.extend_from_slice(&0x0003u16.to_be_bytes());
        data.extend_from_slice(&1u32.to_be_bytes());
        data.extend_from_slice(&4000u32.to_be_bytes());

        // Entry 2: tag=0x0101 (ImageLength), type=0x0003, count=1, value_offset=3000
        data.extend_from_slice(&0x0101u16.to_be_bytes());
        data.extend_from_slice(&0x0003u16.to_be_bytes());
        data.extend_from_slice(&1u32.to_be_bytes());
        data.extend_from_slice(&3000u32.to_be_bytes());

        // Entry 3: tag=0x0111 (StripOffsets), type=0x0004, count=1, value_offset=8192
        data.extend_from_slice(&0x0111u16.to_be_bytes());
        data.extend_from_slice(&0x0004u16.to_be_bytes());
        data.extend_from_slice(&1u32.to_be_bytes());
        data.extend_from_slice(&8192u32.to_be_bytes());

        // Next IFD offset: 0
        data.extend_from_slice(&0u32.to_be_bytes());

        let mut cursor = Cursor::new(&data[..]);
        let file_size = 0x10000;

        let (entries, next_ifd) = parse_ifd(&mut cursor, false, file_size).unwrap();

        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].tag, 0x0100);
        assert_eq!(entries[0].value_offset, 4000);
        assert_eq!(entries[1].tag, 0x0101);
        assert_eq!(entries[1].value_offset, 3000);
        assert_eq!(entries[2].tag, 0x0111);
        assert_eq!(entries[2].value_offset, 8192);
        assert_eq!(next_ifd, 0);
    }

    #[test]
    fn test_parse_ifd_with_next_ifd_pointer() {
        // Create an IFD with a non-zero next IFD pointer
        let mut data = Vec::new();

        // Entry count: 1 (little-endian)
        data.extend_from_slice(&1u16.to_le_bytes());

        // Entry 1: tag=0x0100, type=0x0003, count=1, value_offset=100
        data.extend_from_slice(&0x0100u16.to_le_bytes());
        data.extend_from_slice(&0x0003u16.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&100u32.to_le_bytes());

        // Next IFD offset: 0x5000
        data.extend_from_slice(&0x5000u32.to_le_bytes());

        let mut cursor = Cursor::new(&data[..]);
        let file_size = 0x10000;

        let (entries, next_ifd) = parse_ifd(&mut cursor, true, file_size).unwrap();

        assert_eq!(entries.len(), 1);
        assert_eq!(next_ifd, 0x5000);
    }

    #[test]
    fn test_parse_ifd_too_many_entries() {
        // Create an IFD with entry_count > 1000 (should return CorruptedFile error)
        let mut data = Vec::new();

        // Entry count: 1001 (exceeds limit)
        data.extend_from_slice(&1001u16.to_le_bytes());

        let mut cursor = Cursor::new(&data[..]);
        let file_size = 0x10000;

        let result = parse_ifd(&mut cursor, true, file_size);

        assert!(result.is_err());
        match result {
            Err(DecodeError::CorruptedFile(msg)) => {
                assert!(msg.contains("Too many IFD entries"));
            }
            _ => panic!("Expected CorruptedFile error"),
        }
    }

    #[test]
    fn test_parse_ifd_invalid_offset_skipped() {
        // Create an IFD where one entry has value_offset > file_size (should be skipped)
        let mut data = Vec::new();

        // Entry count: 2
        data.extend_from_slice(&2u16.to_le_bytes());

        // Entry 1: tag=0x0100, type=0x0003, count=1, value_offset=100 (valid)
        data.extend_from_slice(&0x0100u16.to_le_bytes());
        data.extend_from_slice(&0x0003u16.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&100u32.to_le_bytes());

        // Entry 2: tag=0x0101, type=0x0003, count=1, value_offset=0x20000 (invalid - exceeds file_size)
        data.extend_from_slice(&0x0101u16.to_le_bytes());
        data.extend_from_slice(&0x0003u16.to_le_bytes());
        data.extend_from_slice(&1u32.to_le_bytes());
        data.extend_from_slice(&0x20000u32.to_le_bytes());

        // Next IFD offset: 0
        data.extend_from_slice(&0u32.to_le_bytes());

        let mut cursor = Cursor::new(&data[..]);
        let file_size = 0x10000; // file_size is smaller than the second entry's offset

        let (entries, next_ifd) = parse_ifd(&mut cursor, true, file_size).unwrap();

        // Only the first entry should be present (second was skipped due to invalid offset)
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].tag, 0x0100);
        assert_eq!(entries[0].value_offset, 100);
        assert_eq!(next_ifd, 0);
    }
}
