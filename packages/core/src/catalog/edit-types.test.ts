import { describe, expect, it } from 'vitest'
import {
  EDIT_SCHEMA_VERSION,
  DEFAULT_ADJUSTMENTS,
  createDefaultEditState,
  hasModifiedAdjustments,
  isModifiedToneCurve,
  type Adjustments,
  type EditState,
} from './types'
import { DEFAULT_TONE_CURVE } from '../decode/types'

describe('EDIT_SCHEMA_VERSION', () => {
  it('is a positive integer', () => {
    expect(EDIT_SCHEMA_VERSION).toBeGreaterThan(0)
    expect(Number.isInteger(EDIT_SCHEMA_VERSION)).toBe(true)
  })

  it('is currently version 2', () => {
    expect(EDIT_SCHEMA_VERSION).toBe(2)
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

  it('creates a new copy of adjustments each time', () => {
    const state1 = createDefaultEditState()
    const state2 = createDefaultEditState()

    // Should be equal but not the same object
    expect(state1.adjustments).toEqual(state2.adjustments)
    expect(state1.adjustments).not.toBe(state2.adjustments)
  })

  it('creates adjustments that can be modified', () => {
    const state = createDefaultEditState()
    state.adjustments.exposure = 1.5

    expect(state.adjustments.exposure).toBe(1.5)
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
    }

    expect(state.version).toBe(2)
    expect(state.adjustments.exposure).toBe(0)
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
  })
})
