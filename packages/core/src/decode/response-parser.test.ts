/**
 * Unit tests for parseDecodeResponse.
 *
 * Tests cover all response types and edge cases for the shared response parser.
 */

import { describe, it, expect } from 'vitest'
import { parseDecodeResponse } from './response-parser'
import { DecodeError } from './types'
import type { DecodeResponse } from './worker-messages'

describe('parseDecodeResponse', () => {
  describe('error response', () => {
    it('returns error result for error response', () => {
      const response: DecodeResponse = {
        id: 'test-id',
        type: 'error',
        message: 'Test error',
        code: 'DECODE_ERROR'
      }

      const result = parseDecodeResponse(response)

      expect(result.type).toBe('error')
      if (result.type === 'error') {
        expect(result.error).toBeInstanceOf(DecodeError)
        expect(result.error.message).toBe('Test error')
        expect(result.error.code).toBe('DECODE_ERROR')
      }
    })

    it('handles different error codes', () => {
      const response: DecodeResponse = {
        id: 'test-id',
        type: 'error',
        message: 'Format error',
        code: 'INVALID_FORMAT'
      }

      const result = parseDecodeResponse(response)

      expect(result.type).toBe('error')
      if (result.type === 'error') {
        expect(result.error.code).toBe('INVALID_FORMAT')
      }
    })
  })

  describe('file-type response', () => {
    it('returns file type for jpeg', () => {
      const response: DecodeResponse = {
        id: 'test-id',
        type: 'file-type',
        fileType: 'jpeg'
      }

      const result = parseDecodeResponse(response)

      expect(result.type).toBe('success')
      if (result.type === 'success') {
        expect(result.value).toBe('jpeg')
      }
    })

    it('returns file type for arw', () => {
      const response: DecodeResponse = {
        id: 'test-id',
        type: 'file-type',
        fileType: 'arw'
      }

      const result = parseDecodeResponse(response)

      expect(result.type).toBe('success')
      if (result.type === 'success') {
        expect(result.value).toBe('arw')
      }
    })
  })

  describe('success response', () => {
    it('returns DecodedImage for success response', () => {
      const pixels = new Uint8Array([1, 2, 3, 4, 5, 6])
      const response: DecodeResponse = {
        id: 'test-id',
        type: 'success',
        width: 2,
        height: 1,
        pixels
      }

      const result = parseDecodeResponse(response)

      expect(result.type).toBe('success')
      if (result.type === 'success') {
        expect(result.value).toEqual({
          width: 2,
          height: 1,
          pixels
        })
      }
    })
  })

  describe('tone-curve-result response', () => {
    it('returns DecodedImage for tone-curve-result', () => {
      const pixels = new Uint8Array([10, 20, 30])
      const response: DecodeResponse = {
        id: 'test-id',
        type: 'tone-curve-result',
        width: 1,
        height: 1,
        pixels
      }

      const result = parseDecodeResponse(response)

      expect(result.type).toBe('success')
      if (result.type === 'success') {
        expect(result.value).toEqual({
          width: 1,
          height: 1,
          pixels
        })
      }
    })
  })

  describe('histogram response', () => {
    it('returns HistogramData for histogram response', () => {
      const red = new Uint32Array(256)
      const green = new Uint32Array(256)
      const blue = new Uint32Array(256)
      const luminance = new Uint32Array(256)

      const response: DecodeResponse = {
        id: 'test-id',
        type: 'histogram',
        red,
        green,
        blue,
        luminance,
        maxValue: 1000,
        hasHighlightClipping: true,
        hasShadowClipping: false
      }

      const result = parseDecodeResponse(response)

      expect(result.type).toBe('success')
      if (result.type === 'success') {
        expect(result.value).toEqual({
          red,
          green,
          blue,
          luminance,
          maxValue: 1000,
          hasHighlightClipping: true,
          hasShadowClipping: false
        })
      }
    })
  })

  describe('encode-jpeg-result response', () => {
    it('returns Uint8Array for encode-jpeg-result', () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])
      const response: DecodeResponse = {
        id: 'test-id',
        type: 'encode-jpeg-result',
        bytes
      }

      const result = parseDecodeResponse(response)

      expect(result.type).toBe('success')
      if (result.type === 'success') {
        expect(result.value).toBe(bytes)
      }
    })
  })

  describe('generate-edited-thumbnail-result response', () => {
    it('returns Uint8Array for generate-edited-thumbnail-result', () => {
      const bytes = new Uint8Array([0xff, 0xd8, 0x00, 0xff, 0xd9])
      const response: DecodeResponse = {
        id: 'test-id',
        type: 'generate-edited-thumbnail-result',
        bytes
      }

      const result = parseDecodeResponse(response)

      expect(result.type).toBe('success')
      if (result.type === 'success') {
        expect(result.value).toBe(bytes)
      }
    })
  })
})
