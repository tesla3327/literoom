/**
 * Tests for crop re-edit showing full uncropped image
 *
 * When the crop tool is active on an already-cropped image, the preview
 * should display the full uncropped image so users can see and adjust
 * areas that were previously excluded.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useEditUIStore } from '../app/stores/editUI'
import { useEditStore } from '../app/stores/edit'

describe('cropReeditFullImage', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('shouldApplyCrop logic', () => {
    it('returns false when no crop exists', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // No crop in store
      expect(editStore.cropTransform.crop).toBe(null)

      // shouldApplyCrop = hasCrop && !isCropToolActive
      const hasCrop = !!editStore.cropTransform.crop
      const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive

      expect(shouldApplyCrop).toBe(false)
    })

    it('returns false when crop exists but crop tool is active', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // Set a crop in the store
      editStore.setCrop({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })

      // Activate crop tool
      editUIStore.activateCropTool()

      expect(editStore.cropTransform.crop).not.toBe(null)
      expect(editUIStore.isCropToolActive).toBe(true)

      // shouldApplyCrop should be false (tool active)
      const hasCrop = !!editStore.cropTransform.crop
      const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive

      expect(shouldApplyCrop).toBe(false)
    })

    it('returns true when crop exists and crop tool is inactive', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // Set a crop in the store
      editStore.setCrop({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })

      // Ensure crop tool is not active
      editUIStore.deactivateCropTool()

      expect(editStore.cropTransform.crop).not.toBe(null)
      expect(editUIStore.isCropToolActive).toBe(false)

      // shouldApplyCrop should be true (has crop, tool inactive)
      const hasCrop = !!editStore.cropTransform.crop
      const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive

      expect(shouldApplyCrop).toBe(true)
    })

    it('returns false when crop tool is active even with pending crop', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // Set a crop in the store
      editStore.setCrop({
        left: 0.2,
        top: 0.2,
        width: 0.6,
        height: 0.6,
      })

      // Activate crop tool (this initializes pendingCrop)
      editUIStore.activateCropTool()

      // Set a different pending crop
      editUIStore.setPendingCrop({
        left: 0.3,
        top: 0.3,
        width: 0.4,
        height: 0.4,
      })

      // shouldApplyCrop should still be false (tool active)
      const hasCrop = !!editStore.cropTransform.crop
      const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive

      expect(shouldApplyCrop).toBe(false)
    })
  })

  describe('crop tool activation', () => {
    it('activateCropTool sets isCropToolActive to true', () => {
      const editUIStore = useEditUIStore()

      expect(editUIStore.isCropToolActive).toBe(false)
      editUIStore.activateCropTool()
      expect(editUIStore.isCropToolActive).toBe(true)
    })

    it('deactivateCropTool sets isCropToolActive to false', () => {
      const editUIStore = useEditUIStore()

      editUIStore.activateCropTool()
      expect(editUIStore.isCropToolActive).toBe(true)

      editUIStore.deactivateCropTool()
      expect(editUIStore.isCropToolActive).toBe(false)
    })

    it('initializePendingCrop copies crop from edit store', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // Set a crop in the store
      const originalCrop = {
        left: 0.15,
        top: 0.25,
        width: 0.7,
        height: 0.5,
      }
      editStore.setCrop(originalCrop)

      // Initialize pending crop
      editUIStore.initializePendingCrop()

      // Pending crop should match edit store crop
      expect(editUIStore.pendingCrop).toEqual(originalCrop)
    })

    it('initializePendingCrop sets full image when no crop exists', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // No crop in store
      expect(editStore.cropTransform.crop).toBe(null)

      // Initialize pending crop
      editUIStore.initializePendingCrop()

      // Pending crop should be full image
      expect(editUIStore.pendingCrop).toEqual({
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      })
    })
  })

  describe('applying and canceling pending crop', () => {
    it('applyPendingCrop commits pending crop to edit store', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // Start with no crop
      expect(editStore.cropTransform.crop).toBe(null)

      // Activate crop tool and set a pending crop
      editUIStore.activateCropTool()
      editUIStore.setPendingCrop({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })

      // Apply the pending crop
      editUIStore.applyPendingCrop()

      // Edit store should have the crop
      expect(editStore.cropTransform.crop).toEqual({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })

      // Crop tool should be deactivated
      expect(editUIStore.isCropToolActive).toBe(false)
    })

    it('cancelPendingCrop reverts to stored crop', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // Start with a crop
      const originalCrop = {
        left: 0.2,
        top: 0.2,
        width: 0.6,
        height: 0.6,
      }
      editStore.setCrop(originalCrop)

      // Activate crop tool
      editUIStore.activateCropTool()

      // Change pending crop
      editUIStore.setPendingCrop({
        left: 0.3,
        top: 0.3,
        width: 0.4,
        height: 0.4,
      })

      // Cancel
      editUIStore.cancelPendingCrop()

      // Edit store should still have original crop
      expect(editStore.cropTransform.crop).toEqual(originalCrop)

      // Crop tool should be deactivated
      expect(editUIStore.isCropToolActive).toBe(false)
    })

    it('resetPendingCrop sets pending crop to full image', () => {
      const editUIStore = useEditUIStore()

      // Activate and set a crop
      editUIStore.activateCropTool()
      editUIStore.setPendingCrop({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })

      // Reset
      editUIStore.resetPendingCrop()

      // Pending crop should be full image
      expect(editUIStore.pendingCrop).toEqual({
        left: 0,
        top: 0,
        width: 1,
        height: 1,
      })
    })
  })

  describe('edge cases', () => {
    it('handles rapid tool activation/deactivation', () => {
      const editUIStore = useEditUIStore()

      editUIStore.activateCropTool()
      expect(editUIStore.isCropToolActive).toBe(true)

      editUIStore.deactivateCropTool()
      expect(editUIStore.isCropToolActive).toBe(false)

      editUIStore.activateCropTool()
      expect(editUIStore.isCropToolActive).toBe(true)

      editUIStore.activateCropTool() // Double activation
      expect(editUIStore.isCropToolActive).toBe(true)
    })

    it('handles crop with adjustments also applied', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // Set adjustments
      editStore.setAdjustment('exposure', 0.5)
      editStore.setAdjustment('contrast', 0.2)

      // Set crop
      editStore.setCrop({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })

      // Activate crop tool
      editUIStore.activateCropTool()

      // Adjustments should still be present
      expect(editStore.adjustments.exposure).toBe(0.5)
      expect(editStore.adjustments.contrast).toBe(0.2)

      // shouldApplyCrop should be false (tool active)
      const hasCrop = !!editStore.cropTransform.crop
      const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive
      expect(shouldApplyCrop).toBe(false)
    })

    it('handles crop with rotation applied', () => {
      const editUIStore = useEditUIStore()
      const editStore = useEditStore()

      // Set rotation
      editStore.setRotation({ angle: 45, straighten: 2 })

      // Set crop
      editStore.setCrop({
        left: 0.1,
        top: 0.1,
        width: 0.8,
        height: 0.8,
      })

      // Activate crop tool
      editUIStore.activateCropTool()

      // Rotation should still be present
      expect(editStore.cropTransform.rotation.angle).toBe(45)
      expect(editStore.cropTransform.rotation.straighten).toBe(2)

      // shouldApplyCrop should be false (tool active)
      const hasCrop = !!editStore.cropTransform.crop
      const shouldApplyCrop = hasCrop && !editUIStore.isCropToolActive
      expect(shouldApplyCrop).toBe(false)
    })
  })
})
