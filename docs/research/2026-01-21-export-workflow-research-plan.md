# Export Workflow Research Plan

**Created**: 2026-01-21 16:54 EST
**Purpose**: Research implementation requirements for the Export workflow feature

## Overview

The Export workflow is the last major v1 requirement. It allows users to export selected photos as JPEGs with quality control, resizing, and filename templating.

## Requirements from Spec (Section 3.7)

### Export Inputs
- Destination folder (user selected via folder picker)
- File naming template + numbering:
  - `{orig}` - original filename without extension
  - `{seq:N}` - sequence number with padding
  - `{date}` - capture date (optional)
- JPEG quality slider
- Resize option: none, or long-edge pixels

### Export Scope
- Default: export Picks only
- Option: export current selection
- Rejects excluded unless explicitly included

### Output Behavior
- Create files in destination folder
- Collision handling: auto-increment number

### Progress
- Progress dialog: total count, current file (ETA not required)
- On completion: show destination path

## Research Areas

### Area 1: File System Access API - Writing Files
**Questions**:
- How do we request write access to a folder?
- What's the API for creating/writing files?
- How do we handle permissions and errors?
- What's the difference from read-only access?

**Key Topics**:
- `showDirectoryPicker()` with write mode
- `FileSystemFileHandle.createWritable()`
- Error handling (permission denied, disk full)
- Browser compatibility notes

### Area 2: JPEG Encoding in WASM
**Questions**:
- Which Rust crates can encode JPEG?
- What quality settings are available?
- How to pass pixel data from JS to WASM for encoding?
- Performance considerations for large images

**Key Topics**:
- `image` crate JPEG encoding
- Alternative: `mozjpeg` for better compression
- Memory management for large buffers
- Quality parameter mapping (0-100)

### Area 3: Image Resizing for Export
**Questions**:
- How to implement long-edge resizing?
- What interpolation to use for downscaling?
- How to handle aspect ratio correctly?
- Should we use existing resize code or create export-specific?

**Key Topics**:
- Existing `resize_image()` function in Rust
- Long-edge calculation logic
- Quality vs speed tradeoffs

### Area 4: Filename Template Parsing
**Questions**:
- What parsing approach to use?
- How to handle padding in `{seq:N}`?
- How to extract date from EXIF/metadata?
- Edge cases (special characters, missing metadata)

**Key Topics**:
- Simple regex-based token replacement
- Date formatting options
- Validation and error handling
- Test cases

### Area 5: Current Codebase Review
**Questions**:
- What FileSystem abstraction exists?
- What edit pipeline produces final pixels?
- How are assets and their edits stored?
- What UI patterns exist for modals/progress?

**Key Files to Review**:
- `packages/core/src/filesystem/` - FS abstraction
- `packages/core/src/decode/` - Image processing
- `crates/literoom-core/src/` - Rust image ops
- `apps/web/app/components/edit/` - Modal patterns
- `apps/web/app/stores/` - State management

### Area 6: UI/UX Design Patterns
**Questions**:
- What modal patterns does Nuxt UI provide?
- How to implement progress tracking?
- What form controls exist (sliders, inputs)?
- Toast/notification patterns for completion

**Key Components**:
- `UModal` - Modal dialog
- `UProgress` - Progress indicator
- `URange` - Slider for quality
- `UInput` - Template input
- `UButton` - Actions

## Research Deliverables

Each research area should produce:
1. Key findings and recommendations
2. Code examples or patterns to follow
3. Potential pitfalls to avoid
4. Links to relevant documentation

## Synthesis Goals

After all research areas complete:
1. Identify the complete export pipeline
2. Document all required WASM bindings
3. Define the UI component structure
4. List all files to create/modify
5. Estimate implementation phases
