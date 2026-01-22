import { describe, expect, it } from 'vitest'
import {
  EDIT_SCHEMA_VERSION,
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP_TRANSFORM,
  DEFAULT_MASK_STACK,
  createDefaultEditState,
  createDefaultMaskStack,
  createLinearMask,
  createRadialMask,
  hasModifiedAdjustments,
  isModifiedToneCurve,
  isModifiedCropTransform,
  isModifiedMaskStack,
  getTotalRotation,
  validateCropRectangle,
  cloneCropTransform,
  cloneMaskStack,
  cloneLinearMask,
  cloneRadialMask,
  migrateEditState,
  type Adjustments,
  type EditState,
  type CropRectangle,
  type CropTransform,
  type MaskStack,
  type LinearGradientMask,
  type RadialGradientMask,
} from './types'
import { DEFAULT_TONE_CURVE } from '../decode/types'

describe('EDIT_SCHEMA_VERSION', () => {
  it('is a positive integer', () => {
    expect(EDIT_SCHEMA_VERSION).toBeGreaterThan(0)
    expect(Number.isInteger(EDIT_SCHEMA_VERSION)).toBe(true)
  })

  it('is currently version 4', () => {
    expect(EDIT_SCHEMA_VERSION).toBe(4)
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

    expect(state.version).toBe(4)
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

// ============================================================================
// Mask Types Tests
// ============================================================================

describe('DEFAULT_MASK_STACK', () => {
  it('has empty linear masks array', () => {
    expect(DEFAULT_MASK_STACK.linearMasks).toEqual([])
  })

  it('has empty radial masks array', () => {
    expect(DEFAULT_MASK_STACK.radialMasks).toEqual([])
  })

  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_MASK_STACK)).toBe(true)
  })
})

describe('createDefaultMaskStack', () => {
  it('creates empty mask stack', () => {
    const stack = createDefaultMaskStack()

    expect(stack.linearMasks).toEqual([])
    expect(stack.radialMasks).toEqual([])
  })

  it('creates new copy each time', () => {
    const stack1 = createDefaultMaskStack()
    const stack2 = createDefaultMaskStack()

    expect(stack1).not.toBe(stack2)
    expect(stack1.linearMasks).not.toBe(stack2.linearMasks)
    expect(stack1.radialMasks).not.toBe(stack2.radialMasks)
  })
})

describe('createLinearMask', () => {
  it('creates mask with default positions', () => {
    const mask = createLinearMask()

    expect(mask.start).toEqual({ x: 0.3, y: 0.5 })
    expect(mask.end).toEqual({ x: 0.7, y: 0.5 })
  })

  it('creates mask with custom positions', () => {
    const mask = createLinearMask({ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.8 })

    expect(mask.start).toEqual({ x: 0.1, y: 0.2 })
    expect(mask.end).toEqual({ x: 0.9, y: 0.8 })
  })

  it('has UUID id', () => {
    const mask = createLinearMask()

    expect(mask.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('creates unique ids each time', () => {
    const mask1 = createLinearMask()
    const mask2 = createLinearMask()

    expect(mask1.id).not.toBe(mask2.id)
  })

  it('has default feather of 0.5', () => {
    const mask = createLinearMask()

    expect(mask.feather).toBe(0.5)
  })

  it('is enabled by default', () => {
    const mask = createLinearMask()

    expect(mask.enabled).toBe(true)
  })

  it('has empty adjustments by default', () => {
    const mask = createLinearMask()

    expect(mask.adjustments).toEqual({})
  })

  it('creates independent copies of positions', () => {
    const start = { x: 0.1, y: 0.2 }
    const mask = createLinearMask(start)

    start.x = 0.9
    expect(mask.start.x).toBe(0.1)
  })
})

describe('createRadialMask', () => {
  it('creates mask with default center', () => {
    const mask = createRadialMask()

    expect(mask.center).toEqual({ x: 0.5, y: 0.5 })
  })

  it('creates mask with default radii', () => {
    const mask = createRadialMask()

    expect(mask.radiusX).toBe(0.3)
    expect(mask.radiusY).toBe(0.3)
  })

  it('creates mask with custom values', () => {
    const mask = createRadialMask({ x: 0.2, y: 0.3 }, 0.4, 0.5)

    expect(mask.center).toEqual({ x: 0.2, y: 0.3 })
    expect(mask.radiusX).toBe(0.4)
    expect(mask.radiusY).toBe(0.5)
  })

  it('has UUID id', () => {
    const mask = createRadialMask()

    expect(mask.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('has default rotation of 0', () => {
    const mask = createRadialMask()

    expect(mask.rotation).toBe(0)
  })

  it('has default feather of 0.3', () => {
    const mask = createRadialMask()

    expect(mask.feather).toBe(0.3)
  })

  it('is not inverted by default', () => {
    const mask = createRadialMask()

    expect(mask.invert).toBe(false)
  })

  it('is enabled by default', () => {
    const mask = createRadialMask()

    expect(mask.enabled).toBe(true)
  })

  it('has empty adjustments by default', () => {
    const mask = createRadialMask()

    expect(mask.adjustments).toEqual({})
  })
})

describe('isModifiedMaskStack', () => {
  it('returns false for undefined masks', () => {
    expect(isModifiedMaskStack(undefined)).toBe(false)
  })

  it('returns false for empty mask stack', () => {
    const stack: MaskStack = { linearMasks: [], radialMasks: [] }

    expect(isModifiedMaskStack(stack)).toBe(false)
  })

  it('returns true when linear masks exist', () => {
    const stack: MaskStack = {
      linearMasks: [createLinearMask()],
      radialMasks: [],
    }

    expect(isModifiedMaskStack(stack)).toBe(true)
  })

  it('returns true when radial masks exist', () => {
    const stack: MaskStack = {
      linearMasks: [],
      radialMasks: [createRadialMask()],
    }

    expect(isModifiedMaskStack(stack)).toBe(true)
  })

  it('returns true when both mask types exist', () => {
    const stack: MaskStack = {
      linearMasks: [createLinearMask()],
      radialMasks: [createRadialMask()],
    }

    expect(isModifiedMaskStack(stack)).toBe(true)
  })
})

describe('cloneMaskStack', () => {
  it('creates deep copy of empty stack', () => {
    const original: MaskStack = { linearMasks: [], radialMasks: [] }
    const cloned = cloneMaskStack(original)

    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
  })

  it('creates deep copy of linear masks', () => {
    const linearMask = createLinearMask()
    linearMask.adjustments = { exposure: 1.5 }
    const original: MaskStack = {
      linearMasks: [linearMask],
      radialMasks: [],
    }
    const cloned = cloneMaskStack(original)

    expect(cloned.linearMasks[0]).toEqual(original.linearMasks[0])
    expect(cloned.linearMasks[0]).not.toBe(original.linearMasks[0])
    expect(cloned.linearMasks[0].start).not.toBe(original.linearMasks[0].start)
    expect(cloned.linearMasks[0].adjustments).not.toBe(original.linearMasks[0].adjustments)
  })

  it('creates deep copy of radial masks', () => {
    const radialMask = createRadialMask()
    radialMask.adjustments = { contrast: 25 }
    const original: MaskStack = {
      linearMasks: [],
      radialMasks: [radialMask],
    }
    const cloned = cloneMaskStack(original)

    expect(cloned.radialMasks[0]).toEqual(original.radialMasks[0])
    expect(cloned.radialMasks[0]).not.toBe(original.radialMasks[0])
    expect(cloned.radialMasks[0].center).not.toBe(original.radialMasks[0].center)
    expect(cloned.radialMasks[0].adjustments).not.toBe(original.radialMasks[0].adjustments)
  })

  it('modifications to clone do not affect original', () => {
    const original: MaskStack = {
      linearMasks: [createLinearMask()],
      radialMasks: [createRadialMask()],
    }
    const cloned = cloneMaskStack(original)

    cloned.linearMasks[0].start.x = 0.99
    cloned.radialMasks[0].radiusX = 0.99

    expect(original.linearMasks[0].start.x).toBe(0.3)
    expect(original.radialMasks[0].radiusX).toBe(0.3)
  })
})

describe('cloneLinearMask', () => {
  it('creates deep copy', () => {
    const original = createLinearMask()
    original.adjustments = { exposure: 1.5, contrast: 20 }
    const cloned = cloneLinearMask(original)

    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned.start).not.toBe(original.start)
    expect(cloned.end).not.toBe(original.end)
    expect(cloned.adjustments).not.toBe(original.adjustments)
  })

  it('preserves all properties', () => {
    const original: LinearGradientMask = {
      id: 'test-id',
      start: { x: 0.1, y: 0.2 },
      end: { x: 0.8, y: 0.9 },
      feather: 0.7,
      enabled: false,
      adjustments: { exposure: 2.0 },
    }
    const cloned = cloneLinearMask(original)

    expect(cloned.id).toBe('test-id')
    expect(cloned.feather).toBe(0.7)
    expect(cloned.enabled).toBe(false)
    expect(cloned.adjustments.exposure).toBe(2.0)
  })
})

describe('cloneRadialMask', () => {
  it('creates deep copy', () => {
    const original = createRadialMask()
    original.adjustments = { saturation: -30 }
    const cloned = cloneRadialMask(original)

    expect(cloned).toEqual(original)
    expect(cloned).not.toBe(original)
    expect(cloned.center).not.toBe(original.center)
    expect(cloned.adjustments).not.toBe(original.adjustments)
  })

  it('preserves all properties', () => {
    const original: RadialGradientMask = {
      id: 'radial-test-id',
      center: { x: 0.3, y: 0.4 },
      radiusX: 0.5,
      radiusY: 0.6,
      rotation: 45,
      feather: 0.8,
      invert: true,
      enabled: false,
      adjustments: { highlights: -50 },
    }
    const cloned = cloneRadialMask(original)

    expect(cloned.id).toBe('radial-test-id')
    expect(cloned.radiusX).toBe(0.5)
    expect(cloned.radiusY).toBe(0.6)
    expect(cloned.rotation).toBe(45)
    expect(cloned.feather).toBe(0.8)
    expect(cloned.invert).toBe(true)
    expect(cloned.enabled).toBe(false)
    expect(cloned.adjustments.highlights).toBe(-50)
  })
})

describe('migrateEditState', () => {
  it('returns default state for null input', () => {
    const migrated = migrateEditState(null)

    expect(migrated.version).toBe(EDIT_SCHEMA_VERSION)
    expect(migrated.adjustments).toEqual(DEFAULT_ADJUSTMENTS)
    expect(migrated.cropTransform.crop).toBeNull()
    expect(migrated.masks).toBeUndefined()
  })

  it('returns default state for undefined input', () => {
    const migrated = migrateEditState(undefined)

    expect(migrated.version).toBe(EDIT_SCHEMA_VERSION)
  })

  it('returns default state for non-object input', () => {
    expect(migrateEditState('string' as unknown).version).toBe(EDIT_SCHEMA_VERSION)
    expect(migrateEditState(123 as unknown).version).toBe(EDIT_SCHEMA_VERSION)
  })

  it('returns unchanged state if already current version', () => {
    const state: EditState = createDefaultEditState()
    state.adjustments.exposure = 1.5

    const migrated = migrateEditState(state)

    expect(migrated).toBe(state)
    expect(migrated.adjustments.exposure).toBe(1.5)
  })

  it('migrates v1 state to current version', () => {
    const v1State = {
      version: 1,
      adjustments: {
        exposure: 0.5,
        contrast: 20,
        temperature: 0,
        tint: 0,
        highlights: 0,
        shadows: 0,
        whites: 0,
        blacks: 0,
        vibrance: 0,
        saturation: 0,
      },
    }

    const migrated = migrateEditState(v1State)

    expect(migrated.version).toBe(EDIT_SCHEMA_VERSION)
    expect(migrated.adjustments.exposure).toBe(0.5)
    expect(migrated.adjustments.contrast).toBe(20)
    expect(migrated.cropTransform).toBeDefined()
    expect(migrated.masks).toBeUndefined()
  })

  it('migrates v3 state to current version', () => {
    const v3State = {
      version: 3,
      adjustments: {
        exposure: 1.0,
        contrast: 10,
        temperature: 15,
        tint: -5,
        highlights: 20,
        shadows: 30,
        whites: 0,
        blacks: 0,
        vibrance: 25,
        saturation: -10,
        toneCurve: { points: [{ x: 0, y: 0.1 }, { x: 1, y: 0.9 }] },
      },
      cropTransform: {
        crop: { left: 0.1, top: 0.2, width: 0.5, height: 0.6 },
        rotation: { angle: 45, straighten: 2 },
      },
    }

    const migrated = migrateEditState(v3State)

    expect(migrated.version).toBe(EDIT_SCHEMA_VERSION)
    expect(migrated.adjustments.exposure).toBe(1.0)
    expect(migrated.adjustments.toneCurve.points).toHaveLength(2)
    expect(migrated.cropTransform.crop?.left).toBe(0.1)
    expect(migrated.cropTransform.rotation.angle).toBe(45)
    expect(migrated.masks).toBeUndefined()
  })

  it('preserves existing adjustments during migration', () => {
    const oldState = {
      version: 2,
      adjustments: {
        temperature: 50,
        tint: -25,
        exposure: 2.5,
        contrast: 100,
        highlights: -100,
        shadows: 100,
        whites: 50,
        blacks: -50,
        vibrance: 75,
        saturation: -75,
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 0.25, y: 0.35 },
            { x: 0.75, y: 0.65 },
            { x: 1, y: 1 },
          ],
        },
      },
    }

    const migrated = migrateEditState(oldState)

    expect(migrated.adjustments.temperature).toBe(50)
    expect(migrated.adjustments.tint).toBe(-25)
    expect(migrated.adjustments.exposure).toBe(2.5)
    expect(migrated.adjustments.contrast).toBe(100)
    expect(migrated.adjustments.highlights).toBe(-100)
    expect(migrated.adjustments.shadows).toBe(100)
    expect(migrated.adjustments.whites).toBe(50)
    expect(migrated.adjustments.blacks).toBe(-50)
    expect(migrated.adjustments.vibrance).toBe(75)
    expect(migrated.adjustments.saturation).toBe(-75)
    expect(migrated.adjustments.toneCurve.points).toHaveLength(4)
  })

  it('handles missing adjustment fields gracefully', () => {
    const partialState = {
      version: 1,
      adjustments: {
        exposure: 1.0,
        // Other fields missing
      },
    }

    const migrated = migrateEditState(partialState)

    expect(migrated.adjustments.exposure).toBe(1.0)
    expect(migrated.adjustments.contrast).toBe(0)
    expect(migrated.adjustments.temperature).toBe(0)
  })
})

describe('EditState with masks', () => {
  it('supports masks field', () => {
    const state: EditState = {
      version: EDIT_SCHEMA_VERSION,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      cropTransform: cloneCropTransform(DEFAULT_CROP_TRANSFORM),
      masks: {
        linearMasks: [createLinearMask()],
        radialMasks: [createRadialMask()],
      },
    }

    expect(state.masks).toBeDefined()
    expect(state.masks?.linearMasks).toHaveLength(1)
    expect(state.masks?.radialMasks).toHaveLength(1)
  })

  it('masks field is optional', () => {
    const state: EditState = {
      version: EDIT_SCHEMA_VERSION,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      cropTransform: cloneCropTransform(DEFAULT_CROP_TRANSFORM),
    }

    expect(state.masks).toBeUndefined()
  })

  it('createDefaultEditState does not include masks', () => {
    const state = createDefaultEditState()

    expect(state.masks).toBeUndefined()
  })
})
