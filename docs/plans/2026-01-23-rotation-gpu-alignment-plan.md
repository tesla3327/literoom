# Rotation GPU Alignment Fix - Implementation Plan

**Date**: 2026-01-23
**Issue**: Rotation causes GPU error (Critical)
**Status**: Ready for Implementation

## Overview

Fix the WebGPU bytesPerRow alignment issue that causes rotation (and potentially other GPU operations) to fail with images where `width * 4` is not a multiple of 256.

## Implementation Tasks

### Task 1: Add Alignment Utilities to texture-utils.ts

Add two utility functions:
- `alignTo256(bytes: number): number` - Align bytes to 256
- `removeRowPadding(paddedData, width, height, alignedBytesPerRow)` - Strip padding from readback data

### Task 2: Update readTexturePixels() in texture-utils.ts

- Calculate aligned bytesPerRow
- Create buffer with aligned size
- Use aligned bytesPerRow in copyTextureToBuffer
- Remove padding from result before returning

### Task 3: Update rotation-pipeline.ts

- Apply alignment to bytesPerRow in apply() method
- Update buffer size calculation
- Remove padding from readback data

### Task 4: Update adjustments-pipeline.ts

- Apply alignment to bytesPerRow in apply() method
- Update buffer size calculation
- Remove padding from readback data

### Task 5: Update tone-curve-pipeline.ts

- Apply alignment to bytesPerRow in apply() method
- Update buffer size calculation
- Remove padding from readback data

### Task 6: Add Tests

- Test alignTo256() with various inputs
- Test removeRowPadding() with padded/unpadded data
- Test readTexturePixels() with edge case widths
- Integration test: rotation with odd-width images

### Task 7: Verify and Document

- Manual test rotation in the app
- Update docs/issues.md to mark as solved
- Update progress docs

## Files to Modify

1. `packages/core/src/gpu/texture-utils.ts` - Add utilities, update readTexturePixels
2. `packages/core/src/gpu/pipelines/rotation-pipeline.ts` - Add alignment
3. `packages/core/src/gpu/pipelines/adjustments-pipeline.ts` - Add alignment
4. `packages/core/src/gpu/pipelines/tone-curve-pipeline.ts` - Add alignment
5. `packages/core/src/gpu/texture-utils.test.ts` - Add tests

## Success Criteria

- [ ] Rotation works with any image width
- [ ] No GPU validation errors in console
- [ ] All existing tests pass
- [ ] New tests for alignment utilities pass
