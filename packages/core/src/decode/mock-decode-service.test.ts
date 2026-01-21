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
