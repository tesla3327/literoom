/**
 * Unit tests for the GPUPerformanceBadge Vue component.
 *
 * Tests:
 * - Conditional rendering based on timing data availability
 * - Correct FPS display (rolling average, rounded to integer)
 * - Backend display ("GPU" for webgpu, "WASM" for wasm)
 * - Badge color based on backend type
 */

import { describe, it, expect, beforeEach } from 'vitest'
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

/**
 * Reset store state before each test to ensure isolation.
 * This is needed because Pinia stores are singletons in the test environment.
 */
beforeEach(() => {
  const store = useGpuStatusStore()
  store.lastRenderTiming = null
  store.backend = 'unknown'
  store.isInitialized = false
  store.isAvailable = false
  store.recentRenderTimes = []
})

describe('GPUPerformanceBadge', () => {
  // ============================================================================
  // Conditional Rendering
  // ============================================================================

  describe('conditional rendering', () => {
    it('does not render when GPU is not initialized', async () => {
      const { component, store } = await mountWithStore()

      // Default state: isInitialized is false
      expect(store.isInitialized).toBe(false)

      // Component should not render the badge
      expect(component.text()).toBe('')
    })

    it('renders with default state when initialized but no timing data', async () => {
      const { component, store } = await mountWithStore()

      // Initialize GPU but don't set timing
      store.setAvailable(true)

      await component.vm.$nextTick()

      // Component should show default "-- FPS" state
      expect(component.text()).toBe('-- FPS GPU')
    })

    it('renders with FPS when timing data is available', async () => {
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

      // Component should render with FPS and backend info
      expect(component.text()).toContain('FPS')
      expect(component.text()).not.toContain('--')
    })
  })

  // ============================================================================
  // FPS Display
  // ============================================================================

  describe('FPS display', () => {
    it('displays FPS calculated from render time', async () => {
      const { component, store } = await mountWithStore()

      // 20ms = 50 FPS
      store.setRenderTiming({
        total: 20,
        histogram: 4,
        transform: 4,
        adjustments: 6,
        canvas: 6,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      expect(component.text()).toContain('50 FPS')
    })

    it('rounds FPS to integer', async () => {
      const { component, store } = await mountWithStore()

      // 16.67ms = 59.99 FPS, rounds to 60
      store.setRenderTiming({
        total: 16.67,
        histogram: 3,
        transform: 3,
        adjustments: 5,
        canvas: 5.67,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      expect(component.text()).toContain('60 FPS')
    })

    it('shows high FPS for fast render times', async () => {
      const { component, store } = await mountWithStore()

      // 5ms = 200 FPS
      store.setRenderTiming({
        total: 5,
        histogram: 1,
        transform: 1,
        adjustments: 1.5,
        canvas: 1.5,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      expect(component.text()).toContain('200 FPS')
    })

    it('shows low FPS for slow render times', async () => {
      const { component, store } = await mountWithStore()

      // 100ms = 10 FPS
      store.setRenderTiming({
        total: 100,
        histogram: 20,
        transform: 20,
        adjustments: 30,
        canvas: 30,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      expect(component.text()).toContain('10 FPS')
    })

    it('shows default state when render time is zero', async () => {
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

      // Zero time would cause division by zero, show default state
      expect(component.text()).toBe('-- FPS GPU')
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

      // 50ms = 20 FPS
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
      expect(component.text()).toBe('20 FPS WASM')
    })

    it('displays both FPS and backend together', async () => {
      const { component, store } = await mountWithStore()

      // 25ms = 40 FPS
      store.setRenderTiming({
        total: 25,
        histogram: 5,
        transform: 5,
        adjustments: 8,
        canvas: 7,
      })
      store.setAvailable(true)

      await component.vm.$nextTick()

      // Should show "40 FPS GPU" format
      expect(component.text()).toBe('40 FPS GPU')
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

      // Use unique timing value to ensure watch triggers
      store.setRenderTiming({
        total: 17,
        histogram: 3,
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
    it('uses rolling average for FPS calculation', async () => {
      const { component, store } = await mountWithStore()
      store.setAvailable(true)

      // First reading: 10ms = 100 FPS
      store.setRenderTiming({
        total: 10,
        histogram: 2,
        transform: 2,
        adjustments: 3,
        canvas: 3,
      })
      await component.vm.$nextTick()
      expect(component.text()).toContain('100 FPS')

      // Second reading: 20ms
      // Rolling average of [10, 20] = 15ms = 67 FPS
      store.setRenderTiming({
        total: 20,
        histogram: 4,
        transform: 4,
        adjustments: 6,
        canvas: 6,
      })
      await component.vm.$nextTick()
      expect(component.text()).toContain('67 FPS')

      // Third reading: 30ms
      // Rolling average of [10, 20, 30] = 20ms = 50 FPS
      store.setRenderTiming({
        total: 30,
        histogram: 6,
        transform: 6,
        adjustments: 9,
        canvas: 9,
      })
      await component.vm.$nextTick()
      expect(component.text()).toContain('50 FPS')
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
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles unknown backend state', async () => {
      const { component, store } = await mountWithStore()

      // Use unique timing value to ensure watch triggers
      store.setRenderTiming({
        total: 11,
        histogram: 2,
        transform: 2,
        adjustments: 4,
        canvas: 3,
      })
      // Set available first to trigger watch, then force backend to unknown
      store.setAvailable(true)
      store.backend = 'unknown'

      await component.vm.$nextTick()

      // When backend is 'unknown' (not 'webgpu'), should show 'WASM'
      expect(component.text()).toContain('WASM')

      // Color should be neutral (not success)
      const badge = component.findComponent({ name: 'UBadge' })
      expect(badge.props('color')).toBe('neutral')
    })
  })
})
