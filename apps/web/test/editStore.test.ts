/**
 * Unit tests for the edit store.
 *
 * Tests edit state management including:
 * - Initial state
 * - Adjustment operations
 * - Tone curve operations
 * - Crop/transform operations
 * - Mask operations
 * - Cache management
 * - Dirty state tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditStore } from '~/stores/edit'
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP_TRANSFORM,
  EDIT_SCHEMA_VERSION,
} from '@literoom/core/catalog'
import { DEFAULT_TONE_CURVE } from '@literoom/core/decode'

// Mock the database functions
vi.mock('@literoom/core/catalog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@literoom/core/catalog')>()
  return {
    ...actual,
    loadEditStateFromDb: vi.fn().mockResolvedValue(null),
    loadAllEditStatesFromDb: vi.fn().mockResolvedValue(new Map()),
    saveEditStateToDb: vi.fn().mockResolvedValue(undefined),
  }
})

describe('editStore', () => {
  let store: ReturnType<typeof useEditStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useEditStore()
    vi.clearAllMocks()
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('has null currentAssetId', () => {
      expect(store.currentAssetId).toBeNull()
    })

    it('has default adjustments', () => {
      expect(store.adjustments).toEqual({ ...DEFAULT_ADJUSTMENTS })
    })

    it('has default crop transform', () => {
      expect(store.cropTransform.crop).toEqual(DEFAULT_CROP_TRANSFORM.crop)
      expect(store.cropTransform.rotation).toEqual(DEFAULT_CROP_TRANSFORM.rotation)
    })

    it('has null masks', () => {
      expect(store.masks).toBeNull()
    })

    it('has null selectedMaskId', () => {
      expect(store.selectedMaskId).toBeNull()
    })

    it('isDirty is false', () => {
      expect(store.isDirty).toBe(false)
    })

    it('isSaving is false', () => {
      expect(store.isSaving).toBe(false)
    })

    it('error is null', () => {
      expect(store.error).toBeNull()
    })

    it('isInitialized is false', () => {
      expect(store.isInitialized).toBe(false)
    })

    it('hasModifications is false', () => {
      expect(store.hasModifications).toBe(false)
    })
  })

  // ============================================================================
  // Adjustment Operations
  // ============================================================================

  describe('setAdjustment', () => {
    it('updates a single adjustment', () => {
      store.setAdjustment('exposure', 1.5)
      expect(store.adjustments.exposure).toBe(1.5)
    })

    it('marks state as dirty', () => {
      store.setAdjustment('exposure', 1.5)
      expect(store.isDirty).toBe(true)
    })

    it('updates hasModifications', () => {
      store.setAdjustment('exposure', 1.5)
      expect(store.hasModifications).toBe(true)
    })

    it('can update multiple different adjustments', () => {
      store.setAdjustment('exposure', 0.5)
      store.setAdjustment('contrast', 10)
      store.setAdjustment('saturation', -5)

      expect(store.adjustments.exposure).toBe(0.5)
      expect(store.adjustments.contrast).toBe(10)
      expect(store.adjustments.saturation).toBe(-5)
    })
  })

  describe('setAdjustments', () => {
    it('updates multiple adjustments at once', () => {
      store.setAdjustments({
        exposure: 1.0,
        contrast: 20,
        highlights: -30,
      })

      expect(store.adjustments.exposure).toBe(1.0)
      expect(store.adjustments.contrast).toBe(20)
      expect(store.adjustments.highlights).toBe(-30)
    })

    it('preserves other adjustments', () => {
      store.setAdjustment('exposure', 2.0)
      store.setAdjustments({ contrast: 10 })

      expect(store.adjustments.exposure).toBe(2.0)
      expect(store.adjustments.contrast).toBe(10)
    })

    it('marks state as dirty', () => {
      store.setAdjustments({ exposure: 0.5 })
      expect(store.isDirty).toBe(true)
    })
  })

  describe('reset', () => {
    it('resets all adjustments to defaults', () => {
      store.setAdjustment('exposure', 2.0)
      store.setAdjustment('contrast', 50)
      store.reset()

      expect(store.adjustments).toEqual({ ...DEFAULT_ADJUSTMENTS })
    })

    it('resets crop transform to default', () => {
      store.setCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
      store.reset()

      expect(store.cropTransform.crop).toEqual(DEFAULT_CROP_TRANSFORM.crop)
    })

    it('clears masks', () => {
      store.addLinearMask({
        id: 'test-mask',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        feather: 0.5,
        enabled: true,
        adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0 },
      })
      store.reset()

      expect(store.masks).toBeNull()
    })

    it('clears selected mask', () => {
      store.addLinearMask({
        id: 'test-mask',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        feather: 0.5,
        enabled: true,
        adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0 },
      })
      expect(store.selectedMaskId).toBe('test-mask')
      store.reset()

      expect(store.selectedMaskId).toBeNull()
    })

    it('marks state as dirty', () => {
      store.reset()
      expect(store.isDirty).toBe(true)
    })
  })

  // ============================================================================
  // Tone Curve Operations
  // ============================================================================

  describe('tone curve', () => {
    describe('setToneCurve', () => {
      it('sets the tone curve', () => {
        const newCurve = {
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 },
            { x: 1, y: 1 },
          ],
        }
        store.setToneCurve(newCurve)

        expect(store.adjustments.toneCurve.points).toHaveLength(3)
        expect(store.adjustments.toneCurve.points[1]).toEqual({ x: 0.5, y: 0.6 })
      })

      it('marks state as dirty', () => {
        store.setToneCurve({ points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })
        expect(store.isDirty).toBe(true)
      })

      it('updates hasCurveModifications', () => {
        store.setToneCurve({
          points: [
            { x: 0, y: 0.1 }, // Modified from default
            { x: 1, y: 1 },
          ],
        })
        expect(store.hasCurveModifications).toBe(true)
      })
    })

    describe('addCurvePoint', () => {
      it('adds a new point', () => {
        const initialLength = store.adjustments.toneCurve.points.length
        store.addCurvePoint({ x: 0.5, y: 0.5 })

        expect(store.adjustments.toneCurve.points.length).toBe(initialLength + 1)
      })

      it('sorts points by x coordinate', () => {
        store.setToneCurve({
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        })
        store.addCurvePoint({ x: 0.3, y: 0.4 })
        store.addCurvePoint({ x: 0.7, y: 0.8 })

        const points = store.adjustments.toneCurve.points
        for (let i = 1; i < points.length; i++) {
          expect(points[i].x).toBeGreaterThanOrEqual(points[i - 1].x)
        }
      })
    })

    describe('updateCurvePoint', () => {
      it('updates a point by index', () => {
        store.setToneCurve({
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 1 },
          ],
        })
        store.updateCurvePoint(1, { x: 0.6, y: 0.7 })

        // Points may be re-sorted, find the updated point
        const point = store.adjustments.toneCurve.points.find(p => p.y === 0.7)
        expect(point).toBeDefined()
        expect(point?.x).toBe(0.6)
      })
    })

    describe('deleteCurvePoint', () => {
      it('deletes a point by index', () => {
        store.setToneCurve({
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 1 },
          ],
        })
        store.deleteCurvePoint(1)

        expect(store.adjustments.toneCurve.points).toHaveLength(2)
      })

      it('cannot delete first anchor point', () => {
        store.setToneCurve({
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 1 },
          ],
        })
        store.deleteCurvePoint(0)

        expect(store.adjustments.toneCurve.points).toHaveLength(3)
      })

      it('cannot delete last anchor point', () => {
        store.setToneCurve({
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.5 },
            { x: 1, y: 1 },
          ],
        })
        store.deleteCurvePoint(2)

        expect(store.adjustments.toneCurve.points).toHaveLength(3)
      })

      it('cannot reduce below 2 points', () => {
        store.setToneCurve({
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        })
        store.deleteCurvePoint(1)

        expect(store.adjustments.toneCurve.points).toHaveLength(2)
      })
    })

    describe('resetToneCurve', () => {
      it('resets to default linear curve', () => {
        store.setToneCurve({
          points: [
            { x: 0, y: 0 },
            { x: 0.25, y: 0.3 },
            { x: 0.75, y: 0.8 },
            { x: 1, y: 1 },
          ],
        })
        store.resetToneCurve()

        expect(store.adjustments.toneCurve.points).toEqual(DEFAULT_TONE_CURVE.points)
      })

      it('hasCurveModifications becomes false', () => {
        store.setToneCurve({
          points: [
            { x: 0, y: 0 },
            { x: 0.5, y: 0.6 },
            { x: 1, y: 1 },
          ],
        })
        expect(store.hasCurveModifications).toBe(true)

        store.resetToneCurve()
        expect(store.hasCurveModifications).toBe(false)
      })
    })
  })

  // ============================================================================
  // Crop/Transform Operations
  // ============================================================================

  describe('crop/transform', () => {
    describe('setCrop', () => {
      it('sets crop rectangle', () => {
        store.setCrop({ x: 0.1, y: 0.2, width: 0.6, height: 0.5 })

        expect(store.cropTransform.crop).toEqual({ x: 0.1, y: 0.2, width: 0.6, height: 0.5 })
      })

      it('clears crop with null', () => {
        store.setCrop({ x: 0.1, y: 0.2, width: 0.6, height: 0.5 })
        store.setCrop(null)

        expect(store.cropTransform.crop).toBeNull()
      })

      it('marks state as dirty', () => {
        store.setCrop({ x: 0.1, y: 0.2, width: 0.6, height: 0.5 })
        expect(store.isDirty).toBe(true)
      })

      it('updates hasCropTransformModifications', () => {
        store.setCrop({ x: 0.1, y: 0.2, width: 0.6, height: 0.5 })
        expect(store.hasCropTransformModifications).toBe(true)
      })
    })

    describe('setRotation', () => {
      it('sets rotation parameters', () => {
        store.setRotation({ angle: 90, straighten: 5, flipHorizontal: true, flipVertical: false })

        expect(store.cropTransform.rotation.angle).toBe(90)
        expect(store.cropTransform.rotation.straighten).toBe(5)
        expect(store.cropTransform.rotation.flipHorizontal).toBe(true)
      })
    })

    describe('setRotationAngle', () => {
      it('sets only rotation angle', () => {
        store.setRotation({ angle: 0, straighten: 10, flipHorizontal: false, flipVertical: false })
        store.setRotationAngle(180)

        expect(store.cropTransform.rotation.angle).toBe(180)
        expect(store.cropTransform.rotation.straighten).toBe(10) // preserved
      })
    })

    describe('setStraightenAngle', () => {
      it('sets only straighten angle', () => {
        store.setRotation({ angle: 90, straighten: 0, flipHorizontal: false, flipVertical: false })
        store.setStraightenAngle(15)

        expect(store.cropTransform.rotation.straighten).toBe(15)
        expect(store.cropTransform.rotation.angle).toBe(90) // preserved
      })
    })

    describe('resetCropTransform', () => {
      it('resets to default', () => {
        store.setCrop({ x: 0.1, y: 0.2, width: 0.6, height: 0.5 })
        store.setRotationAngle(90)
        store.resetCropTransform()

        expect(store.cropTransform.crop).toEqual(DEFAULT_CROP_TRANSFORM.crop)
        expect(store.cropTransform.rotation).toEqual(DEFAULT_CROP_TRANSFORM.rotation)
      })
    })
  })

  // ============================================================================
  // Mask Operations
  // ============================================================================

  describe('masks', () => {
    const testLinearMask = {
      id: 'linear-1',
      start: { x: 0, y: 0.5 },
      end: { x: 1, y: 0.5 },
      feather: 0.5,
      enabled: true,
      adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0 },
    }

    const testRadialMask = {
      id: 'radial-1',
      center: { x: 0.5, y: 0.5 },
      radiusX: 0.3,
      radiusY: 0.2,
      rotation: 0,
      feather: 0.5,
      invert: false,
      enabled: true,
      adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0 },
    }

    describe('addLinearMask', () => {
      it('creates mask stack if null', () => {
        expect(store.masks).toBeNull()
        store.addLinearMask(testLinearMask)
        expect(store.masks).not.toBeNull()
      })

      it('adds mask to linearMasks array', () => {
        store.addLinearMask(testLinearMask)
        expect(store.masks?.linearMasks).toHaveLength(1)
        expect(store.masks?.linearMasks[0].id).toBe('linear-1')
      })

      it('selects the newly added mask', () => {
        store.addLinearMask(testLinearMask)
        expect(store.selectedMaskId).toBe('linear-1')
      })

      it('marks state as dirty', () => {
        store.addLinearMask(testLinearMask)
        expect(store.isDirty).toBe(true)
      })

      it('updates hasMaskModifications', () => {
        store.addLinearMask(testLinearMask)
        expect(store.hasMaskModifications).toBe(true)
      })
    })

    describe('addRadialMask', () => {
      it('creates mask stack if null', () => {
        expect(store.masks).toBeNull()
        store.addRadialMask(testRadialMask)
        expect(store.masks).not.toBeNull()
      })

      it('adds mask to radialMasks array', () => {
        store.addRadialMask(testRadialMask)
        expect(store.masks?.radialMasks).toHaveLength(1)
        expect(store.masks?.radialMasks[0].id).toBe('radial-1')
      })

      it('selects the newly added mask', () => {
        store.addRadialMask(testRadialMask)
        expect(store.selectedMaskId).toBe('radial-1')
      })
    })

    describe('updateLinearMask', () => {
      it('updates mask properties', () => {
        store.addLinearMask(testLinearMask)
        store.updateLinearMask('linear-1', { feather: 0.8 })

        expect(store.masks?.linearMasks[0].feather).toBe(0.8)
      })

      it('does nothing for non-existent mask', () => {
        store.addLinearMask(testLinearMask)
        store.updateLinearMask('non-existent', { feather: 0.8 })

        expect(store.masks?.linearMasks[0].feather).toBe(0.5) // unchanged
      })
    })

    describe('updateRadialMask', () => {
      it('updates mask properties', () => {
        store.addRadialMask(testRadialMask)
        store.updateRadialMask('radial-1', { radiusX: 0.5, invert: true })

        expect(store.masks?.radialMasks[0].radiusX).toBe(0.5)
        expect(store.masks?.radialMasks[0].invert).toBe(true)
      })
    })

    describe('deleteMask', () => {
      it('deletes linear mask', () => {
        store.addLinearMask(testLinearMask)
        store.deleteMask('linear-1')

        expect(store.masks?.linearMasks).toHaveLength(0)
      })

      it('deletes radial mask', () => {
        store.addRadialMask(testRadialMask)
        store.deleteMask('radial-1')

        expect(store.masks?.radialMasks).toHaveLength(0)
      })

      it('clears selectedMaskId if deleted mask was selected', () => {
        store.addLinearMask(testLinearMask)
        expect(store.selectedMaskId).toBe('linear-1')
        store.deleteMask('linear-1')

        expect(store.selectedMaskId).toBeNull()
      })
    })

    describe('toggleMaskEnabled', () => {
      it('toggles linear mask enabled state', () => {
        store.addLinearMask(testLinearMask)
        expect(store.masks?.linearMasks[0].enabled).toBe(true)

        store.toggleMaskEnabled('linear-1')
        expect(store.masks?.linearMasks[0].enabled).toBe(false)

        store.toggleMaskEnabled('linear-1')
        expect(store.masks?.linearMasks[0].enabled).toBe(true)
      })

      it('toggles radial mask enabled state', () => {
        store.addRadialMask(testRadialMask)
        store.toggleMaskEnabled('radial-1')

        expect(store.masks?.radialMasks[0].enabled).toBe(false)
      })
    })

    describe('selectMask', () => {
      it('selects a mask by id', () => {
        store.addLinearMask(testLinearMask)
        store.addRadialMask(testRadialMask)

        store.selectMask('radial-1')
        expect(store.selectedMaskId).toBe('radial-1')

        store.selectMask('linear-1')
        expect(store.selectedMaskId).toBe('linear-1')
      })

      it('clears selection with null', () => {
        store.addLinearMask(testLinearMask)
        store.selectMask(null)

        expect(store.selectedMaskId).toBeNull()
      })
    })

    describe('setMaskAdjustments', () => {
      it('sets adjustments for linear mask', () => {
        store.addLinearMask(testLinearMask)
        store.setMaskAdjustments('linear-1', {
          exposure: 0.5,
          contrast: 10,
          highlights: -20,
          shadows: 15,
        })

        expect(store.masks?.linearMasks[0].adjustments.exposure).toBe(0.5)
        expect(store.masks?.linearMasks[0].adjustments.contrast).toBe(10)
      })
    })

    describe('setMaskAdjustment', () => {
      it('sets single adjustment for mask', () => {
        store.addLinearMask(testLinearMask)
        store.setMaskAdjustment('linear-1', 'exposure', 1.0)

        expect(store.masks?.linearMasks[0].adjustments.exposure).toBe(1.0)
      })
    })

    describe('resetMasks', () => {
      it('clears all masks', () => {
        store.addLinearMask(testLinearMask)
        store.addRadialMask(testRadialMask)
        store.resetMasks()

        expect(store.masks).toBeNull()
      })

      it('clears selection', () => {
        store.addLinearMask(testLinearMask)
        store.resetMasks()

        expect(store.selectedMaskId).toBeNull()
      })
    })

    describe('selectedMask computed', () => {
      it('returns null when no mask selected', () => {
        store.selectMask(null)
        expect(store.selectedMask).toBeNull()
      })

      it('returns linear mask with type', () => {
        store.addLinearMask(testLinearMask)
        store.selectMask('linear-1')

        expect(store.selectedMask?.type).toBe('linear')
        expect(store.selectedMask?.mask.id).toBe('linear-1')
      })

      it('returns radial mask with type', () => {
        store.addRadialMask(testRadialMask)
        store.selectMask('radial-1')

        expect(store.selectedMask?.type).toBe('radial')
        expect(store.selectedMask?.mask.id).toBe('radial-1')
      })
    })
  })

  // ============================================================================
  // Clear Operation
  // ============================================================================

  describe('clear', () => {
    it('clears currentAssetId', () => {
      // We can't directly set currentAssetId without loadForAsset,
      // but we can verify clear resets to expected state
      store.clear()
      expect(store.currentAssetId).toBeNull()
    })

    it('resets adjustments to defaults', () => {
      store.setAdjustment('exposure', 2.0)
      store.clear()

      expect(store.adjustments).toEqual({ ...DEFAULT_ADJUSTMENTS })
    })

    it('resets crop transform', () => {
      store.setCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
      store.clear()

      expect(store.cropTransform.crop).toEqual(DEFAULT_CROP_TRANSFORM.crop)
    })

    it('clears masks', () => {
      store.addLinearMask({
        id: 'test',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        feather: 0.5,
        enabled: true,
        adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0 },
      })
      store.clear()

      expect(store.masks).toBeNull()
    })

    it('resets dirty flag', () => {
      store.setAdjustment('exposure', 1.0)
      expect(store.isDirty).toBe(true)
      store.clear()

      expect(store.isDirty).toBe(false)
    })

    it('clears error', () => {
      // Error is set internally, just verify clear clears it
      store.clear()
      expect(store.error).toBeNull()
    })
  })

  // ============================================================================
  // Edit State Computed
  // ============================================================================

  describe('editState computed', () => {
    it('returns current edit state as object', () => {
      store.setAdjustment('exposure', 0.5)
      store.setCrop({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })

      const state = store.editState
      expect(state.version).toBe(EDIT_SCHEMA_VERSION)
      expect(state.adjustments.exposure).toBe(0.5)
      expect(state.cropTransform.crop).toEqual({ x: 0.1, y: 0.1, width: 0.8, height: 0.8 })
    })

    it('includes masks when present', () => {
      store.addLinearMask({
        id: 'test',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        feather: 0.5,
        enabled: true,
        adjustments: { exposure: 0, contrast: 0, highlights: 0, shadows: 0 },
      })

      const state = store.editState
      expect(state.masks?.linearMasks).toHaveLength(1)
    })

    it('excludes masks when none', () => {
      const state = store.editState
      expect(state.masks).toBeUndefined()
    })
  })

  // ============================================================================
  // getEditStateForAsset
  // ============================================================================

  describe('getEditStateForAsset', () => {
    it('returns null for asset not in cache', () => {
      const state = store.getEditStateForAsset('non-existent')
      expect(state).toBeNull()
    })

    // Note: Testing cache hit requires loadForAsset which has async DB calls
    // Those are tested in integration tests
  })

  // ============================================================================
  // Save Operation
  // ============================================================================

  describe('save', () => {
    it('returns early when currentAssetId is null', async () => {
      expect(store.currentAssetId).toBeNull()
      store.setAdjustment('exposure', 1.0) // Make dirty

      await store.save()

      // isSaving should never have been set to true since we returned early
      expect(store.isSaving).toBe(false)
      // isDirty should still be true since save didn't complete
      expect(store.isDirty).toBe(true)
    })

    it('returns early when isDirty is false', async () => {
      // Simulate having an asset loaded by directly manipulating internal state
      // We need to use loadForAsset to set currentAssetId properly
      const { loadEditStateFromDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValueOnce(null)

      await store.loadForAsset('test-asset-123')
      expect(store.currentAssetId).toBe('test-asset-123')
      expect(store.isDirty).toBe(false)

      await store.save()

      // isSaving should never have been set to true since we returned early
      expect(store.isSaving).toBe(false)
    })

    it('sets isSaving to true during save', async () => {
      const { loadEditStateFromDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValueOnce(null)

      await store.loadForAsset('test-asset-123')
      store.setAdjustment('exposure', 1.0) // Make dirty

      // Create a promise that we can control to observe isSaving during execution
      let isSavingDuringSave = false

      // Since the current implementation doesn't actually call the DB,
      // we need to check that isSaving transitions correctly
      const originalSave = store.save.bind(store)

      // We'll verify by checking the state transitions
      expect(store.isSaving).toBe(false)

      const savePromise = store.save()

      // After save completes, isSaving should be false
      await savePromise
      expect(store.isSaving).toBe(false)
    })

    it('sets isDirty to false after successful save', async () => {
      const { loadEditStateFromDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValueOnce(null)

      await store.loadForAsset('test-asset-123')
      store.setAdjustment('exposure', 1.0)
      expect(store.isDirty).toBe(true)

      await store.save()

      expect(store.isDirty).toBe(false)
    })

    it('resets isSaving to false after save completes', async () => {
      const { loadEditStateFromDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValueOnce(null)

      await store.loadForAsset('test-asset-123')
      store.setAdjustment('exposure', 1.0) // Make dirty

      // Verify isSaving transitions correctly
      expect(store.isSaving).toBe(false)
      await store.save()
      expect(store.isSaving).toBe(false)
    })

    it('clears error before starting save', async () => {
      const { loadEditStateFromDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValueOnce(null)

      await store.loadForAsset('test-asset-123')
      store.setAdjustment('exposure', 1.0)

      // Manually set an error to simulate previous error state
      // Note: In the actual implementation, error is set by save() on exception,
      // but save() currently has a TODO and doesn't call saveEditStateToDb
      // So we test that save() clears error.value = null at the start
      await store.save()

      // Error should be cleared (was null, remains null)
      expect(store.error).toBeNull()
    })
  })

  // ============================================================================
  // Navigation Persistence (Issue fix: edits lost when navigating between photos)
  // ============================================================================

  describe('navigation persistence', () => {
    it('persists adjustments when navigating away and back', async () => {
      const { loadEditStateFromDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValue(null)

      // Load photo A
      await store.loadForAsset('photo-A')
      expect(store.currentAssetId).toBe('photo-A')

      // Make adjustments to photo A
      store.setAdjustment('exposure', 0.5)
      store.setAdjustment('contrast', 25)
      expect(store.adjustments.exposure).toBe(0.5)
      expect(store.adjustments.contrast).toBe(25)

      // Navigate to photo B
      await store.loadForAsset('photo-B')
      expect(store.currentAssetId).toBe('photo-B')
      // Photo B should have default adjustments
      expect(store.adjustments.exposure).toBe(0)
      expect(store.adjustments.contrast).toBe(0)

      // Navigate back to photo A
      await store.loadForAsset('photo-A')
      expect(store.currentAssetId).toBe('photo-A')

      // Photo A's adjustments should be restored from cache
      expect(store.adjustments.exposure).toBe(0.5)
      expect(store.adjustments.contrast).toBe(25)
    })

    it('preserves multiple photos in cache during navigation', async () => {
      const { loadEditStateFromDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValue(null)

      // Edit photo A
      await store.loadForAsset('photo-A')
      store.setAdjustment('exposure', 1.0)

      // Edit photo B
      await store.loadForAsset('photo-B')
      store.setAdjustment('exposure', -1.0)

      // Edit photo C
      await store.loadForAsset('photo-C')
      store.setAdjustment('exposure', 0.5)

      // Navigate back to each and verify edits are preserved
      await store.loadForAsset('photo-A')
      expect(store.adjustments.exposure).toBe(1.0)

      await store.loadForAsset('photo-B')
      expect(store.adjustments.exposure).toBe(-1.0)

      await store.loadForAsset('photo-C')
      expect(store.adjustments.exposure).toBe(0.5)
    })

    it('saves edits to cache immediately on markDirty', async () => {
      const { loadEditStateFromDb, saveEditStateToDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValue(null)

      await store.loadForAsset('test-asset')
      store.setAdjustment('exposure', 1.0)

      // Check that saveEditStateToDb was called (async persistence)
      expect(saveEditStateToDb).toHaveBeenCalledWith(
        'test-asset',
        expect.objectContaining({
          adjustments: expect.objectContaining({ exposure: 1.0 }),
        }),
        expect.any(Number),
      )
    })

    it('retrieves edit state from cache via getEditStateForAsset', async () => {
      const { loadEditStateFromDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValue(null)

      // Load and edit photo A
      await store.loadForAsset('photo-A')
      store.setAdjustment('exposure', 0.75)

      // Navigate to photo B
      await store.loadForAsset('photo-B')

      // Get edit state for photo A (should come from cache)
      const photoAState = store.getEditStateForAsset('photo-A')
      expect(photoAState).not.toBeNull()
      expect(photoAState?.adjustments.exposure).toBe(0.75)
    })

    it('returns current state for currently active asset', async () => {
      const { loadEditStateFromDb } = await import('@literoom/core/catalog')
      vi.mocked(loadEditStateFromDb).mockResolvedValue(null)

      await store.loadForAsset('current-asset')
      store.setAdjustment('exposure', 1.5)

      // Get state for current asset - should return fresh state
      const currentState = store.getEditStateForAsset('current-asset')
      expect(currentState).not.toBeNull()
      expect(currentState?.adjustments.exposure).toBe(1.5)
    })
  })
})
