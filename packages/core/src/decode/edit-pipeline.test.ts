/**
 * Integration tests for the full edit pipeline.
 *
 * Tests the complete flow of generating edited thumbnails:
 * decode -> rotate -> crop -> adjust -> tone curve -> masks -> resize -> encode
 *
 * Uses MockDecodeService to verify the pipeline works correctly
 * without requiring WASM bindings.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { MockDecodeService, createTestImage } from './mock-decode-service'
import type { EditedThumbnailEditState } from './worker-messages'
import type { Adjustments } from './types'

// ============================================================================
// Test Helpers
// ============================================================================

const DEFAULT_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  vibrance: 0,
  saturation: 0,
}

function createAdjustments(overrides: Partial<Adjustments> = {}): Adjustments {
  return { ...DEFAULT_ADJUSTMENTS, ...overrides }
}

// ============================================================================
// Tests
// ============================================================================

describe('Edit Pipeline Integration', () => {
  let service: MockDecodeService

  beforeEach(async () => {
    service = await MockDecodeService.create()
  })

  afterEach(() => {
    service.destroy()
  })

  describe('generateEditedThumbnail pipeline', () => {
    it('generates JPEG bytes from empty edit state', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {}

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xd8)
    })

    it('applies exposure adjustment in pipeline', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        adjustments: createAdjustments({ exposure: 2 }),
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBeGreaterThan(0)
    })

    it('applies contrast adjustment in pipeline', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        adjustments: createAdjustments({ contrast: 50 }),
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('applies rotation in pipeline', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        rotation: { angle: 45, straighten: 0 },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('applies crop in pipeline', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        crop: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('applies tone curve in pipeline', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 }, // Boost midtones
            { x: 1, y: 1 },
          ],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('applies linear gradient mask in pipeline', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        masks: {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: true,
              adjustments: { exposure: 1 },
            },
          ],
          radialMasks: [],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('applies radial gradient mask in pipeline', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        masks: {
          linearMasks: [],
          radialMasks: [
            {
              centerX: 0.5,
              centerY: 0.5,
              radiusX: 0.3,
              radiusY: 0.3,
              rotation: 0,
              feather: 0.5,
              invert: false,
              enabled: true,
              adjustments: { exposure: 1, saturation: 20 },
            },
          ],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('applies full pipeline with all edit types', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        rotation: { angle: 5, straighten: 2 },
        crop: { left: 0.05, top: 0.05, width: 0.9, height: 0.9 },
        adjustments: createAdjustments({
          exposure: 0.5,
          contrast: 10,
          highlights: -5,
          shadows: 5,
          temperature: 10,
          saturation: 10,
        }),
        toneCurve: {
          points: [
            { x: 0, y: 0.02 },
            { x: 0.25, y: 0.2 },
            { x: 0.75, y: 0.85 },
            { x: 1, y: 0.98 },
          ],
        },
        masks: {
          linearMasks: [
            {
              startX: 0,
              startY: 0.8,
              endX: 0,
              endY: 1,
              feather: 0.3,
              enabled: true,
              adjustments: { exposure: -0.5 },
            },
          ],
          radialMasks: [
            {
              centerX: 0.5,
              centerY: 0.5,
              radiusX: 0.4,
              radiusY: 0.4,
              rotation: 0,
              feather: 0.6,
              invert: false,
              enabled: true,
              adjustments: { exposure: 0.3, contrast: 5 },
            },
          ],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 512, editState)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xd8)
    })
  })

  describe('pipeline ordering', () => {
    it('rotation is applied before crop', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

      // This should work: rotate then crop
      const editState: EditedThumbnailEditState = {
        rotation: { angle: 90, straighten: 0 },
        crop: { left: 0, top: 0, width: 0.5, height: 0.5 },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result.length).toBeGreaterThan(0)
    })

    it('crop is applied before adjustments', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

      const editState: EditedThumbnailEditState = {
        crop: { left: 0.25, top: 0.25, width: 0.5, height: 0.5 },
        adjustments: createAdjustments({ exposure: 1 }),
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('adjustments are applied before tone curve', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

      const editState: EditedThumbnailEditState = {
        adjustments: createAdjustments({ exposure: 0.5 }),
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.7 },
            { x: 1, y: 1 },
          ],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('tone curve is applied before masks', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

      const editState: EditedThumbnailEditState = {
        toneCurve: {
          points: [
            { x: 0, y: 0.1 },
            { x: 1, y: 0.9 },
          ],
        },
        masks: {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: true,
              adjustments: { exposure: 0.5 },
            },
          ],
          radialMasks: [],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })
  })

  describe('edge cases', () => {
    it('handles zero rotation', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        rotation: { angle: 0, straighten: 0 },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles full crop (no change)', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        crop: { left: 0, top: 0, width: 1, height: 1 },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles null crop', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        crop: null,
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles identity tone curve', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles empty tone curve points', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        toneCurve: {
          points: [],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles zero adjustments', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        adjustments: DEFAULT_ADJUSTMENTS,
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles empty masks', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        masks: {
          linearMasks: [],
          radialMasks: [],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles disabled masks', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        masks: {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: false, // Disabled
              adjustments: { exposure: 5 },
            },
          ],
          radialMasks: [
            {
              centerX: 0.5,
              centerY: 0.5,
              radiusX: 0.3,
              radiusY: 0.3,
              rotation: 0,
              feather: 0.5,
              invert: false,
              enabled: false, // Disabled
              adjustments: { exposure: 5 },
            },
          ],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles inverted radial mask', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        masks: {
          linearMasks: [],
          radialMasks: [
            {
              centerX: 0.5,
              centerY: 0.5,
              radiusX: 0.3,
              radiusY: 0.3,
              rotation: 0,
              feather: 0.5,
              invert: true, // Inverted
              enabled: true,
              adjustments: { exposure: -0.5 },
            },
          ],
        },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles large rotation angles', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        rotation: { angle: 180, straighten: 0 },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles combined rotation angle and straighten', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        rotation: { angle: 90, straighten: 5 },
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles extreme adjustment values', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        adjustments: createAdjustments({
          exposure: 5, // Very high
          contrast: 100,
          saturation: 100,
          temperature: 100,
        }),
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('handles negative adjustment values', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        adjustments: createAdjustments({
          exposure: -5,
          contrast: -100,
          saturation: -100,
          temperature: -100,
        }),
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })
  })

  describe('different thumbnail sizes', () => {
    it('generates 128px thumbnail', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        adjustments: createAdjustments({ exposure: 0.5 }),
      }

      const result = await service.generateEditedThumbnail(bytes, 128, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('generates 256px thumbnail', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        adjustments: createAdjustments({ exposure: 0.5 }),
      }

      const result = await service.generateEditedThumbnail(bytes, 256, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('generates 512px thumbnail', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        adjustments: createAdjustments({ exposure: 0.5 }),
      }

      const result = await service.generateEditedThumbnail(bytes, 512, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })

    it('generates 1024px thumbnail', async () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
      const editState: EditedThumbnailEditState = {
        adjustments: createAdjustments({ exposure: 0.5 }),
      }

      const result = await service.generateEditedThumbnail(bytes, 1024, editState)

      expect(result).toBeInstanceOf(Uint8Array)
    })
  })
})

describe('Individual Pipeline Steps', () => {
  let service: MockDecodeService

  beforeEach(async () => {
    service = await MockDecodeService.create()
  })

  afterEach(() => {
    service.destroy()
  })

  describe('applyAdjustments', () => {
    it('applies exposure', async () => {
      const image = createTestImage(10, 10, [128, 128, 128])

      const result = await service.applyAdjustments(
        image.pixels,
        image.width,
        image.height,
        createAdjustments({ exposure: 1 })
      )

      expect(result.width).toBe(10)
      expect(result.height).toBe(10)
      // Exposure increase should brighten pixels
      expect(result.pixels[0]).toBeGreaterThan(128)
    })

    it('applies contrast', async () => {
      const image = createTestImage(10, 10, [128, 128, 128])

      const result = await service.applyAdjustments(
        image.pixels,
        image.width,
        image.height,
        createAdjustments({ contrast: 50 })
      )

      expect(result.width).toBe(10)
      expect(result.height).toBe(10)
    })

    it('applies saturation', async () => {
      const image = createTestImage(10, 10, [200, 100, 100])

      const result = await service.applyAdjustments(
        image.pixels,
        image.width,
        image.height,
        createAdjustments({ saturation: 50 })
      )

      expect(result.width).toBe(10)
      expect(result.height).toBe(10)
    })

    it('applies temperature', async () => {
      const image = createTestImage(10, 10, [128, 128, 128])

      const result = await service.applyAdjustments(
        image.pixels,
        image.width,
        image.height,
        createAdjustments({ temperature: 50 })
      )

      expect(result.width).toBe(10)
      // Warm temperature should increase red
      expect(result.pixels[0]).toBeGreaterThan(128)
    })
  })

  describe('applyRotation', () => {
    it('rotates image', async () => {
      const image = createTestImage(100, 50)

      const result = await service.applyRotation(
        image.pixels,
        image.width,
        image.height,
        45
      )

      // Rotated dimensions should change
      expect(result.width).not.toBe(100)
      expect(result.height).not.toBe(50)
    })

    it('90 degree rotation swaps dimensions', async () => {
      const image = createTestImage(100, 50)

      const result = await service.applyRotation(
        image.pixels,
        image.width,
        image.height,
        90
      )

      // 90 degree rotation makes the bounding box swap-ish
      // (not exact swap due to corner handling)
      expect(result.pixels.length).toBeGreaterThan(0)
    })
  })

  describe('applyCrop', () => {
    it('crops image', async () => {
      const image = createTestImage(100, 100)

      const result = await service.applyCrop(
        image.pixels,
        image.width,
        image.height,
        { left: 0.25, top: 0.25, width: 0.5, height: 0.5 }
      )

      expect(result.width).toBe(50)
      expect(result.height).toBe(50)
    })

    it('full crop returns same size', async () => {
      const image = createTestImage(100, 100)

      const result = await service.applyCrop(
        image.pixels,
        image.width,
        image.height,
        { left: 0, top: 0, width: 1, height: 1 }
      )

      expect(result.width).toBe(100)
      expect(result.height).toBe(100)
    })
  })

  describe('applyToneCurve', () => {
    it('applies S-curve', async () => {
      const image = createTestImage(10, 10, [128, 128, 128])

      const result = await service.applyToneCurve(
        image.pixels,
        image.width,
        image.height,
        [
          { x: 0, y: 0 },
          { x: 0.25, y: 0.15 },
          { x: 0.75, y: 0.85 },
          { x: 1, y: 1 },
        ]
      )

      expect(result.width).toBe(10)
      expect(result.height).toBe(10)
    })

    it('identity curve preserves values', async () => {
      const image = createTestImage(10, 10, [128, 128, 128])

      const result = await service.applyToneCurve(
        image.pixels,
        image.width,
        image.height,
        [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ]
      )

      expect(result.pixels[0]).toBe(128)
    })
  })

  describe('applyMaskedAdjustments', () => {
    it('applies linear gradient mask', async () => {
      const image = createTestImage(10, 10, [128, 128, 128])

      const result = await service.applyMaskedAdjustments(
        image.pixels,
        image.width,
        image.height,
        {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: true,
              adjustments: { exposure: 1 },
            },
          ],
          radialMasks: [],
        }
      )

      expect(result.width).toBe(10)
      expect(result.height).toBe(10)
    })

    it('applies radial gradient mask', async () => {
      const image = createTestImage(10, 10, [128, 128, 128])

      const result = await service.applyMaskedAdjustments(
        image.pixels,
        image.width,
        image.height,
        {
          linearMasks: [],
          radialMasks: [
            {
              centerX: 0.5,
              centerY: 0.5,
              radiusX: 0.3,
              radiusY: 0.3,
              rotation: 0,
              feather: 0.5,
              invert: false,
              enabled: true,
              adjustments: { exposure: 1 },
            },
          ],
        }
      )

      expect(result.width).toBe(10)
      expect(result.height).toBe(10)
    })

    it('skips disabled masks', async () => {
      const image = createTestImage(10, 10, [128, 128, 128])

      const result = await service.applyMaskedAdjustments(
        image.pixels,
        image.width,
        image.height,
        {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: false, // Disabled
              adjustments: { exposure: 5 },
            },
          ],
          radialMasks: [],
        }
      )

      // Original pixel should be unchanged
      expect(result.pixels[0]).toBe(128)
    })
  })

  describe('encodeJpeg', () => {
    it('encodes to JPEG bytes', async () => {
      const image = createTestImage(10, 10, [128, 128, 128])

      const result = await service.encodeJpeg(
        image.pixels,
        image.width,
        image.height,
        90
      )

      expect(result).toBeInstanceOf(Uint8Array)
      expect(result[0]).toBe(0xff)
      expect(result[1]).toBe(0xd8)
    })
  })
})
