import { describe, expect, it } from 'vitest'
import {
  EDIT_SCHEMA_VERSION,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP_TRANSFORM,
  createDefaultEditState,
  hasModifiedAdjustments,
  isModifiedToneCurve,
  isModifiedCropTransform,
  getTotalRotation,
  validateCropRectangle,
  cloneCropTransform,
  type Adjustments,
  type EditState,
  type CropRectangle,
  type CropTransform,
} from './types'
import { DEFAULT_TONE_CURVE } from '../decode/types'

describe('EDIT_SCHEMA_VERSION', () => {
  it('is a positive integer', () => {
    expect(EDIT_SCHEMA_VERSION).toBeGreaterThan(0)
    expect(Number.isInteger(EDIT_SCHEMA_VERSION)).toBe(true)
  })

  it('is currently version 3', () => {
    expect(EDIT_SCHEMA_VERSION).toBe(3)
  })
})

describe('DEFAULT_ADJUSTMENTS', () => {
  it('has all required adjustment keys', () => {
    const requiredKeys: (keyof Adjustments)[] = [
      'temperature',
      'tint',
      'exposure',
      'contrast',
      'highlights',
      'shadows',
      'whites',
      'blacks',
      'vibrance',
      'saturation',
      'toneCurve',
    ]

    for (const key of requiredKeys) {
      expect(DEFAULT_ADJUSTMENTS).toHaveProperty(key)
    }
  })

  it('has all numeric values set to zero', () => {
    const numericKeys: (keyof Adjustments)[] = [
      'temperature',
      'tint',
      'exposure',
      'contrast',
      'highlights',
      'shadows',
      'whites',
      'blacks',
      'vibrance',
      'saturation',
    ]

    for (const key of numericKeys) {
      expect(DEFAULT_ADJUSTMENTS[key]).toBe(0)
    }
  })

  it('has default tone curve as linear', () => {
    expect(DEFAULT_ADJUSTMENTS.toneCurve.points).toHaveLength(2)
    expect(DEFAULT_ADJUSTMENTS.toneCurve.points[0]).toEqual({ x: 0, y: 0 })
    expect(DEFAULT_ADJUSTMENTS.toneCurve.points[1]).toEqual({ x: 1, y: 1 })
  })

  it('is frozen and cannot be modified', () => {
    expect(Object.isFrozen(DEFAULT_ADJUSTMENTS)).toBe(true)
  })

  it('has exactly 11 adjustment properties', () => {
    expect(Object.keys(DEFAULT_ADJUSTMENTS)).toHaveLength(11)
  })
})

describe('createDefaultEditState', () => {
  it('creates edit state with current schema version', () => {
    const state = createDefaultEditState()

    expect(state.version).toBe(EDIT_SCHEMA_VERSION)
  })

  it('creates edit state with default adjustments', () => {
    const state = createDefaultEditState()

    expect(state.adjustments).toEqual(DEFAULT_ADJUSTMENTS)
  })

  it('creates edit state with default crop transform', () => {
    const state = createDefaultEditState()

    expect(state.cropTransform.crop).toBeNull()
    expect(state.cropTransform.rotation.angle).toBe(0)
    expect(state.cropTransform.rotation.straighten).toBe(0)
  })

  it('creates a new copy of adjustments each time', () => {
    const state1 = createDefaultEditState()
    const state2 = createDefaultEditState()

    // Should be equal but not the same object
    expect(state1.adjustments).toEqual(state2.adjustments)
    expect(state1.adjustments).not.toBe(state2.adjustments)
  })

  it('creates a new copy of cropTransform each time', () => {
    const state1 = createDefaultEditState()
    const state2 = createDefaultEditState()

    expect(state1.cropTransform).toEqual(state2.cropTransform)
    expect(state1.cropTransform).not.toBe(state2.cropTransform)
  })

  it('creates adjustments that can be modified', () => {
    const state = createDefaultEditState()
    state.adjustments.exposure = 1.5

    expect(state.adjustments.exposure).toBe(1.5)
  })

  it('creates cropTransform that can be modified', () => {
    const state = createDefaultEditState()
    state.cropTransform.rotation.angle = 45

    expect(state.cropTransform.rotation.angle).toBe(45)
  })
})

describe('hasModifiedAdjustments', () => {
  it('returns false for default adjustments', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS }

    expect(hasModifiedAdjustments(adjustments)).toBe(false)
  })

  it('returns true when temperature is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, temperature: 10 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when tint is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, tint: -20 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when exposure is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, exposure: 0.5 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when contrast is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, contrast: 25 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when highlights is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, highlights: -50 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when shadows is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, shadows: 30 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when whites is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, whites: -10 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when blacks is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, blacks: 5 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when vibrance is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, vibrance: 40 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when saturation is modified', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, saturation: -15 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when multiple adjustments are modified', () => {
    const adjustments: Adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      exposure: 0.75,
      contrast: 20,
      highlights: -30,
    }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('handles negative values correctly', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, exposure: -2.5 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('handles small decimal values correctly', () => {
    const adjustments: Adjustments = { ...DEFAULT_ADJUSTMENTS, exposure: 0.01 }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when tone curve has extra points', () => {
    const adjustments: Adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      toneCurve: {
        points: [
          { x: 0, y: 0 },
          { x: 0.5, y: 0.6 },
          { x: 1, y: 1 },
        ],
      },
    }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns true when tone curve point is moved', () => {
    const adjustments: Adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      toneCurve: {
        points: [
          { x: 0, y: 0.1 }, // Y moved
          { x: 1, y: 1 },
        ],
      },
    }

    expect(hasModifiedAdjustments(adjustments)).toBe(true)
  })

  it('returns false when tone curve is default', () => {
    const adjustments: Adjustments = {
      ...DEFAULT_ADJUSTMENTS,
      toneCurve: { ...DEFAULT_TONE_CURVE },
    }

    expect(hasModifiedAdjustments(adjustments)).toBe(false)
  })
})

describe('isModifiedToneCurve', () => {
  it('returns false for default linear curve', () => {
    expect(isModifiedToneCurve(DEFAULT_TONE_CURVE)).toBe(false)
  })

  it('returns false for curve with identical points', () => {
    const curve = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    }
    expect(isModifiedToneCurve(curve)).toBe(false)
  })

  it('returns true when curve has extra points', () => {
    const curve = {
      points: [
        { x: 0, y: 0 },
        { x: 0.5, y: 0.6 },
        { x: 1, y: 1 },
      ],
    }
    expect(isModifiedToneCurve(curve)).toBe(true)
  })

  it('returns true when start point y is moved', () => {
    const curve = {
      points: [
        { x: 0, y: 0.1 },
        { x: 1, y: 1 },
      ],
    }
    expect(isModifiedToneCurve(curve)).toBe(true)
  })

  it('returns true when end point y is moved', () => {
    const curve = {
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 0.9 },
      ],
    }
    expect(isModifiedToneCurve(curve)).toBe(true)
  })

  it('returns false for very small differences (within tolerance)', () => {
    const curve = {
      points: [
        { x: 0.0001, y: 0.0001 },
        { x: 0.9999, y: 0.9999 },
      ],
    }
    expect(isModifiedToneCurve(curve)).toBe(false)
  })

  it('returns true for single point curves (invalid but handled)', () => {
    const curve = {
      points: [{ x: 0.5, y: 0.5 }],
    }
    expect(isModifiedToneCurve(curve)).toBe(true)
  })
})

describe('EditState interface', () => {
  it('can be created with valid values', () => {
    const state: EditState = {
      version: EDIT_SCHEMA_VERSION,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      cropTransform: cloneCropTransform(DEFAULT_CROP_TRANSFORM),
    }

    expect(state.version).toBe(3)
    expect(state.adjustments.exposure).toBe(0)
    expect(state.cropTransform.crop).toBeNull()
    expect(state.cropTransform.rotation.angle).toBe(0)
  })

  it('supports modified adjustment values', () => {
    const state: EditState = {
      version: EDIT_SCHEMA_VERSION,
      adjustments: {
        temperature: 15,
        tint: -10,
        exposure: 1.2,
        contrast: 30,
        highlights: -40,
        shadows: 25,
        whites: -5,
        blacks: 10,
        vibrance: 35,
        saturation: -20,
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 },
            { x: 1, y: 1 },
          ],
        },
      },
      cropTransform: {
        crop: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
        rotation: { angle: 45, straighten: 2 },
      },
    }

    expect(state.adjustments.temperature).toBe(15)
    expect(state.adjustments.tint).toBe(-10)
    expect(state.adjustments.exposure).toBe(1.2)
    expect(state.adjustments.contrast).toBe(30)
    expect(state.adjustments.highlights).toBe(-40)
    expect(state.adjustments.shadows).toBe(25)
    expect(state.adjustments.whites).toBe(-5)
    expect(state.adjustments.blacks).toBe(10)
    expect(state.adjustments.vibrance).toBe(35)
    expect(state.adjustments.saturation).toBe(-20)
    expect(state.adjustments.toneCurve.points).toHaveLength(3)
    expect(state.cropTransform.crop?.width).toBe(0.8)
    expect(state.cropTransform.rotation.angle).toBe(45)
  })
})

describe('DEFAULT_CROP_TRANSFORM', () => {
  it('has no crop', () => {
    expect(DEFAULT_CROP_TRANSFORM.crop).toBeNull()
  })

  it('has zero rotation', () => {
    expect(DEFAULT_CROP_TRANSFORM.rotation.angle).toBe(0)
    expect(DEFAULT_CROP_TRANSFORM.rotation.straighten).toBe(0)
  })

  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_CROP_TRANSFORM)).toBe(true)
  })
})

describe('isModifiedCropTransform', () => {
  it('returns false for default transform', () => {
    expect(isModifiedCropTransform(DEFAULT_CROP_TRANSFORM)).toBe(false)
  })

  it('returns true when crop is set', () => {
    const transform: CropTransform = {
      crop: { left: 0.1, top: 0.1, width: 0.8, height: 0.8 },
      rotation: { angle: 0, straighten: 0 },
    }
    expect(isModifiedCropTransform(transform)).toBe(true)
  })

  it('returns true when rotation angle is set', () => {
    const transform: CropTransform = {
      crop: null,
      rotation: { angle: 45, straighten: 0 },
    }
    expect(isModifiedCropTransform(transform)).toBe(true)
  })

  it('returns true when straighten is set', () => {
    const transform: CropTransform = {
      crop: null,
      rotation: { angle: 0, straighten: 5 },
    }
    expect(isModifiedCropTransform(transform)).toBe(true)
  })
})

describe('getTotalRotation', () => {
  it('returns sum of angle and straighten', () => {
    expect(getTotalRotation({ angle: 45, straighten: 5 })).toBe(50)
    expect(getTotalRotation({ angle: -10, straighten: 3 })).toBe(-7)
    expect(getTotalRotation({ angle: 0, straighten: 0 })).toBe(0)
  })
})

describe('validateCropRectangle', () => {
  it('returns true for valid crop', () => {
    const crop: CropRectangle = { left: 0.1, top: 0.2, width: 0.5, height: 0.6 }
    expect(validateCropRectangle(crop)).toBe(true)
  })

  it('returns true for full image crop', () => {
    const crop: CropRectangle = { left: 0, top: 0, width: 1, height: 1 }
    expect(validateCropRectangle(crop)).toBe(true)
  })

  it('returns false for negative left', () => {
    const crop: CropRectangle = { left: -0.1, top: 0, width: 0.5, height: 0.5 }
    expect(validateCropRectangle(crop)).toBe(false)
  })

  it('returns false for left > 1', () => {
    const crop: CropRectangle = { left: 1.1, top: 0, width: 0.5, height: 0.5 }
    expect(validateCropRectangle(crop)).toBe(false)
  })

  it('returns false for zero width', () => {
    const crop: CropRectangle = { left: 0, top: 0, width: 0, height: 0.5 }
    expect(validateCropRectangle(crop)).toBe(false)
  })

  it('returns false when crop exceeds right edge', () => {
    const crop: CropRectangle = { left: 0.6, top: 0, width: 0.5, height: 0.5 }
    expect(validateCropRectangle(crop)).toBe(false)
  })

  it('returns false when crop exceeds bottom edge', () => {
    const crop: CropRectangle = { left: 0, top: 0.6, width: 0.5, height: 0.5 }
    expect(validateCropRectangle(crop)).toBe(false)
  })
})

describe('cloneCropTransform', () => {
  it('creates a deep copy', () => {
    const original: CropTransform = {
      crop: { left: 0.1, top: 0.2, width: 0.5, height: 0.6 },
      rotation: { angle: 45, straighten: 5 },
    }
    const cloned = cloneCropTransform(original)

    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned.crop).not.toBe(original.crop)
    expect(cloned.rotation).not.toBe(original.rotation)
  })

  it('handles null crop', () => {
    const original: CropTransform = {
      crop: null,
      rotation: { angle: 0, straighten: 0 },
    }
    const cloned = cloneCropTransform(original)

    expect(cloned.crop).toBeNull()
  })
})
