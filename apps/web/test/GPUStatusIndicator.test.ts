/**
 * Unit tests for the GPUStatusIndicator component.
 *
 * Tests GPU status indicator functionality including:
 * - Rendering with different GPU states (available, unavailable, error)
 * - Correct icon binding based on status
 * - Correct color binding based on status
 * - Correct aria-label binding for accessibility
 * - Tooltip text display
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { defineComponent, h, computed, ref } from 'vue'
import GPUStatusIndicator from '~/components/gpu/GPUStatusIndicator.vue'
import { useGpuStatusStore } from '~/stores/gpuStatus'

// ============================================================================
// Mock Nuxt UI Components
// ============================================================================

const UTooltipStub = defineComponent({
  name: 'UTooltip',
  props: {
    text: String,
  },
  setup(props, { slots }) {
    return () => h('div', { class: 'u-tooltip', 'data-tooltip-text': props.text }, slots.default?.())
  },
})

const UButtonStub = defineComponent({
  name: 'UButton',
  props: {
    icon: String,
    color: String,
    variant: String,
    size: String,
    ariaLabel: String,
  },
  setup(props) {
    return () =>
      h('button', {
        class: 'u-button',
        'data-icon': props.icon,
        'data-color': props.color,
        'data-variant': props.variant,
        'data-size': props.size,
        'aria-label': props.ariaLabel,
      })
  },
})

// ============================================================================
// Test Setup
// ============================================================================

function mountComponent() {
  return mount(GPUStatusIndicator, {
    global: {
      stubs: {
        UTooltip: UTooltipStub,
        UButton: UButtonStub,
      },
    },
  })
}

describe('GPUStatusIndicator', () => {
  let store: ReturnType<typeof useGpuStatusStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useGpuStatusStore()
  })

  // ============================================================================
  // Basic Rendering
  // ============================================================================

  describe('basic rendering', () => {
    it('renders without crashing', () => {
      const wrapper = mountComponent()
      expect(wrapper.exists()).toBe(true)
    })

    it('renders a UTooltip component', () => {
      const wrapper = mountComponent()
      expect(wrapper.find('.u-tooltip').exists()).toBe(true)
    })

    it('renders a UButton component inside UTooltip', () => {
      const wrapper = mountComponent()
      expect(wrapper.find('.u-tooltip .u-button').exists()).toBe(true)
    })
  })

  // ============================================================================
  // GPU Available State
  // ============================================================================

  describe('when GPU is available', () => {
    beforeEach(() => {
      store.setAvailable(true)
    })

    it('displays bolt icon', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-icon')).toBe('i-heroicons-bolt')
    })

    it('displays success color', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-color')).toBe('success')
    })

    it('displays "GPU Accelerated" status text when no device name', () => {
      const wrapper = mountComponent()
      const tooltip = wrapper.find('.u-tooltip')
      expect(tooltip.attributes('data-tooltip-text')).toBe('GPU Accelerated')
    })

    it('displays device name in status text when available', () => {
      store.setAvailable(true, 'Apple M1 Pro')
      const wrapper = mountComponent()
      const tooltip = wrapper.find('.u-tooltip')
      expect(tooltip.attributes('data-tooltip-text')).toBe('GPU: Apple M1 Pro')
    })

    it('sets correct aria-label for accessibility', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('aria-label')).toBe('GPU Accelerated')
    })

    it('sets aria-label with device name when available', () => {
      store.setAvailable(true, 'NVIDIA GeForce RTX 3080')
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('aria-label')).toBe('GPU: NVIDIA GeForce RTX 3080')
    })
  })

  // ============================================================================
  // GPU Unavailable State
  // ============================================================================

  describe('when GPU is unavailable', () => {
    beforeEach(() => {
      store.setAvailable(false)
    })

    it('displays bolt-slash icon', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-icon')).toBe('i-heroicons-bolt-slash')
    })

    it('displays neutral color', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-color')).toBe('neutral')
    })

    it('displays "GPU Unavailable" status text', () => {
      const wrapper = mountComponent()
      const tooltip = wrapper.find('.u-tooltip')
      expect(tooltip.attributes('data-tooltip-text')).toBe('GPU Unavailable')
    })

    it('sets correct aria-label for accessibility', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('aria-label')).toBe('GPU Unavailable')
    })
  })

  // ============================================================================
  // GPU Error State
  // ============================================================================

  describe('when GPU has errors', () => {
    beforeEach(() => {
      store.setAvailable(true)
      store.setError('WebGPU context lost')
    })

    it('displays exclamation-triangle icon', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-icon')).toBe('i-heroicons-exclamation-triangle')
    })

    it('displays warning color', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-color')).toBe('warning')
    })

    it('displays "GPU Error" status text', () => {
      const wrapper = mountComponent()
      const tooltip = wrapper.find('.u-tooltip')
      expect(tooltip.attributes('data-tooltip-text')).toBe('GPU Error')
    })

    it('sets correct aria-label for accessibility', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('aria-label')).toBe('GPU Error')
    })

    it('error state takes precedence over available state', () => {
      // GPU was set available, then error occurred
      // Error state should show, not available state
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-icon')).toBe('i-heroicons-exclamation-triangle')
      expect(button.attributes('data-color')).toBe('warning')
    })
  })

  // ============================================================================
  // Initializing State
  // ============================================================================

  describe('when GPU is initializing', () => {
    // Default state: isInitialized = false, isAvailable = false, hasErrors = false

    it('displays bolt-slash icon (default unavailable)', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-icon')).toBe('i-heroicons-bolt-slash')
    })

    it('displays "Initializing..." status text', () => {
      const wrapper = mountComponent()
      const tooltip = wrapper.find('.u-tooltip')
      expect(tooltip.attributes('data-tooltip-text')).toBe('Initializing...')
    })

    it('sets correct aria-label for accessibility', () => {
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('aria-label')).toBe('Initializing...')
    })
  })

  // ============================================================================
  // Button Props
  // ============================================================================

  describe('button styling', () => {
    it('uses ghost variant', () => {
      store.setAvailable(true)
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-variant')).toBe('ghost')
    })

    it('uses sm size', () => {
      store.setAvailable(true)
      const wrapper = mountComponent()
      const button = wrapper.find('.u-button')
      expect(button.attributes('data-size')).toBe('sm')
    })
  })

  // ============================================================================
  // State Transitions
  // ============================================================================

  describe('state transitions', () => {
    it('updates when GPU becomes available', async () => {
      const wrapper = mountComponent()

      // Initial state: not initialized
      expect(wrapper.find('.u-tooltip').attributes('data-tooltip-text')).toBe('Initializing...')

      // GPU becomes available
      store.setAvailable(true, 'Test GPU')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.u-button').attributes('data-icon')).toBe('i-heroicons-bolt')
      expect(wrapper.find('.u-button').attributes('data-color')).toBe('success')
      expect(wrapper.find('.u-tooltip').attributes('data-tooltip-text')).toBe('GPU: Test GPU')
    })

    it('updates when error occurs', async () => {
      store.setAvailable(true)
      const wrapper = mountComponent()

      expect(wrapper.find('.u-button').attributes('data-icon')).toBe('i-heroicons-bolt')

      // Error occurs
      store.setError('GPU device lost')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.u-button').attributes('data-icon')).toBe('i-heroicons-exclamation-triangle')
      expect(wrapper.find('.u-button').attributes('data-color')).toBe('warning')
      expect(wrapper.find('.u-tooltip').attributes('data-tooltip-text')).toBe('GPU Error')
    })

    it('updates when error is cleared', async () => {
      store.setAvailable(true, 'Test GPU')
      store.setError('Temporary error')
      const wrapper = mountComponent()

      expect(wrapper.find('.u-button').attributes('data-icon')).toBe('i-heroicons-exclamation-triangle')

      // Clear error
      store.clearError()
      await wrapper.vm.$nextTick()

      expect(wrapper.find('.u-button').attributes('data-icon')).toBe('i-heroicons-bolt')
      expect(wrapper.find('.u-button').attributes('data-color')).toBe('success')
      expect(wrapper.find('.u-tooltip').attributes('data-tooltip-text')).toBe('GPU: Test GPU')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles empty device name', () => {
      store.setAvailable(true, '')
      const wrapper = mountComponent()
      // Empty string device name should show "GPU Accelerated" not "GPU: "
      expect(wrapper.find('.u-tooltip').attributes('data-tooltip-text')).toBe('GPU Accelerated')
    })

    it('handles undefined device name', () => {
      store.setAvailable(true, undefined)
      const wrapper = mountComponent()
      expect(wrapper.find('.u-tooltip').attributes('data-tooltip-text')).toBe('GPU Accelerated')
    })

    it('handles device name with special characters', () => {
      store.setAvailable(true, 'GPU <Test> & "Special"')
      const wrapper = mountComponent()
      expect(wrapper.find('.u-tooltip').attributes('data-tooltip-text')).toBe('GPU: GPU <Test> & "Special"')
    })

    it('handles very long device names', () => {
      const longName = 'A'.repeat(200)
      store.setAvailable(true, longName)
      const wrapper = mountComponent()
      expect(wrapper.find('.u-tooltip').attributes('data-tooltip-text')).toBe(`GPU: ${longName}`)
    })
  })

  // ============================================================================
  // Accessibility
  // ============================================================================

  describe('accessibility', () => {
    it('button is accessible via keyboard (renders as button element)', () => {
      store.setAvailable(true)
      const wrapper = mountComponent()
      // The stub renders a button element
      expect(wrapper.find('button').exists()).toBe(true)
    })

    it('provides meaningful aria-label in all states', () => {
      // Test all three states have meaningful aria-labels
      const testCases = [
        { setup: () => {}, expected: 'Initializing...' },
        { setup: () => store.setAvailable(true), expected: 'GPU Accelerated' },
        { setup: () => store.setAvailable(false), expected: 'GPU Unavailable' },
        { setup: () => { store.setAvailable(true); store.setError('Error') }, expected: 'GPU Error' },
      ]

      for (const testCase of testCases) {
        // Reset store for each test
        setActivePinia(createPinia())
        store = useGpuStatusStore()
        testCase.setup()

        const wrapper = mountComponent()
        const ariaLabel = wrapper.find('.u-button').attributes('aria-label')

        expect(ariaLabel).toBe(testCase.expected)
        expect(ariaLabel).not.toBe('')
        expect(ariaLabel).not.toBeUndefined()
      }
    })
  })
})
