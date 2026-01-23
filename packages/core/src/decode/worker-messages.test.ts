/**
 * Tests for worker message type definitions and validation.
 *
 * These tests verify:
 * - Message type structure and discriminated unions
 * - EditedThumbnailEditState interface completeness
 * - MaskStackData structure
 * - Message serialization compatibility
 */

import { describe, it, expect } from 'vitest'
import type {
  DecodeRequest,
  DecodeResponse,
  DecodeJpegRequest,
  GenerateThumbnailRequest,
  GeneratePreviewRequest,
  DetectFileTypeRequest,
  ApplyAdjustmentsRequest,
  ComputeHistogramRequest,
  ApplyToneCurveRequest,
  ApplyRotationRequest,
  ApplyCropRequest,
  EncodeJpegRequest,
  ApplyMaskedAdjustmentsRequest,
  GenerateEditedThumbnailRequest,
  DecodeSuccessResponse,
  FileTypeResponse,
  HistogramResponse,
  ToneCurveResponse,
  EncodeJpegResponse,
  GenerateEditedThumbnailResponse,
  DecodeErrorResponse,
  MaskStackData,
  EditedThumbnailEditState,
} from './worker-messages'

// ============================================================================
// Request Message Tests
// ============================================================================

describe('DecodeRequest types', () => {
  describe('DecodeJpegRequest', () => {
    it('should have correct structure', () => {
      const request: DecodeJpegRequest = {
        id: 'test-id',
        type: 'decode-jpeg',
        bytes: new Uint8Array([0xff, 0xd8]),
      }

      expect(request.id).toBe('test-id')
      expect(request.type).toBe('decode-jpeg')
      expect(request.bytes).toBeInstanceOf(Uint8Array)
    })
  })

  describe('GenerateThumbnailRequest', () => {
    it('should have correct structure', () => {
      const request: GenerateThumbnailRequest = {
        id: 'test-id',
        type: 'generate-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
      }

      expect(request.id).toBe('test-id')
      expect(request.type).toBe('generate-thumbnail')
      expect(request.size).toBe(256)
    })
  })

  describe('GeneratePreviewRequest', () => {
    it('should have correct structure', () => {
      const request: GeneratePreviewRequest = {
        id: 'test-id',
        type: 'generate-preview',
        bytes: new Uint8Array([0xff, 0xd8]),
        maxEdge: 2560,
        filter: 2, // Lanczos3
      }

      expect(request.maxEdge).toBe(2560)
      expect(request.filter).toBe(2)
    })
  })

  describe('DetectFileTypeRequest', () => {
    it('should have correct structure', () => {
      const request: DetectFileTypeRequest = {
        id: 'test-id',
        type: 'detect-file-type',
        bytes: new Uint8Array([0xff, 0xd8]),
      }

      expect(request.type).toBe('detect-file-type')
    })
  })

  describe('ApplyAdjustmentsRequest', () => {
    it('should have correct structure', () => {
      const request: ApplyAdjustmentsRequest = {
        id: 'test-id',
        type: 'apply-adjustments',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
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

      expect(request.width).toBe(100)
      expect(request.height).toBe(100)
      expect(request.adjustments.exposure).toBe(1)
    })
  })

  describe('ComputeHistogramRequest', () => {
    it('should have correct structure', () => {
      const request: ComputeHistogramRequest = {
        id: 'test-id',
        type: 'compute-histogram',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
      }

      expect(request.type).toBe('compute-histogram')
    })
  })

  describe('ApplyToneCurveRequest', () => {
    it('should have correct structure', () => {
      const request: ApplyToneCurveRequest = {
        id: 'test-id',
        type: 'apply-tone-curve',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.6 },
          { x: 1, y: 1 },
        ],
      }

      expect(request.points).toHaveLength(3)
      expect(request.points[1].x).toBe(0.5)
      expect(request.points[1].y).toBe(0.6)
    })
  })

  describe('ApplyRotationRequest', () => {
    it('should have correct structure', () => {
      const request: ApplyRotationRequest = {
        id: 'test-id',
        type: 'apply-rotation',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        angleDegrees: 45,
        useLanczos: true,
      }

      expect(request.angleDegrees).toBe(45)
      expect(request.useLanczos).toBe(true)
    })
  })

  describe('ApplyCropRequest', () => {
    it('should have correct structure with normalized coordinates', () => {
      const request: ApplyCropRequest = {
        id: 'test-id',
        type: 'apply-crop',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        left: 0.1,
        top: 0.1,
        cropWidth: 0.8,
        cropHeight: 0.8,
      }

      expect(request.left).toBe(0.1)
      expect(request.top).toBe(0.1)
      expect(request.cropWidth).toBe(0.8)
      expect(request.cropHeight).toBe(0.8)
    })
  })

  describe('EncodeJpegRequest', () => {
    it('should have correct structure', () => {
      const request: EncodeJpegRequest = {
        id: 'test-id',
        type: 'encode-jpeg',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        quality: 90,
      }

      expect(request.quality).toBe(90)
    })
  })

  describe('ApplyMaskedAdjustmentsRequest', () => {
    it('should have correct structure', () => {
      const request: ApplyMaskedAdjustmentsRequest = {
        id: 'test-id',
        type: 'apply-masked-adjustments',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
        maskStack: {
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

      expect(request.maskStack.linearMasks).toHaveLength(1)
    })
  })

  describe('GenerateEditedThumbnailRequest', () => {
    it('should have correct structure', () => {
      const request: GenerateEditedThumbnailRequest = {
        id: 'test-id',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 512,
        editState: {
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
        },
      }

      expect(request.type).toBe('generate-edited-thumbnail')
      expect(request.size).toBe(512)
      expect(request.editState.adjustments?.exposure).toBe(1)
    })

    it('should accept empty edit state', () => {
      const request: GenerateEditedThumbnailRequest = {
        id: 'test-id',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 256,
        editState: {},
      }

      expect(request.editState).toEqual({})
    })

    it('should accept full edit state with all properties', () => {
      const request: GenerateEditedThumbnailRequest = {
        id: 'test-id',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array([0xff, 0xd8]),
        size: 512,
        editState: {
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
              { x: 0, y: 0 },
              { x: 1, y: 1 },
            ],
          },
          crop: {
            left: 0.1,
            top: 0.1,
            width: 0.8,
            height: 0.8,
          },
          rotation: {
            angle: 15,
            straighten: 2,
          },
          masks: {
            linearMasks: [],
            radialMasks: [],
          },
        },
      }

      expect(request.editState.adjustments?.exposure).toBe(0.5)
      expect(request.editState.toneCurve?.points).toHaveLength(2)
      expect(request.editState.crop?.left).toBe(0.1)
      expect(request.editState.rotation?.angle).toBe(15)
    })
  })
})

// ============================================================================
// Response Message Tests
// ============================================================================

describe('DecodeResponse types', () => {
  describe('DecodeSuccessResponse', () => {
    it('should have correct structure', () => {
      const response: DecodeSuccessResponse = {
        id: 'test-id',
        type: 'success',
        width: 100,
        height: 100,
        pixels: new Uint8Array(100 * 100 * 3),
      }

      expect(response.type).toBe('success')
      expect(response.width).toBe(100)
      expect(response.height).toBe(100)
    })
  })

  describe('FileTypeResponse', () => {
    it('should accept jpeg file type', () => {
      const response: FileTypeResponse = {
        id: 'test-id',
        type: 'file-type',
        fileType: 'jpeg',
      }

      expect(response.fileType).toBe('jpeg')
    })

    it('should accept raw file type', () => {
      const response: FileTypeResponse = {
        id: 'test-id',
        type: 'file-type',
        fileType: 'raw',
      }

      expect(response.fileType).toBe('raw')
    })

    it('should accept unknown file type', () => {
      const response: FileTypeResponse = {
        id: 'test-id',
        type: 'file-type',
        fileType: 'unknown',
      }

      expect(response.fileType).toBe('unknown')
    })
  })

  describe('HistogramResponse', () => {
    it('should have correct structure', () => {
      const response: HistogramResponse = {
        id: 'test-id',
        type: 'histogram',
        red: new Uint32Array(256),
        green: new Uint32Array(256),
        blue: new Uint32Array(256),
        luminance: new Uint32Array(256),
        maxValue: 1000,
        hasHighlightClipping: true,
        hasShadowClipping: false,
      }

      expect(response.red).toHaveLength(256)
      expect(response.green).toHaveLength(256)
      expect(response.blue).toHaveLength(256)
      expect(response.luminance).toHaveLength(256)
      expect(response.maxValue).toBe(1000)
    })
  })

  describe('ToneCurveResponse', () => {
    it('should have correct structure', () => {
      const response: ToneCurveResponse = {
        id: 'test-id',
        type: 'tone-curve-result',
        pixels: new Uint8Array(100 * 100 * 3),
        width: 100,
        height: 100,
      }

      expect(response.type).toBe('tone-curve-result')
    })
  })

  describe('EncodeJpegResponse', () => {
    it('should have correct structure', () => {
      const response: EncodeJpegResponse = {
        id: 'test-id',
        type: 'encode-jpeg-result',
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      }

      expect(response.type).toBe('encode-jpeg-result')
      expect(response.bytes).toBeInstanceOf(Uint8Array)
    })
  })

  describe('GenerateEditedThumbnailResponse', () => {
    it('should have correct structure', () => {
      const response: GenerateEditedThumbnailResponse = {
        id: 'test-id',
        type: 'generate-edited-thumbnail-result',
        bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
      }

      expect(response.type).toBe('generate-edited-thumbnail-result')
      expect(response.bytes).toBeInstanceOf(Uint8Array)
    })
  })

  describe('DecodeErrorResponse', () => {
    it('should have correct structure', () => {
      const response: DecodeErrorResponse = {
        id: 'test-id',
        type: 'error',
        message: 'Decode failed',
        code: 'DECODE_FAILED',
      }

      expect(response.type).toBe('error')
      expect(response.message).toBe('Decode failed')
      expect(response.code).toBe('DECODE_FAILED')
    })
  })
})

// ============================================================================
// MaskStackData Tests
// ============================================================================

describe('MaskStackData', () => {
  it('should accept empty mask arrays', () => {
    const maskStack: MaskStackData = {
      linearMasks: [],
      radialMasks: [],
    }

    expect(maskStack.linearMasks).toHaveLength(0)
    expect(maskStack.radialMasks).toHaveLength(0)
  })

  it('should accept linear gradient mask', () => {
    const maskStack: MaskStackData = {
      linearMasks: [
        {
          startX: 0,
          startY: 0,
          endX: 1,
          endY: 1,
          feather: 0.5,
          enabled: true,
          adjustments: {
            exposure: 1,
            contrast: 10,
          },
        },
      ],
      radialMasks: [],
    }

    expect(maskStack.linearMasks[0].startX).toBe(0)
    expect(maskStack.linearMasks[0].endX).toBe(1)
    expect(maskStack.linearMasks[0].feather).toBe(0.5)
    expect(maskStack.linearMasks[0].enabled).toBe(true)
    expect(maskStack.linearMasks[0].adjustments.exposure).toBe(1)
  })

  it('should accept radial gradient mask', () => {
    const maskStack: MaskStackData = {
      linearMasks: [],
      radialMasks: [
        {
          centerX: 0.5,
          centerY: 0.5,
          radiusX: 0.3,
          radiusY: 0.3,
          rotation: 45,
          feather: 0.5,
          invert: true,
          enabled: true,
          adjustments: {
            saturation: 20,
          },
        },
      ],
    }

    expect(maskStack.radialMasks[0].centerX).toBe(0.5)
    expect(maskStack.radialMasks[0].radiusX).toBe(0.3)
    expect(maskStack.radialMasks[0].rotation).toBe(45)
    expect(maskStack.radialMasks[0].invert).toBe(true)
    expect(maskStack.radialMasks[0].adjustments.saturation).toBe(20)
  })

  it('should accept multiple masks of each type', () => {
    const maskStack: MaskStackData = {
      linearMasks: [
        {
          startX: 0,
          startY: 0,
          endX: 0.5,
          endY: 0.5,
          feather: 0.3,
          enabled: true,
          adjustments: { exposure: 0.5 },
        },
        {
          startX: 0.5,
          startY: 0.5,
          endX: 1,
          endY: 1,
          feather: 0.3,
          enabled: true,
          adjustments: { exposure: -0.5 },
        },
      ],
      radialMasks: [
        {
          centerX: 0.3,
          centerY: 0.3,
          radiusX: 0.2,
          radiusY: 0.2,
          rotation: 0,
          feather: 0.5,
          invert: false,
          enabled: true,
          adjustments: { contrast: 10 },
        },
        {
          centerX: 0.7,
          centerY: 0.7,
          radiusX: 0.2,
          radiusY: 0.2,
          rotation: 0,
          feather: 0.5,
          invert: false,
          enabled: false, // Disabled
          adjustments: { contrast: -10 },
        },
      ],
    }

    expect(maskStack.linearMasks).toHaveLength(2)
    expect(maskStack.radialMasks).toHaveLength(2)
    expect(maskStack.radialMasks[1].enabled).toBe(false)
  })
})

// ============================================================================
// EditedThumbnailEditState Tests
// ============================================================================

describe('EditedThumbnailEditState', () => {
  it('should accept empty state', () => {
    const state: EditedThumbnailEditState = {}

    expect(Object.keys(state)).toHaveLength(0)
  })

  it('should accept adjustments only', () => {
    const state: EditedThumbnailEditState = {
      adjustments: {
        exposure: 1,
        contrast: 0,
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

    expect(state.adjustments?.exposure).toBe(1)
  })

  it('should accept tone curve only', () => {
    const state: EditedThumbnailEditState = {
      toneCurve: {
        points: [
          { x: 0, y: 0 },
          { x: 0.25, y: 0.2 },
          { x: 0.75, y: 0.85 },
          { x: 1, y: 1 },
        ],
      },
    }

    expect(state.toneCurve?.points).toHaveLength(4)
  })

  it('should accept crop rectangle', () => {
    const state: EditedThumbnailEditState = {
      crop: {
        left: 0.1,
        top: 0.2,
        width: 0.6,
        height: 0.5,
      },
    }

    expect(state.crop?.left).toBe(0.1)
    expect(state.crop?.width).toBe(0.6)
  })

  it('should accept null crop', () => {
    const state: EditedThumbnailEditState = {
      crop: null,
    }

    expect(state.crop).toBeNull()
  })

  it('should accept rotation parameters', () => {
    const state: EditedThumbnailEditState = {
      rotation: {
        angle: 90,
        straighten: 5,
      },
    }

    expect(state.rotation?.angle).toBe(90)
    expect(state.rotation?.straighten).toBe(5)
  })

  it('should accept masks', () => {
    const state: EditedThumbnailEditState = {
      masks: {
        linearMasks: [
          {
            startX: 0,
            startY: 0,
            endX: 1,
            endY: 0.5,
            feather: 0.5,
            enabled: true,
            adjustments: { exposure: 0.5 },
          },
        ],
        radialMasks: [],
      },
    }

    expect(state.masks?.linearMasks).toHaveLength(1)
  })

  it('should accept all properties combined', () => {
    const state: EditedThumbnailEditState = {
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
          { x: 1, y: 0.95 },
        ],
      },
      crop: {
        left: 0.05,
        top: 0.05,
        width: 0.9,
        height: 0.9,
      },
      rotation: {
        angle: 5,
        straighten: 2,
      },
      masks: {
        linearMasks: [
          {
            startX: 0,
            startY: 0.8,
            endX: 1,
            endY: 1,
            feather: 0.3,
            enabled: true,
            adjustments: { exposure: -1 },
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

    expect(state.adjustments?.exposure).toBe(0.5)
    expect(state.toneCurve?.points).toHaveLength(2)
    expect(state.crop?.width).toBe(0.9)
    expect(state.rotation?.angle).toBe(5)
    expect(state.masks?.linearMasks).toHaveLength(1)
    expect(state.masks?.radialMasks).toHaveLength(1)
  })
})

// ============================================================================
// Discriminated Union Tests
// ============================================================================

describe('Discriminated union type checking', () => {
  it('DecodeRequest union should discriminate by type', () => {
    const requests: DecodeRequest[] = [
      { id: '1', type: 'decode-jpeg', bytes: new Uint8Array() },
      { id: '2', type: 'generate-thumbnail', bytes: new Uint8Array(), size: 256 },
      {
        id: '3',
        type: 'generate-edited-thumbnail',
        bytes: new Uint8Array(),
        size: 512,
        editState: {},
      },
    ]

    // Test discriminated union behavior
    for (const request of requests) {
      switch (request.type) {
        case 'decode-jpeg':
          expect(request.bytes).toBeInstanceOf(Uint8Array)
          break
        case 'generate-thumbnail':
          expect(request.size).toBe(256)
          break
        case 'generate-edited-thumbnail':
          expect(request.size).toBe(512)
          expect(request.editState).toEqual({})
          break
        default:
          // Other types
          break
      }
    }
  })

  it('DecodeResponse union should discriminate by type', () => {
    const responses: DecodeResponse[] = [
      { id: '1', type: 'success', width: 100, height: 100, pixels: new Uint8Array() },
      { id: '2', type: 'file-type', fileType: 'jpeg' },
      { id: '3', type: 'error', message: 'Failed', code: 'DECODE_FAILED' },
      {
        id: '4',
        type: 'generate-edited-thumbnail-result',
        bytes: new Uint8Array([0xff, 0xd8]),
      },
    ]

    for (const response of responses) {
      switch (response.type) {
        case 'success':
          expect(response.width).toBe(100)
          break
        case 'file-type':
          expect(response.fileType).toBe('jpeg')
          break
        case 'error':
          expect(response.message).toBe('Failed')
          break
        case 'generate-edited-thumbnail-result':
          expect(response.bytes).toBeInstanceOf(Uint8Array)
          break
        default:
          break
      }
    }
  })
})

// ============================================================================
// Serialization Tests
// ============================================================================

describe('Message serialization', () => {
  it('should survive JSON round-trip for EditedThumbnailEditState', () => {
    const state: EditedThumbnailEditState = {
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
      toneCurve: {
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      },
      crop: {
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      },
      rotation: {
        angle: 45,
        straighten: 0,
      },
    }

    const serialized = JSON.stringify(state)
    const deserialized = JSON.parse(serialized) as EditedThumbnailEditState

    expect(deserialized.adjustments?.exposure).toBe(1)
    expect(deserialized.toneCurve?.points).toHaveLength(2)
    expect(deserialized.crop?.left).toBe(0.1)
    expect(deserialized.rotation?.angle).toBe(45)
  })

  it('should serialize MaskStackData correctly', () => {
    const masks: MaskStackData = {
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
    }

    const serialized = JSON.stringify(masks)
    const deserialized = JSON.parse(serialized) as MaskStackData

    expect(deserialized.linearMasks[0].feather).toBe(0.5)
    expect(deserialized.radialMasks[0].adjustments.contrast).toBe(15)
  })
})
