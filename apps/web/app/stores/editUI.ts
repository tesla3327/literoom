/**
 * Edit UI Store
 *
 * Manages UI state for the edit view that needs to be shared across components.
 * This includes clipping overlay toggles and other UI-only state that doesn't
 * persist with the edit settings.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useEditUIStore = defineStore('editUI', () => {
  // ============================================================================
  // Clipping Overlay State
  // ============================================================================

  /** Whether to show highlight clipping overlay on the preview */
  const showHighlightClipping = ref(false)

  /** Whether to show shadow clipping overlay on the preview */
  const showShadowClipping = ref(false)

  // ============================================================================
  // Crop Tool State
  // ============================================================================

  /** Whether the crop tool is active (overlay visible on main preview) */
  const isCropToolActive = ref(false)

  // ============================================================================
  // Clipping Toggle Methods
  // ============================================================================

  /**
   * Toggle both clipping overlays (J key behavior).
   * If either overlay is on, turn both off. Otherwise, turn both on.
   */
  function toggleClippingOverlays(): void {
    if (showHighlightClipping.value || showShadowClipping.value) {
      showHighlightClipping.value = false
      showShadowClipping.value = false
    }
    else {
      showHighlightClipping.value = true
      showShadowClipping.value = true
    }
  }

  /**
   * Toggle shadow clipping overlay only.
   */
  function toggleShadowClipping(): void {
    showShadowClipping.value = !showShadowClipping.value
  }

  /**
   * Toggle highlight clipping overlay only.
   */
  function toggleHighlightClipping(): void {
    showHighlightClipping.value = !showHighlightClipping.value
  }

  /**
   * Reset all clipping overlays to hidden.
   */
  function resetClippingOverlays(): void {
    showHighlightClipping.value = false
    showShadowClipping.value = false
  }

  // ============================================================================
  // Crop Tool Methods
  // ============================================================================

  /**
   * Activate the crop tool (show overlay on main preview).
   */
  function activateCropTool(): void {
    isCropToolActive.value = true
  }

  /**
   * Deactivate the crop tool (hide overlay on main preview).
   */
  function deactivateCropTool(): void {
    isCropToolActive.value = false
  }

  /**
   * Toggle the crop tool active state.
   */
  function toggleCropTool(): void {
    isCropToolActive.value = !isCropToolActive.value
  }

  return {
    // Clipping State
    showHighlightClipping,
    showShadowClipping,
    // Clipping Methods
    toggleClippingOverlays,
    toggleShadowClipping,
    toggleHighlightClipping,
    resetClippingOverlays,
    // Crop Tool State
    isCropToolActive,
    // Crop Tool Methods
    activateCropTool,
    deactivateCropTool,
    toggleCropTool,
  }
})
