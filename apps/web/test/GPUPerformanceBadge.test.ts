/**
 * Unit tests for the GPUPerformanceBadge Vue component.
 *
 * Tests:
 * - Conditional rendering based on timing data availability
 * - Correct time formatting (rounded to integer + "ms")
 * - Backend display ("GPU" for webgpu, "WASM" for wasm)
 * - Badge color based on backend type
 */

import { describe, it, expect } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import GPUPerformanceBadge from '~/components/gpu/GPUPerformanceBadge.vue'
import { useGpuStatusStore } from '~/stores/gpuStatus'

/**
 * Helper to mount the component and get the store.
 * The store is accessed after mounting to use the same Pinia instance.
 */
async function mountWithStore() {
  const component = await mountSuspended(GPUPerformanceBadge)
  const store = useGpuStatusStore()
  return { component, store }
}

describe('GPUPerformanceBadge', () => {
  // ============================================================================
  // Conditional Rendering
  // ============================================================================

  describe('conditional rendering', () => {
    it('does not render when no timing data is available', async () => {
      const { component, store } = await mountWithStore()

      // Default state: lastRenderTiming is null, so totalRenderTime returns null
      expect(store.totalRenderTime).toBeNull()

      // Component should not render the badge (v-if="displayTime" is falsy)
      expect(component.text()).toBe('')
    })

    it('renders when timing data is available', async () => {
      const { component, store } = await mountWithStore()

      // Set render timing so totalRenderTime returns a value
      store.setRenderTiming({
        total: 16.5,
        histogram: 2,
        transform: 3,
        adjustments: 5,
        canvas: 6.5,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      // Component should render with timing and backend info
      expect(component.text()).toContain('ms')
    })
  })

  // ============================================================================
  // Time Formatting
  // ============================================================================

  describe('time formatting', () => {
    it('rounds time to integer and appends "ms"', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 16.7,
        histogram: 2,
        transform: 3,
        adjustments: 5,
        canvas: 6.7,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      // 16.7 should round to 17
      expect(component.text()).toContain('17ms')
    })

    it('rounds down when decimal is less than 0.5', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 16.2,
        histogram: 2,
        transform: 3,
        adjustments: 5,
        canvas: 6.2,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      // 16.2 should round to 16
      expect(component.text()).toContain('16ms')
    })

    it('handles exactly 0.5 decimal (rounds to nearest even)', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 16.5,
        histogram: 2,
        transform: 3,
        adjustments: 5,
        canvas: 6.5,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      // 16.5 rounds to 17 with Math.round
      expect(component.text()).toContain('17ms')
    })

    it('handles zero render time', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 0,
        histogram: 0,
        transform: 0,
        adjustments: 0,
        canvas: 0,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      expect(component.text()).toContain('0ms')
    })

    it('handles large render times', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 1234.6,
        histogram: 200,
        transform: 300,
        adjustments: 400,
        canvas: 334.6,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      expect(component.text()).toContain('1235ms')
    })

    it('handles very small render times', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 0.4,
        histogram: 0.1,
        transform: 0.1,
        adjustments: 0.1,
        canvas: 0.1,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      // 0.4 rounds to 0
      expect(component.text()).toContain('0ms')
    })
  })

  // ============================================================================
  // Backend Display
  // ============================================================================

  describe('backend display', () => {
    it('shows "GPU" for webgpu backend', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 10,
        histogram: 2,
        transform: 2,
        adjustments: 3,
        canvas: 3,
      })
      store.setAvailable(true) // Sets backend to 'webgpu'

      await component.vm.$nextTick()

      expect(component.text()).toContain('GPU')
      expect(component.text()).not.toContain('WASM')
    })

    it('shows "WASM" for wasm backend', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 50,
        histogram: 10,
        transform: 10,
        adjustments: 15,
        canvas: 15,
      })
      store.setAvailable(false) // Sets backend to 'wasm'

      await component.vm.$nextTick()

      expect(component.text()).toContain('WASM')
      // Make sure it doesn't show standalone "GPU" (it will have "WASM" which doesn't contain "GPU")
      expect(component.text()).toBe('50ms WASM')
    })

    it('displays both time and backend together', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 25.3,
        histogram: 5,
        transform: 5,
        adjustments: 8,
        canvas: 7.3,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      // Should show "25ms GPU" format
      expect(component.text()).toBe('25ms GPU')
    })
  })

  // ============================================================================
  // Badge Color
  // ============================================================================

  describe('badge color', () => {
    it('has success color for webgpu backend', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 16,
        histogram: 2,
        transform: 3,
        adjustments: 5,
        canvas: 6,
      })
      store.setAvailable(true) // webgpu backend

      await component.vm.$nextTick()

      // The UBadge component should have color="success" prop
      // We check the rendered component's props or attributes
      const badge = component.findComponent({ name: 'UBadge' })
      expect(badge.exists()).toBe(true)
      expect(badge.props('color')).toBe('success')
    })

    it('has neutral color for wasm backend', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 100,
        histogram: 20,
        transform: 20,
        adjustments: 30,
        canvas: 30,
      })
      store.setAvailable(false) // wasm backend

      await component.vm.$nextTick()

      const badge = component.findComponent({ name: 'UBadge' })
      expect(badge.exists()).toBe(true)
      expect(badge.props('color')).toBe('neutral')
    })
  })

  // ============================================================================
  // Badge Variant and Size
  // ============================================================================

  describe('badge styling', () => {
    it('uses subtle variant', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 16,
        histogram: 2,
        transform: 3,
        adjustments: 5,
        canvas: 6,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      const badge = component.findComponent({ name: 'UBadge' })
      expect(badge.exists()).toBe(true)
      expect(badge.props('variant')).toBe('subtle')
    })

    it('uses xs size', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 16,
        histogram: 2,
        transform: 3,
        adjustments: 5,
        canvas: 6,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      const badge = component.findComponent({ name: 'UBadge' })
      expect(badge.exists()).toBe(true)
      expect(badge.props('size')).toBe('xs')
    })
  })

  // ============================================================================
  // Store State Changes
  // ============================================================================

  describe('reactivity to store changes', () => {
    it('updates display when timing changes', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 10,
        histogram: 2,
        transform: 2,
        adjustments: 3,
        canvas: 3,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()
      expect(component.text()).toContain('10ms')

      // Update timing
      store.setRenderTiming({
        total: 20,
        histogram: 4,
        transform: 4,
        adjustments: 6,
        canvas: 6,
      })

      // Vue reactivity should update the component
      await component.vm.$nextTick()
      expect(component.text()).toContain('20ms')
    })

    it('updates backend display when backend changes', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 10,
        histogram: 2,
        transform: 2,
        adjustments: 3,
        canvas: 3,
      })
      store.setAvailable(true) // GPU

      await component.vm.$nextTick()
      expect(component.text()).toContain('GPU')

      // Change to WASM
      store.setAvailable(false)
      await component.vm.$nextTick()

      expect(component.text()).toContain('WASM')
    })

    it('hides badge when timing becomes null', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 10,
        histogram: 2,
        transform: 2,
        adjustments: 3,
        canvas: 3,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()
      expect(component.text()).toContain('10ms')

      // Clear timing by setting lastRenderTiming to null directly
      store.lastRenderTiming = null
      await component.vm.$nextTick()

      // Badge should no longer render
      expect(component.text()).toBe('')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles unknown backend state', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: 10,
        histogram: 2,
        transform: 2,
        adjustments: 3,
        canvas: 3,
      })
      // Backend defaults to 'unknown' before setAvailable is called
      // Force the backend to unknown
      store.backend = 'unknown'

      await component.vm.$nextTick()

      // When backend is 'unknown' (not 'webgpu'), should show 'WASM'
      expect(component.text()).toContain('WASM')

      // Color should be neutral (not success)
      const badge = component.findComponent({ name: 'UBadge' })
      expect(badge.props('color')).toBe('neutral')
    })

    it('handles negative render times gracefully', async () => {
      const { component, store } = await mountWithStore()

      // This shouldn't happen in practice, but test defensive behavior
      store.setRenderTiming({
        total: -5.7,
        histogram: -1,
        transform: -1,
        adjustments: -2,
        canvas: -1.7,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      // Math.round(-5.7) = -6
      expect(component.text()).toContain('-6ms')
    })

    it('handles Infinity render time', async () => {
      const { component, store } = await mountWithStore()

      store.setRenderTiming({
        total: Infinity,
        histogram: Infinity,
        transform: 0,
        adjustments: 0,
        canvas: 0,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      // Math.round(Infinity) = Infinity
      expect(component.text()).toContain('Infinity')
    })
  })
})
