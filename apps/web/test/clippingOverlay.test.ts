/**
 * Unit tests for clipping overlay color calculations.
 *
 * Tests the pure functions that calculate clipping overlay colors
 * based on channel clipping bits. These functions determine which
 * color to display for shadow and highlight clipping.
 */

import { describe, it, expect } from 'vitest'
import {
  CLIP_SHADOW_R,
  CLIP_SHADOW_G,
  CLIP_SHADOW_B,
  CLIP_HIGHLIGHT_R,
  CLIP_HIGHLIGHT_G,
  CLIP_HIGHLIGHT_B,
} from '~/composables/useEditPreview'

// ============================================================================
// Re-implement the color calculation functions for testing
// (These are inline in useClippingOverlay but we test the logic here)
// ============================================================================

const OVERLAY_ALPHA = 128
const SHADOW_INTENSITY = 200

/**
 * Get overlay color for highlight clipping.
 */
function getHighlightColor(clipBits: number): [number, number, number, number] {
  const rClip = (clipBits & CLIP_HIGHLIGHT_R) !== 0
  const gClip = (clipBits & CLIP_HIGHLIGHT_G) !== 0
  const bClip = (clipBits & CLIP_HIGHLIGHT_B) !== 0

  return [
    rClip ? 255 : 0,
    gClip ? 255 : 0,
    bClip ? 255 : 0,
    OVERLAY_ALPHA,
  ]
}

/**
 * Get overlay color for shadow clipping.
 */
function getShadowColor(clipBits: number): [number, number, number, number] {
  const rClip = (clipBits & CLIP_SHADOW_R) !== 0
  const gClip = (clipBits & CLIP_SHADOW_G) !== 0
  const bClip = (clipBits & CLIP_SHADOW_B) !== 0

  if (rClip && gClip && bClip) {
    return [40, 40, 40, 160]
  }

  return [
    rClip ? 0 : SHADOW_INTENSITY,
    gClip ? 0 : SHADOW_INTENSITY,
    bClip ? 0 : SHADOW_INTENSITY,
    OVERLAY_ALPHA,
  ]
}

// ============================================================================
// Highlight Clipping Tests
// ============================================================================

describe('highlight clipping colors', () => {
  describe('single channel clipping', () => {
    it('returns red for R channel only', () => {
      const color = getHighlightColor(CLIP_HIGHLIGHT_R)
      expect(color).toEqual([255, 0, 0, OVERLAY_ALPHA])
    })

    it('returns green for G channel only', () => {
      const color = getHighlightColor(CLIP_HIGHLIGHT_G)
      expect(color).toEqual([0, 255, 0, OVERLAY_ALPHA])
    })

    it('returns blue for B channel only', () => {
      const color = getHighlightColor(CLIP_HIGHLIGHT_B)
      expect(color).toEqual([0, 0, 255, OVERLAY_ALPHA])
    })
  })

  describe('two channel clipping', () => {
    it('returns yellow for R+G channels', () => {
      const color = getHighlightColor(CLIP_HIGHLIGHT_R | CLIP_HIGHLIGHT_G)
      expect(color).toEqual([255, 255, 0, OVERLAY_ALPHA])
    })

    it('returns magenta for R+B channels', () => {
      const color = getHighlightColor(CLIP_HIGHLIGHT_R | CLIP_HIGHLIGHT_B)
      expect(color).toEqual([255, 0, 255, OVERLAY_ALPHA])
    })

    it('returns cyan for G+B channels', () => {
      const color = getHighlightColor(CLIP_HIGHLIGHT_G | CLIP_HIGHLIGHT_B)
      expect(color).toEqual([0, 255, 255, OVERLAY_ALPHA])
    })
  })

  describe('all channel clipping', () => {
    it('returns white for all channels', () => {
      const color = getHighlightColor(CLIP_HIGHLIGHT_R | CLIP_HIGHLIGHT_G | CLIP_HIGHLIGHT_B)
      expect(color).toEqual([255, 255, 255, OVERLAY_ALPHA])
    })
  })

  describe('no clipping', () => {
    it('returns transparent black for no clipping', () => {
      const color = getHighlightColor(0)
      expect(color).toEqual([0, 0, 0, OVERLAY_ALPHA])
    })
  })

  describe('ignores shadow bits', () => {
    it('ignores shadow clipping bits', () => {
      // Only shadow bits set - should return transparent
      const color = getHighlightColor(CLIP_SHADOW_R | CLIP_SHADOW_G | CLIP_SHADOW_B)
      expect(color).toEqual([0, 0, 0, OVERLAY_ALPHA])
    })

    it('only uses highlight bits when mixed', () => {
      // R highlight + G shadow - should only show red
      const color = getHighlightColor(CLIP_HIGHLIGHT_R | CLIP_SHADOW_G)
      expect(color).toEqual([255, 0, 0, OVERLAY_ALPHA])
    })
  })
})

// ============================================================================
// Shadow Clipping Tests
// ============================================================================

describe('shadow clipping colors', () => {
  describe('single channel clipping', () => {
    it('returns cyan for R channel clipped (G+B remain)', () => {
      const color = getShadowColor(CLIP_SHADOW_R)
      expect(color).toEqual([0, SHADOW_INTENSITY, SHADOW_INTENSITY, OVERLAY_ALPHA])
    })

    it('returns magenta for G channel clipped (R+B remain)', () => {
      const color = getShadowColor(CLIP_SHADOW_G)
      expect(color).toEqual([SHADOW_INTENSITY, 0, SHADOW_INTENSITY, OVERLAY_ALPHA])
    })

    it('returns yellow for B channel clipped (R+G remain)', () => {
      const color = getShadowColor(CLIP_SHADOW_B)
      expect(color).toEqual([SHADOW_INTENSITY, SHADOW_INTENSITY, 0, OVERLAY_ALPHA])
    })
  })

  describe('two channel clipping', () => {
    it('returns blue for R+G clipped (only B remains)', () => {
      const color = getShadowColor(CLIP_SHADOW_R | CLIP_SHADOW_G)
      expect(color).toEqual([0, 0, SHADOW_INTENSITY, OVERLAY_ALPHA])
    })

    it('returns green for R+B clipped (only G remains)', () => {
      const color = getShadowColor(CLIP_SHADOW_R | CLIP_SHADOW_B)
      expect(color).toEqual([0, SHADOW_INTENSITY, 0, OVERLAY_ALPHA])
    })

    it('returns red for G+B clipped (only R remains)', () => {
      const color = getShadowColor(CLIP_SHADOW_G | CLIP_SHADOW_B)
      expect(color).toEqual([SHADOW_INTENSITY, 0, 0, OVERLAY_ALPHA])
    })
  })

  describe('all channel clipping', () => {
    it('returns dark gray for all channels clipped (pure black)', () => {
      const color = getShadowColor(CLIP_SHADOW_R | CLIP_SHADOW_G | CLIP_SHADOW_B)
      // Special case: all clipped shows dark overlay
      expect(color).toEqual([40, 40, 40, 160])
    })
  })

  describe('no clipping', () => {
    it('returns neutral gray for no clipping', () => {
      const color = getShadowColor(0)
      expect(color).toEqual([SHADOW_INTENSITY, SHADOW_INTENSITY, SHADOW_INTENSITY, OVERLAY_ALPHA])
    })
  })

  describe('ignores highlight bits', () => {
    it('ignores highlight clipping bits', () => {
      // Only highlight bits set - should return neutral (no shadow clipping)
      const color = getShadowColor(CLIP_HIGHLIGHT_R | CLIP_HIGHLIGHT_G | CLIP_HIGHLIGHT_B)
      expect(color).toEqual([SHADOW_INTENSITY, SHADOW_INTENSITY, SHADOW_INTENSITY, OVERLAY_ALPHA])
    })

    it('only uses shadow bits when mixed', () => {
      // R shadow + G highlight - should only show cyan (R shadow)
      const color = getShadowColor(CLIP_SHADOW_R | CLIP_HIGHLIGHT_G)
      expect(color).toEqual([0, SHADOW_INTENSITY, SHADOW_INTENSITY, OVERLAY_ALPHA])
    })
  })
})

// ============================================================================
// Clipping Bit Constants Tests
// ============================================================================

describe('clipping bit constants', () => {
  it('shadow bits are separate from highlight bits', () => {
    // No overlap between shadow and highlight bits
    const shadowMask = CLIP_SHADOW_R | CLIP_SHADOW_G | CLIP_SHADOW_B
    const highlightMask = CLIP_HIGHLIGHT_R | CLIP_HIGHLIGHT_G | CLIP_HIGHLIGHT_B

    expect(shadowMask & highlightMask).toBe(0)
  })

  it('each channel has unique bit', () => {
    // Shadow bits should all be different
    expect(CLIP_SHADOW_R).not.toBe(CLIP_SHADOW_G)
    expect(CLIP_SHADOW_G).not.toBe(CLIP_SHADOW_B)
    expect(CLIP_SHADOW_R).not.toBe(CLIP_SHADOW_B)

    // Highlight bits should all be different
    expect(CLIP_HIGHLIGHT_R).not.toBe(CLIP_HIGHLIGHT_G)
    expect(CLIP_HIGHLIGHT_G).not.toBe(CLIP_HIGHLIGHT_B)
    expect(CLIP_HIGHLIGHT_R).not.toBe(CLIP_HIGHLIGHT_B)
  })

  it('bits are powers of 2', () => {
    // Each constant should be a power of 2 (single bit set)
    const isPowerOf2 = (n: number) => n > 0 && (n & (n - 1)) === 0

    expect(isPowerOf2(CLIP_SHADOW_R)).toBe(true)
    expect(isPowerOf2(CLIP_SHADOW_G)).toBe(true)
    expect(isPowerOf2(CLIP_SHADOW_B)).toBe(true)
    expect(isPowerOf2(CLIP_HIGHLIGHT_R)).toBe(true)
    expect(isPowerOf2(CLIP_HIGHLIGHT_G)).toBe(true)
    expect(isPowerOf2(CLIP_HIGHLIGHT_B)).toBe(true)
  })
})

// ============================================================================
// Combined Clipping Scenarios
// ============================================================================

describe('combined clipping scenarios', () => {
  it('can have both shadow and highlight clipping simultaneously', () => {
    // A pixel could have R shadow clipped and B highlight clipped
    const clipBits = CLIP_SHADOW_R | CLIP_HIGHLIGHT_B

    const shadowColor = getShadowColor(clipBits)
    const highlightColor = getHighlightColor(clipBits)

    // Shadow: R clipped shows cyan
    expect(shadowColor).toEqual([0, SHADOW_INTENSITY, SHADOW_INTENSITY, OVERLAY_ALPHA])
    // Highlight: B clipped shows blue
    expect(highlightColor).toEqual([0, 0, 255, OVERLAY_ALPHA])
  })

  it('handles full tonal range clipping (very high contrast)', () => {
    // All shadows and all highlights clipped (extreme case)
    const clipBits = CLIP_SHADOW_R | CLIP_SHADOW_G | CLIP_SHADOW_B
      | CLIP_HIGHLIGHT_R | CLIP_HIGHLIGHT_G | CLIP_HIGHLIGHT_B

    const shadowColor = getShadowColor(clipBits)
    const highlightColor = getHighlightColor(clipBits)

    // Shadow: all clipped = dark gray
    expect(shadowColor).toEqual([40, 40, 40, 160])
    // Highlight: all clipped = white
    expect(highlightColor).toEqual([255, 255, 255, OVERLAY_ALPHA])
  })
})

// ============================================================================
// Edge Cases
// ============================================================================

describe('edge cases', () => {
  it('handles arbitrary bit patterns', () => {
    // Random bit pattern that doesn't match any valid clipping
    const randomBits = 0b11111111

    // Should still produce valid colors
    const shadowColor = getShadowColor(randomBits)
    const highlightColor = getHighlightColor(randomBits)

    expect(shadowColor.length).toBe(4)
    expect(highlightColor.length).toBe(4)

    // All values should be valid RGBA
    for (const component of shadowColor) {
      expect(component).toBeGreaterThanOrEqual(0)
      expect(component).toBeLessThanOrEqual(255)
    }
    for (const component of highlightColor) {
      expect(component).toBeGreaterThanOrEqual(0)
      expect(component).toBeLessThanOrEqual(255)
    }
  })

  it('handles negative numbers (signed interpretation)', () => {
    // JavaScript uses signed 32-bit integers, -1 = all bits set
    const allBits = -1

    const shadowColor = getShadowColor(allBits)
    const highlightColor = getHighlightColor(allBits)

    // Should produce valid colors (all channels clipped)
    expect(shadowColor).toEqual([40, 40, 40, 160])
    expect(highlightColor).toEqual([255, 255, 255, OVERLAY_ALPHA])
  })
})
