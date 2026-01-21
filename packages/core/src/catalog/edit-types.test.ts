import { describe, expect, it } from 'vitest'
import {
  EDIT_SCHEMA_VERSION,
  DEFAULT_ADJUSTMENTS,
  createDefaultEditState,
  hasModifiedAdjustments,
  type Adjustments,
  type EditState,
} from './types'

describe('EDIT_SCHEMA_VERSION', () => {
  it('is a positive integer', () => {
    expect(EDIT_SCHEMA_VERSION).toBeGreaterThan(0)
    expect(Number.isInteger(EDIT_SCHEMA_VERSION)).toBe(true)
  })

  it('is currently version 1', () => {
    expect(EDIT_SCHEMA_VERSION).toBe(1)
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
    ]

    for (const key of requiredKeys) {
      expect(DEFAULT_ADJUSTMENTS).toHaveProperty(key)
    }
  })

  it('has all values set to zero', () => {
    for (const [key, value] of Object.entries(DEFAULT_ADJUSTMENTS)) {
      expect(value).toBe(0)
    }
  })

  it('is frozen and cannot be modified', () => {
    expect(Object.isFrozen(DEFAULT_ADJUSTMENTS)).toBe(true)
  })

  it('has exactly 10 adjustment properties', () => {
    expect(Object.keys(DEFAULT_ADJUSTMENTS)).toHaveLength(10)
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
})

describe('EditState interface', () => {
  it('can be created with valid values', () => {
    const state: EditState = {
      version: EDIT_SCHEMA_VERSION,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
    }

    expect(state.version).toBe(1)
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
  })
})
