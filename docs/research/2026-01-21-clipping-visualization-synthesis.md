# Clipping Visualization Improvements - Research Synthesis

## Date: 2026-01-21

## Current Implementation Analysis

### ClippingMap Data Structure (`useEditPreview.ts:28-47`)

```typescript
export interface ClippingMap {
  /** Clipping data for each pixel (0=none, 1=shadow, 2=highlight, 3=both) */
  data: Uint8Array
  width: number
  height: number
  hasShadowClipping: boolean
  hasHighlightClipping: boolean
}
```

**Current bit encoding** (simple 2-bit flags):
- `0` = no clipping
- `1` = shadow clipping (any channel at 0)
- `2` = highlight clipping (any channel at 255)
- `3` = both shadow and highlight clipping

### Detection Logic (`useEditPreview.ts:229-267`)

```typescript
function detectClippedPixels(pixels, width, height): ClippingMap {
  // For each pixel:
  // Shadow clipping: any channel at 0
  if (r === 0 || g === 0 || b === 0) {
    clipType |= 1  // Mark bit 0
  }
  // Highlight clipping: any channel at 255
  if (r === 255 || g === 255 || b === 255) {
    clipType |= 2  // Mark bit 1
  }
}
```

### Overlay Rendering (`useClippingOverlay.ts`)

Colors used:
- Shadow: Blue `rgba(59, 130, 246, 0.4)`
- Highlight: Red `rgba(239, 68, 68, 0.4)`
- Both: Purple `rgba(168, 85, 247, 0.4)`

### Histogram Indicators (`EditHistogramDisplaySVG.vue`)

- Top-left triangle: Blue `#3b82f6` for shadow clipping
- Top-right triangle: Red `#ef4444` for highlight clipping
- Simple presence detection from `histogram.hasShadowClipping` / `histogram.hasHighlightClipping`

## Lightroom's Per-Channel Clipping Visualization

### Per-Channel Color Coding

When displaying clipping overlays, Lightroom shows which specific channels are clipped using color coding:

**Highlight Clipping Colors:**
| Clipped Channels | Color | RGB Value |
|-----------------|-------|-----------|
| R only | Red | (255, 0, 0) |
| G only | Green | (0, 255, 0) |
| B only | Blue | (0, 0, 255) |
| R + G | Yellow | (255, 255, 0) |
| R + B | Magenta | (255, 0, 255) |
| G + B | Cyan | (0, 255, 255) |
| R + G + B | White | (255, 255, 255) |

**Shadow Clipping Colors:**
| Clipped Channels | Color | RGB Value |
|-----------------|-------|-----------|
| R only | Cyan tint | Shows what's missing: no R = GB = Cyan |
| G only | Magenta tint | Shows what's missing: no G = RB = Magenta |
| B only | Yellow tint | Shows what's missing: no B = RG = Yellow |
| R + G | Blue | Only B remaining |
| R + B | Green | Only G remaining |
| G + B | Red | Only R remaining |
| R + G + B | Black | All clipped |

### Histogram Triangle Indicators

Lightroom's triangles show overall clipping status:
- **White triangle** = All channels clipping somewhere in image (true blown/crushed)
- **Colored triangle** = Only some channels clipping (e.g., red triangle if only R channel clips)

## Proposed New Data Structure

To support per-channel visualization, we need to expand the ClippingMap encoding.

### Option A: 6-bit Encoding (Recommended)

Use 6 bits per pixel to track individual channel clipping:
- Bit 0: R shadow (R = 0)
- Bit 1: G shadow (G = 0)
- Bit 2: B shadow (B = 0)
- Bit 3: R highlight (R = 255)
- Bit 4: G highlight (G = 255)
- Bit 5: B highlight (B = 255)

```typescript
export interface ClippingMapV2 {
  /** Per-channel clipping data (6-bit encoding per pixel) */
  data: Uint8Array
  width: number
  height: number
  /** Per-channel clipping status for histogram triangles */
  shadowClipping: { r: boolean; g: boolean; b: boolean }
  highlightClipping: { r: boolean; g: boolean; b: boolean }
}
```

Bit masks:
- `0b000001` (1) = R shadow
- `0b000010` (2) = G shadow
- `0b000100` (4) = B shadow
- `0b001000` (8) = R highlight
- `0b010000` (16) = G highlight
- `0b100000` (32) = B highlight

This fits in a single byte per pixel (Uint8Array) with room to spare.

### Overlay Color Mapping

For highlights, render the actual clipped channel colors:
```typescript
function getHighlightColor(clipBits: number): [number, number, number, number] {
  const rClip = (clipBits & 8) !== 0
  const gClip = (clipBits & 16) !== 0
  const bClip = (clipBits & 32) !== 0

  // Build color from clipped channels
  return [
    rClip ? 255 : 0,
    gClip ? 255 : 0,
    bClip ? 255 : 0,
    128  // Semi-transparent
  ]
}
```

For shadows, show what's "left" (complementary color):
```typescript
function getShadowColor(clipBits: number): [number, number, number, number] {
  const rClip = (clipBits & 1) !== 0
  const gClip = (clipBits & 2) !== 0
  const bClip = (clipBits & 4) !== 0

  // Show remaining channels (inverse of clipped)
  return [
    rClip ? 0 : 255,  // If R clipped, no R; else full R
    gClip ? 0 : 255,
    bClip ? 0 : 255,
    128
  ]
}
```

### Histogram Triangle Color Logic

```typescript
function getTriangleColor(clipping: { r: boolean; g: boolean; b: boolean }): string {
  const { r, g, b } = clipping

  // All channels = white
  if (r && g && b) return '#ffffff'

  // Two channels = secondary color
  if (r && g) return '#ffff00'  // Yellow
  if (r && b) return '#ff00ff'  // Magenta
  if (g && b) return '#00ffff'  // Cyan

  // One channel = primary color
  if (r) return '#ff0000'
  if (g) return '#00ff00'
  if (b) return '#0000ff'

  // No clipping
  return 'transparent'
}
```

## Files to Modify

1. **`useEditPreview.ts`**:
   - Update `ClippingMap` interface to `ClippingMapV2`
   - Modify `detectClippedPixels()` to use 6-bit encoding
   - Add per-channel tracking to return value

2. **`useClippingOverlay.ts`**:
   - Update color mapping logic to use per-channel encoding
   - Add `getHighlightColor()` and `getShadowColor()` functions

3. **`useHistogramDisplaySVG.ts`**:
   - Update to track per-channel clipping from pixel data
   - Return per-channel clipping info instead of just booleans

4. **`EditHistogramDisplaySVG.vue`**:
   - Update triangle color logic to use per-channel info
   - Show colored triangles based on which channels are clipping

5. **`EditHistogramDisplay.vue`** (if exists, legacy canvas version):
   - Same updates as SVG version

## Performance Considerations

- Detection loop is already O(n) where n = pixel count
- New encoding adds a few more bitwise operations per pixel (negligible)
- Memory usage unchanged (still 1 byte per pixel)
- Overlay rendering slightly more complex but still O(n)

## Backward Compatibility

The new encoding is a superset of the old:
- Old `hasShadowClipping` = `shadowClipping.r || shadowClipping.g || shadowClipping.b`
- Old `hasHighlightClipping` = `highlightClipping.r || highlightClipping.g || highlightClipping.b`

## Summary

The improvement involves:
1. Expanding ClippingMap to 6-bit per-channel encoding
2. Updating overlay to show per-channel colors
3. Updating histogram triangles to show per-channel status

This provides Lightroom-like per-channel clipping visualization that helps photographers identify which channels are problematic and whether the clipping is "true" (all channels) or partial (recoverable).
