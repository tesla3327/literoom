# Rotation GPU Alignment Fix - Research Synthesis

**Date**: 2026-01-23
**Issue**: Rotation causes GPU error (Critical)

## Problem

WebGPU requires `bytesPerRow` to be a multiple of 256 bytes when using `copyTextureToBuffer()`. The current implementation uses `bytesPerRow: width * 4` which fails for image widths where `width * 4` is not divisible by 256.

### Error Message
```
[GPUCapabilityService] Uncaptured GPU error: bytesPerRow (12068) is not a multiple of 256.
 - While encoding [CommandEncoder "Texture Readback Encoder"].CopyTextureToBuffer
```

## Root Cause

The `copyTextureToBuffer()` operation in WebGPU requires `bytesPerRow` to be aligned to 256 bytes. This constraint comes from underlying GPU hardware requirements in Metal (macOS/iOS), D3D12 (Windows), and Vulkan.

## Affected Locations

Four files need updates:

1. **`packages/core/src/gpu/texture-utils.ts`** (line 136)
   - `readTexturePixels()` function

2. **`packages/core/src/gpu/pipelines/adjustments-pipeline.ts`** (line 267)
   - `apply()` method

3. **`packages/core/src/gpu/pipelines/tone-curve-pipeline.ts`** (line 300)
   - `apply()` method

4. **`packages/core/src/gpu/pipelines/rotation-pipeline.ts`** (line 287)
   - `apply()` method

## Solution

### 1. Alignment Calculation Formula

```typescript
function alignTo256(bytesPerRow: number): number {
  return Math.ceil(bytesPerRow / 256) * 256;
}

// Usage
const unalignedBytesPerRow = width * 4;
const alignedBytesPerRow = alignTo256(unalignedBytesPerRow);
```

### 2. Buffer Size Calculation

The staging buffer must be sized to accommodate the aligned rows:
```typescript
const alignedBufferSize = alignedBytesPerRow * height;
```

### 3. Padding Removal on Readback

When extracting pixel data, the padding bytes at the end of each row must be skipped:

```typescript
function removeRowPadding(
  paddedData: Uint8Array,
  width: number,
  height: number,
  alignedBytesPerRow: number
): Uint8Array {
  const actualBytesPerRow = width * 4;

  // If no padding needed, return as-is
  if (alignedBytesPerRow === actualBytesPerRow) {
    return paddedData;
  }

  // Strip padding from each row
  const result = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcOffset = y * alignedBytesPerRow;
    const dstOffset = y * actualBytesPerRow;
    result.set(
      paddedData.subarray(srcOffset, srcOffset + actualBytesPerRow),
      dstOffset
    );
  }
  return result;
}
```

## Implementation Plan

1. Create alignment utility in `texture-utils.ts`
2. Update `readTexturePixels()` with alignment + padding removal
3. Update each pipeline's `apply()` method with alignment + padding removal
4. Add unit tests for alignment edge cases
5. Verify rotation works correctly in the app

## Test Cases

- Width = 100 (400 bytes → 512 aligned, needs padding removal)
- Width = 512 (2048 bytes → 2048 aligned, no padding needed)
- Width = 3017 (from error: 12068 bytes → 12288 aligned)
- Width = 1920 (7680 bytes → 7936 aligned)

## References

- [WebGPU Copying Data - WebGPU Fundamentals](https://webgpufundamentals.org/webgpu/lessons/webgpu-copying-data.html)
- [GPUCommandEncoder: copyTextureToBuffer() - MDN](https://developer.mozilla.org/en-US/docs/Web/API/GPUCommandEncoder/copyTextureToBuffer)
