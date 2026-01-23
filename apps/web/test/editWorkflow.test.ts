/**
 * Integration tests for the edit workflow.
 *
 * Tests the interaction between stores for a complete edit workflow,
 * including edit state management, copy/paste, and persistence.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditStore } from '~/stores/edit'
import { useEditClipboardStore } from '~/stores/editClipboard'

// Mock database functions
vi.mock('@literoom/core/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@literoom/core/catalog')>()
  return {
    ...actual,
    loadEditStateFromDb: vi.fn().mockResolvedValue(null),
    loadAllEditStatesFromDb: vi.fn().mockResolvedValue(new Map()),
    saveEditStateToDb: vi.fn().mockResolvedValue(undefined),
  }
})

// ============================================================================
// Test Setup
// ============================================================================

describe('Edit Workflow Integration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  // ============================================================================
  // Basic Adjustment Workflow
  // ============================================================================

  describe('basic adjustment workflow', () => {
    it('applies adjustments', () => {
      const editStore = useEditStore()

      editStore.setAdjustment('exposure', 1.5)

      expect(editStore.adjustments.exposure).toBe(1.5)
    })

    it('tracks dirty state for modified adjustments', () => {
      const editStore = useEditStore()

      expect(editStore.isDirty).toBe(false)

      editStore.setAdjustment('exposure', 1.0)
      expect(editStore.isDirty).toBe(true)
    })

    it('resets all adjustments', () => {
      const editStore = useEditStore()

      editStore.setAdjustment('exposure', 1.5)
      editStore.setAdjustment('contrast', 50)
      editStore.setAdjustment('saturation', -25)

      editStore.reset()

      expect(editStore.adjustments.exposure).toBe(0)
      expect(editStore.adjustments.contrast).toBe(0)
      expect(editStore.adjustments.saturation).toBe(0)
    })

    it('updates multiple adjustments at once', () => {
      const editStore = useEditStore()

      editStore.setAdjustments({
        exposure: 1.5,
        contrast: 25,
        saturation: 50,
      })

      expect(editStore.adjustments.exposure).toBe(1.5)
      expect(editStore.adjustments.contrast).toBe(25)
      expect(editStore.adjustments.saturation).toBe(50)
    })
  })

  // ============================================================================
  // Tone Curve Workflow
  // ============================================================================

  describe('tone curve workflow', () => {
    it('adds curve points', () => {
      const editStore = useEditStore()

      editStore.addCurvePoint({ x: 0.25, y: 0.2 })
      editStore.addCurvePoint({ x: 0.75, y: 0.8 })

      expect(editStore.adjustments.toneCurve.points.length).toBeGreaterThan(2)
    })

    it('updates existing curve points', () => {
      const editStore = useEditStore()

      editStore.addCurvePoint({ x: 0.5, y: 0.5 })

      const pointIndex = editStore.adjustments.toneCurve.points.findIndex(
        p => Math.abs(p.x - 0.5) < 0.01,
      )

      if (pointIndex >= 0) {
        editStore.updateCurvePoint(pointIndex, { x: 0.5, y: 0.7 })
        expect(editStore.adjustments.toneCurve.points[pointIndex].y).toBeCloseTo(0.7, 1)
      }
    })

    it('deletes curve points', () => {
      const editStore = useEditStore()

      editStore.addCurvePoint({ x: 0.5, y: 0.5 })

      const initialLength = editStore.adjustments.toneCurve.points.length
      const pointIndex = editStore.adjustments.toneCurve.points.findIndex(
        p => Math.abs(p.x - 0.5) < 0.01,
      )

      if (pointIndex >= 0) {
        editStore.deleteCurvePoint(pointIndex)
        expect(editStore.adjustments.toneCurve.points.length).toBeLessThan(initialLength)
      }
    })

    it('resets tone curve to linear', () => {
      const editStore = useEditStore()

      editStore.addCurvePoint({ x: 0.25, y: 0.15 })
      editStore.addCurvePoint({ x: 0.75, y: 0.85 })

      editStore.resetToneCurve()

      expect(editStore.adjustments.toneCurve.points.length).toBe(2)
      expect(editStore.adjustments.toneCurve.points[0]).toEqual({ x: 0, y: 0 })
      expect(editStore.adjustments.toneCurve.points[1]).toEqual({ x: 1, y: 1 })
    })
  })

  // ============================================================================
  // Crop/Transform Workflow
  // ============================================================================

  describe('crop/transform workflow', () => {
    it('applies crop settings', () => {
      const editStore = useEditStore()

      editStore.setCrop({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })

      expect(editStore.cropTransform.crop).toEqual({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })
    })

    it('applies rotation', () => {
      const editStore = useEditStore()

      editStore.setRotation({ angle: 90, straighten: 0, flipH: false, flipV: false })

      expect(editStore.cropTransform.rotation.angle).toBe(90)
    })

    it('applies rotation angle', () => {
      const editStore = useEditStore()

      editStore.setRotationAngle(15.5)

      expect(editStore.cropTransform.rotation.angle).toBeCloseTo(15.5)
    })

    it('applies straighten angle', () => {
      const editStore = useEditStore()

      editStore.setStraightenAngle(-3.5)

      expect(editStore.cropTransform.rotation.straighten).toBeCloseTo(-3.5)
    })

    it('resets crop and transform settings', () => {
      const editStore = useEditStore()

      editStore.setCrop({ left: 0.1, top: 0.1, width: 0.8, height: 0.8 })
      editStore.setRotation({ angle: 90, straighten: 0, flipH: false, flipV: false })
      editStore.setStraightenAngle(5)

      editStore.resetCropTransform()

      expect(editStore.cropTransform.crop).toBeNull()
      expect(editStore.cropTransform.rotation.angle).toBe(0)
      expect(editStore.cropTransform.rotation.straighten).toBe(0)
    })
  })

  // ============================================================================
  // Copy/Paste Workflow
  // ============================================================================

  describe('copy/paste workflow', () => {
    it('copies selected adjustment groups', () => {
      const editStore = useEditStore()
      const clipboardStore = useEditClipboardStore()

      editStore.setAdjustment('exposure', 1.5)
      editStore.setAdjustment('contrast', 25)
      editStore.setAdjustment('saturation', 50)

      clipboardStore.setGroup('basicAdjustments', true)
      clipboardStore.setGroup('toneCurve', false)

      clipboardStore.setCopiedSettings(editStore.editState)

      expect(clipboardStore.copiedSettings).not.toBeNull()
    })

    it('pastes settings', () => {
      const editStore = useEditStore()
      const clipboardStore = useEditClipboardStore()

      editStore.setAdjustment('exposure', 1.5)
      editStore.setAdjustment('contrast', 25)

      clipboardStore.setGroup('basicAdjustments', true)
      clipboardStore.setCopiedSettings(editStore.editState)

      // Reset to simulate switching assets
      editStore.reset()
      expect(editStore.adjustments.exposure).toBe(0)

      // Paste settings
      if (clipboardStore.copiedSettings?.adjustments) {
        editStore.setAdjustments(clipboardStore.copiedSettings.adjustments)
      }

      expect(editStore.adjustments.exposure).toBe(1.5)
      expect(editStore.adjustments.contrast).toBe(25)
    })

    it('select all selects all groups', () => {
      const clipboardStore = useEditClipboardStore()

      clipboardStore.selectAll()

      expect(clipboardStore.selectedGroups.basicAdjustments).toBe(true)
      expect(clipboardStore.selectedGroups.toneCurve).toBe(true)
      expect(clipboardStore.selectedGroups.crop).toBe(true)
      expect(clipboardStore.selectedGroups.rotation).toBe(true)
    })

    it('select none deselects all groups', () => {
      const clipboardStore = useEditClipboardStore()

      clipboardStore.selectAll()
      clipboardStore.selectNone()

      expect(clipboardStore.selectedGroups.basicAdjustments).toBe(false)
      expect(clipboardStore.selectedGroups.toneCurve).toBe(false)
      expect(clipboardStore.selectedGroups.crop).toBe(false)
      expect(clipboardStore.selectedGroups.rotation).toBe(false)
    })

    it('provides clipboard summary when settings are copied', () => {
      const editStore = useEditStore()
      const clipboardStore = useEditClipboardStore()

      editStore.setAdjustment('exposure', 1.5)

      // First set up the groups we want to copy
      clipboardStore.setGroup('basicAdjustments', true)

      // Copy the settings - this creates the clipboard entry with current group settings
      clipboardStore.setCopiedSettings(editStore.editState)

      // Check that settings were copied
      expect(clipboardStore.copiedSettings).not.toBeNull()
      expect(clipboardStore.hasClipboardContent).toBe(true)
    })

    it('clears clipboard', () => {
      const editStore = useEditStore()
      const clipboardStore = useEditClipboardStore()

      clipboardStore.setCopiedSettings(editStore.editState)
      expect(clipboardStore.copiedSettings).not.toBeNull()

      clipboardStore.clear()
      expect(clipboardStore.copiedSettings).toBeNull()
    })
  })

  // ============================================================================
  // hasModifications Computed
  // ============================================================================

  describe('hasModifications', () => {
    it('returns false for default state', () => {
      const editStore = useEditStore()

      expect(editStore.hasModifications).toBe(false)
    })

    it('returns true when adjustments are modified', () => {
      const editStore = useEditStore()

      editStore.setAdjustment('exposure', 0.5)

      expect(editStore.hasModifications).toBe(true)
    })

    it('returns true when crop is set', () => {
      const editStore = useEditStore()

      editStore.setCrop({ left: 0.1, top: 0.1, width: 0.8, height: 0.8 })

      expect(editStore.hasModifications).toBe(true)
    })

    it('returns true when rotation is set', () => {
      const editStore = useEditStore()

      editStore.setRotation({ angle: 90, straighten: 0, flipH: false, flipV: false })

      expect(editStore.hasModifications).toBe(true)
    })

    it('returns true when tone curve is modified', () => {
      const editStore = useEditStore()

      editStore.addCurvePoint({ x: 0.5, y: 0.7 })

      expect(editStore.hasModifications).toBe(true)
    })
  })

  // ============================================================================
  // Edit State Object
  // ============================================================================

  describe('editState computed', () => {
    it('returns complete edit state object', () => {
      const editStore = useEditStore()

      editStore.setAdjustment('exposure', 1.5)
      editStore.setCrop({ left: 0.1, top: 0.1, width: 0.8, height: 0.8 })

      const state = editStore.editState

      expect(state.adjustments.exposure).toBe(1.5)
      expect(state.cropTransform.crop).toEqual({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })
    })
  })
})
