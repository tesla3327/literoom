import { describe, expect, it } from 'vitest'
import { MockDecodeService, createTestImage } from './mock-decode-service'
import { DecodeError } from './types'

describe('MockDecodeService', () => {
  describe('create', () => {
    it('creates service in ready state', async () => {
      const service = await MockDecodeService.create()

      expect(service.state.status).toBe('ready')
      expect(service.isReady).toBe(true)
    })

    it('simulates init delay', async () => {
      const start = Date.now()
      const service = await MockDecodeService.create({ initDelay: 50 })
      const elapsed = Date.now() - start

      expect(service.isReady).toBe(true)
      expect(elapsed).toBeGreaterThanOrEqual(45) // Allow some timing variance
    })

    it('can fail initialization', async () => {
      await expect(MockDecodeService.create({ failInit: true })).rejects.toThrow(
        DecodeError
      )
    })
  })

  describe('decodeJpeg', () => {
    it('returns default 100x100 red image', async () => {
      const service = await MockDecodeService.create()
      const bytes = new Uint8Array([0xff, 0xd8])

      const result = await service.decodeJpeg(bytes)

      expect(result.width).toBe(100)
      expect(result.height).toBe(100)
      expect(result.pixels.length).toBe(100 * 100 * 3)
      // Check first pixel is red
      expect(result.pixels[0]).toBe(255)
      expect(result.pixels[1]).toBe(0)
      expect(result.pixels[2]).toBe(0)
    })

    it('uses custom handler when provided', async () => {
      const customImage = { width: 50, height: 50, pixels: new Uint8Array(50 * 50 * 3) }
      const service = await MockDecodeService.create({
        onDecodeJpeg: async () => customImage
      })

      const result = await service.decodeJpeg(new Uint8Array(0))

      expect(result).toBe(customImage)
    })

    it('simulates decode delay', async () => {
      const service = await MockDecodeService.create({ decodeDelay: 50 })
      const start = Date.now()

      await service.decodeJpeg(new Uint8Array(0))
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45)
    })
  })

  describe('decodeRawThumbnail', () => {
    it('returns default 160x120 green image', async () => {
      const service = await MockDecodeService.create()

      const result = await service.decodeRawThumbnail(new Uint8Array(0))

      expect(result.width).toBe(160)
      expect(result.height).toBe(120)
      // Check first pixel is green
      expect(result.pixels[0]).toBe(0)
      expect(result.pixels[1]).toBe(255)
      expect(result.pixels[2]).toBe(0)
    })
  })

  describe('generateThumbnail', () => {
    it('returns default 256x256 blue image', async () => {
      const service = await MockDecodeService.create()

      const result = await service.generateThumbnail(new Uint8Array(0))

      expect(result.width).toBe(256)
      expect(result.height).toBe(256)
      // Check first pixel is blue
      expect(result.pixels[0]).toBe(0)
      expect(result.pixels[1]).toBe(0)
      expect(result.pixels[2]).toBe(255)
    })

    it('respects custom size option', async () => {
      const service = await MockDecodeService.create()

      const result = await service.generateThumbnail(new Uint8Array(0), { size: 128 })

      expect(result.width).toBe(128)
      expect(result.height).toBe(128)
    })
  })

  describe('generatePreview', () => {
    it('returns 16:9 preview at maxEdge', async () => {
      const service = await MockDecodeService.create()

      const result = await service.generatePreview(new Uint8Array(0), { maxEdge: 1920 })

      expect(result.width).toBe(1920)
      expect(result.height).toBe(Math.round(1920 * (9 / 16)))
    })
  })

  describe('detectFileType', () => {
    it('detects JPEG files', async () => {
      const service = await MockDecodeService.create()
      const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

      const result = await service.detectFileType(jpegBytes)

      expect(result).toBe('jpeg')
    })

    it('detects RAW files (TIFF little-endian)', async () => {
      const service = await MockDecodeService.create()
      const rawBytes = new Uint8Array([0x49, 0x49, 0x2a, 0x00])

      const result = await service.detectFileType(rawBytes)

      expect(result).toBe('raw')
    })

    it('detects RAW files (TIFF big-endian)', async () => {
      const service = await MockDecodeService.create()
      const rawBytes = new Uint8Array([0x4d, 0x4d, 0x00, 0x2a])

      const result = await service.detectFileType(rawBytes)

      expect(result).toBe('raw')
    })

    it('returns unknown for unrecognized files', async () => {
      const service = await MockDecodeService.create()
      const unknownBytes = new Uint8Array([0x00, 0x00, 0x00, 0x00])

      const result = await service.detectFileType(unknownBytes)

      expect(result).toBe('unknown')
    })

    it('returns unknown for empty bytes', async () => {
      const service = await MockDecodeService.create()

      const result = await service.detectFileType(new Uint8Array(0))

      expect(result).toBe('unknown')
    })
  })

  describe('destroy', () => {
    it('sets state to error', async () => {
      const service = await MockDecodeService.create()

      service.destroy()

      expect(service.state.status).toBe('error')
      expect(service.state.error).toBe('Service destroyed')
      expect(service.isReady).toBe(false)
    })

    it('causes subsequent operations to fail', async () => {
      const service = await MockDecodeService.create()
      service.destroy()

      await expect(service.decodeJpeg(new Uint8Array(0))).rejects.toThrow(
        'Mock service not ready'
      )
    })
  })
})

describe('generateEditedThumbnail', () => {
  it('returns JPEG bytes (starts with JPEG magic bytes)', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      {}
    )

    // Verify it's a Uint8Array
    expect(result).toBeInstanceOf(Uint8Array)
    // Verify JPEG magic bytes (SOI marker)
    expect(result[0]).toBe(0xff)
    expect(result[1]).toBe(0xd8)
  })

  it('applies rotation when specified', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      { rotation: { angle: 45, straighten: 0 } }
    )

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('applies crop when specified', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      { crop: { left: 0.1, top: 0.1, width: 0.5, height: 0.5 } }
    )

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('applies adjustments when specified', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      {
        adjustments: {
          exposure: 1,
          contrast: 10,
          highlights: 0,
          shadows: 0,
          whites: 0,
          blacks: 0,
          temperature: 0,
          tint: 0,
          vibrance: 0,
          saturation: 0,
        },
      }
    )

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('applies tone curve when specified', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      {
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 },
            { x: 1, y: 1 },
          ],
        },
      }
    )

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('applies masked adjustments when specified', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      {
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
    )

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('applies full edit pipeline with all parameters', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      512,
      {
        rotation: { angle: 5, straighten: 2 },
        crop: { left: 0.05, top: 0.05, width: 0.9, height: 0.9 },
        adjustments: {
          exposure: 0.5,
          contrast: 20,
          highlights: -10,
          shadows: 10,
          whites: 5,
          blacks: -5,
          temperature: 10,
          tint: 5,
          vibrance: 15,
          saturation: 10,
        },
        toneCurve: {
          points: [
            { x: 0, y: 0.05 },
            { x: 0.25, y: 0.2 },
            { x: 0.75, y: 0.85 },
            { x: 1, y: 0.95 },
          ],
        },
        masks: {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 0.5,
              endY: 0.5,
              feather: 0.3,
              enabled: true,
              adjustments: { exposure: -0.5 },
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
              enabled: true,
              adjustments: { contrast: 15 },
            },
          ],
        },
      }
    )

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('fails when service is destroyed', async () => {
    const service = await MockDecodeService.create()
    service.destroy()

    await expect(
      service.generateEditedThumbnail(new Uint8Array([0xff, 0xd8]), 256, {})
    ).rejects.toThrow('Mock service not ready')
  })

  it('simulates decode delay', async () => {
    const service = await MockDecodeService.create({ decodeDelay: 50 })
    const start = Date.now()

    await service.generateEditedThumbnail(new Uint8Array([0xff, 0xd8]), 256, {})
    const elapsed = Date.now() - start

    // Should have delay from multiple pipeline stages
    expect(elapsed).toBeGreaterThanOrEqual(45)
  })

  it('skips rotation when angle is zero', async () => {
    const service = await MockDecodeService.create()

    // Should not throw and complete quickly
    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      { rotation: { angle: 0, straighten: 0 } }
    )

    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('handles combined rotation angle and straighten', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      { rotation: { angle: 10, straighten: 5 } }
    )

    expect(result).toBeInstanceOf(Uint8Array)
    expect(result.length).toBeGreaterThan(0)
  })

  it('skips tone curve when points form identity curve', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      {
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      }
    )

    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('handles empty masks array', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      {
        masks: {
          linearMasks: [],
          radialMasks: [],
        },
      }
    )

    expect(result).toBeInstanceOf(Uint8Array)
  })

  it('handles disabled masks', async () => {
    const service = await MockDecodeService.create()

    const result = await service.generateEditedThumbnail(
      new Uint8Array([0xff, 0xd8]),
      256,
      {
        masks: {
          linearMasks: [
            {
              startX: 0,
              startY: 0,
              endX: 1,
              endY: 1,
              feather: 0.5,
              enabled: false, // Disabled
              adjustments: { exposure: 1 },
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
              adjustments: { contrast: 15 },
            },
          ],
        },
      }
    )

    expect(result).toBeInstanceOf(Uint8Array)
  })
})

describe('createTestImage', () => {
  it('creates image with specified dimensions', () => {
    const image = createTestImage(10, 20)

    expect(image.width).toBe(10)
    expect(image.height).toBe(20)
    expect(image.pixels.length).toBe(10 * 20 * 3)
  })

  it('creates image with specified color', () => {
    const image = createTestImage(2, 2, [128, 64, 32])

    // Check all pixels have the color
    for (let i = 0; i < 4; i++) {
      expect(image.pixels[i * 3]).toBe(128)
      expect(image.pixels[i * 3 + 1]).toBe(64)
      expect(image.pixels[i * 3 + 2]).toBe(32)
    }
  })

  it('defaults to 1x1 red image', () => {
    const image = createTestImage()

    expect(image.width).toBe(1)
    expect(image.height).toBe(1)
    expect(image.pixels[0]).toBe(255)
    expect(image.pixels[1]).toBe(0)
    expect(image.pixels[2]).toBe(0)
  })
})
