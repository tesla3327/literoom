/**
 * EditCropActionBar Component Tests
 *
 * Tests for the crop action bar that provides Apply, Cancel, and Reset buttons
 * for the crop confirmation workflow.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import EditCropActionBar from '~/components/edit/EditCropActionBar.vue'
import { useEditUIStore } from '~/stores/editUI'
import { useEditStore } from '~/stores/edit'

// Mock UIcon and UButton components
const UIcon = {
  name: 'UIcon',
  template: '<span class="u-icon"><slot /></span>',
  props: ['name', 'class'],
}

const UButton = {
  name: 'UButton',
  template: '<button class="u-button" @click="$emit(\'click\')"><slot /></button>',
  props: ['size', 'variant', 'color', 'disabled'],
  emits: ['click'],
}

describe('EditCropActionBar', () => {
  let editUIStore: ReturnType<typeof useEditUIStore>
  let editStore: ReturnType<typeof useEditStore>

  beforeEach(() => {
    // Create and activate a new Pinia instance for each test
    setActivePinia(createPinia())
    editUIStore = useEditUIStore()
    editStore = useEditStore()
  })

  function mountComponent() {
    return mount(EditCropActionBar, {
      global: {
        stubs: {
          UIcon,
          UButton,
        },
      },
    })
  }

  describe('rendering', () => {
    it('should render the action bar with instructions', () => {
      const wrapper = mountComponent()
      expect(wrapper.text()).toContain('Adjust crop region')
    })

    it('should render Set Crop button', () => {
      const wrapper = mountComponent()
      expect(wrapper.text()).toContain('Set Crop')
    })

    it('should render Cancel button', () => {
      const wrapper = mountComponent()
      expect(wrapper.text()).toContain('Cancel')
    })

    it('should render Reset button when there is an existing crop', () => {
      // Set up an existing crop
      editStore.setCrop({ left: 0.1, top: 0.1, width: 0.8, height: 0.8 })

      const wrapper = mountComponent()
      expect(wrapper.text()).toContain('Reset')
    })

    it('should not render Reset button when there is no existing crop', () => {
      // Default state has no crop
      const wrapper = mountComponent()
      expect(wrapper.text()).not.toContain('Reset')
    })
  })

  describe('interactions', () => {
    it('should call applyPendingCrop when Set Crop button is clicked', async () => {
      editUIStore.activateCropTool()
      editUIStore.setPendingCrop({ left: 0.2, top: 0.2, width: 0.6, height: 0.6 })

      const wrapper = mountComponent()
      const applyButton = wrapper.find('[data-testid="crop-apply-button"]')

      await applyButton.trigger('click')

      // After apply, crop tool should be deactivated
      expect(editUIStore.isCropToolActive).toBe(false)
      expect(editUIStore.pendingCrop).toBe(null)
    })

    it('should call cancelPendingCrop when Cancel button is clicked', async () => {
      editUIStore.activateCropTool()
      editUIStore.setPendingCrop({ left: 0.2, top: 0.2, width: 0.6, height: 0.6 })

      const wrapper = mountComponent()
      const cancelButton = wrapper.find('[data-testid="crop-cancel-button"]')

      await cancelButton.trigger('click')

      // After cancel, crop tool should be deactivated and pending cleared
      expect(editUIStore.isCropToolActive).toBe(false)
      expect(editUIStore.pendingCrop).toBe(null)
    })

    it('should call resetPendingCrop when Reset button is clicked', async () => {
      // Set up an existing crop
      editStore.setCrop({ left: 0.1, top: 0.1, width: 0.8, height: 0.8 })
      editUIStore.activateCropTool()
      editUIStore.setPendingCrop({ left: 0.2, top: 0.2, width: 0.6, height: 0.6 })

      const wrapper = mountComponent()
      const resetButton = wrapper.find('[data-testid="crop-reset-button"]')

      await resetButton.trigger('click')

      // After reset, pending crop should be full image
      expect(editUIStore.pendingCrop).toEqual({ left: 0, top: 0, width: 1, height: 1 })
      // Crop tool should still be active
      expect(editUIStore.isCropToolActive).toBe(true)
    })
  })

  describe('data-testid attributes', () => {
    it('should have data-testid="crop-action-bar" on root element', () => {
      const wrapper = mountComponent()
      expect(wrapper.find('[data-testid="crop-action-bar"]').exists()).toBe(true)
    })

    it('should have data-testid="crop-apply-button" on apply button', () => {
      const wrapper = mountComponent()
      expect(wrapper.find('[data-testid="crop-apply-button"]').exists()).toBe(true)
    })

    it('should have data-testid="crop-cancel-button" on cancel button', () => {
      const wrapper = mountComponent()
      expect(wrapper.find('[data-testid="crop-cancel-button"]').exists()).toBe(true)
    })

    it('should have data-testid="crop-reset-button" on reset button when visible', () => {
      editStore.setCrop({ left: 0.1, top: 0.1, width: 0.8, height: 0.8 })
      const wrapper = mountComponent()
      expect(wrapper.find('[data-testid="crop-reset-button"]').exists()).toBe(true)
    })
  })
})
