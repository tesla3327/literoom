/**
 * Unit tests for the GPU status store.
 *
 * Tests GPU status state management including:
 * - Initial state
 * - Status getters (icon, color, text, render time)
 * - Actions (setAvailable, setError, clearError, setRenderTiming)
 * - Edge cases and state transitions
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useGpuStatusStore } from '~/stores/gpuStatus'
import type { EditPipelineTiming } from '@literoom/core'

describe('gpuStatusStore', () => {
  let store: ReturnType<typeof useGpuStatusStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useGpuStatusStore()
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('isAvailable is false', () => {
      expect(store.isAvailable).toBe(false)
    })

    it('isInitialized is false', () => {
      expect(store.isInitialized).toBe(false)
    })

    it('hasErrors is false', () => {
      expect(store.hasErrors).toBe(false)
    })

    it('deviceName is null', () => {
      expect(store.deviceName).toBeNull()
    })

    it('lastError is null', () => {
      expect(store.lastError).toBeNull()
    })

    it('lastRenderTiming is null', () => {
      expect(store.lastRenderTiming).toBeNull()
    })

    it('backend is unknown', () => {
      expect(store.backend).toBe('unknown')
    })
  })

  // ============================================================================
  // Getters - statusIcon
  // ============================================================================

  describe('statusIcon', () => {
    it('returns bolt-slash when unavailable (initial state)', () => {
      expect(store.statusIcon).toBe('i-heroicons-bolt-slash')
    })

    it('returns bolt when GPU is available', () => {
      store.setAvailable(true)
      expect(store.statusIcon).toBe('i-heroicons-bolt')
    })

    it('returns exclamation-triangle when has errors', () => {
      store.setError('Test error')
      expect(store.statusIcon).toBe('i-heroicons-exclamation-triangle')
    })

    it('returns exclamation-triangle when has errors even if available', () => {
      store.setAvailable(true)
      store.setError('Test error')
      expect(store.statusIcon).toBe('i-heroicons-exclamation-triangle')
    })

    it('returns bolt-slash when unavailable after initialization', () => {
      store.setAvailable(false)
      expect(store.statusIcon).toBe('i-heroicons-bolt-slash')
    })
  })

  // ============================================================================
  // Getters - statusColor
  // ============================================================================

  describe('statusColor', () => {
    it('returns neutral when unavailable (initial state)', () => {
      expect(store.statusColor).toBe('neutral')
    })

    it('returns success when GPU is available', () => {
      store.setAvailable(true)
      expect(store.statusColor).toBe('success')
    })

    it('returns warning when has errors', () => {
      store.setError('Test error')
      expect(store.statusColor).toBe('warning')
    })

    it('returns warning when has errors even if available', () => {
      store.setAvailable(true)
      store.setError('Test error')
      expect(store.statusColor).toBe('warning')
    })

    it('returns neutral when unavailable after initialization', () => {
      store.setAvailable(false)
      expect(store.statusColor).toBe('neutral')
    })
  })

  // ============================================================================
  // Getters - statusText
  // ============================================================================

  describe('statusText', () => {
    it('returns "Initializing..." when not initialized', () => {
      expect(store.statusText).toBe('Initializing...')
    })

    it('returns "GPU Accelerated" when available without device name', () => {
      store.setAvailable(true)
      expect(store.statusText).toBe('GPU Accelerated')
    })

    it('returns "GPU: <deviceName>" when available with device name', () => {
      store.setAvailable(true, 'Apple M1 Pro')
      expect(store.statusText).toBe('GPU: Apple M1 Pro')
    })

    it('returns "GPU Unavailable" when not available after initialization', () => {
      store.setAvailable(false)
      expect(store.statusText).toBe('GPU Unavailable')
    })

    it('returns "GPU Error" when has errors', () => {
      store.setError('Test error')
      expect(store.statusText).toBe('GPU Error')
    })

    it('returns "GPU Error" when has errors even if available with device name', () => {
      store.setAvailable(true, 'Apple M1 Pro')
      store.setError('Test error')
      expect(store.statusText).toBe('GPU Error')
    })

    it('returns "GPU Error" when has errors before initialization', () => {
      store.setError('Init error')
      expect(store.statusText).toBe('GPU Error')
    })
  })

  // ============================================================================
  // Getters - totalRenderTime
  // ============================================================================

  describe('totalRenderTime', () => {
    it('returns null when no timing data', () => {
      expect(store.totalRenderTime).toBeNull()
    })

    it('returns total from timing data', () => {
      const timing: EditPipelineTiming = {
        total: 16.5,
        upload: 2.0,
        rotation: 1.5,
        adjustments: 5.0,
        toneCurve: 3.0,
        masks: 2.5,
        readback: 2.5,
      }
      store.setRenderTiming(timing)
      expect(store.totalRenderTime).toBe(16.5)
    })

    it('returns 0 when total is 0', () => {
      const timing: EditPipelineTiming = {
        total: 0,
        upload: 0,
        rotation: 0,
        adjustments: 0,
        toneCurve: 0,
        masks: 0,
        readback: 0,
      }
      store.setRenderTiming(timing)
      expect(store.totalRenderTime).toBe(0)
    })
  })

  // ============================================================================
  // Actions - setAvailable
  // ============================================================================

  describe('setAvailable', () => {
    it('sets isAvailable to true', () => {
      store.setAvailable(true)
      expect(store.isAvailable).toBe(true)
    })

    it('sets isAvailable to false', () => {
      store.setAvailable(true)
      store.setAvailable(false)
      expect(store.isAvailable).toBe(false)
    })

    it('sets isInitialized to true', () => {
      store.setAvailable(true)
      expect(store.isInitialized).toBe(true)
    })

    it('sets isInitialized to true even when unavailable', () => {
      store.setAvailable(false)
      expect(store.isInitialized).toBe(true)
    })

    it('sets backend to webgpu when available', () => {
      store.setAvailable(true)
      expect(store.backend).toBe('webgpu')
    })

    it('sets backend to wasm when unavailable', () => {
      store.setAvailable(false)
      expect(store.backend).toBe('wasm')
    })

    it('sets deviceName when provided', () => {
      store.setAvailable(true, 'NVIDIA GeForce RTX 4090')
      expect(store.deviceName).toBe('NVIDIA GeForce RTX 4090')
    })

    it('does not change deviceName when not provided', () => {
      store.setAvailable(true, 'Initial Device')
      store.setAvailable(true)
      expect(store.deviceName).toBe('Initial Device')
    })

    it('allows updating deviceName', () => {
      store.setAvailable(true, 'First Device')
      store.setAvailable(true, 'Second Device')
      expect(store.deviceName).toBe('Second Device')
    })

    it('keeps deviceName when changing from available to unavailable', () => {
      store.setAvailable(true, 'My GPU')
      store.setAvailable(false)
      expect(store.deviceName).toBe('My GPU')
    })
  })

  // ============================================================================
  // Actions - setError
  // ============================================================================

  describe('setError', () => {
    it('sets hasErrors to true', () => {
      store.setError('Test error')
      expect(store.hasErrors).toBe(true)
    })

    it('sets lastError to the error message', () => {
      store.setError('WebGPU context lost')
      expect(store.lastError).toBe('WebGPU context lost')
    })

    it('overwrites previous error', () => {
      store.setError('First error')
      store.setError('Second error')
      expect(store.lastError).toBe('Second error')
    })

    it('keeps hasErrors true after multiple errors', () => {
      store.setError('Error 1')
      store.setError('Error 2')
      expect(store.hasErrors).toBe(true)
    })

    it('handles empty error string', () => {
      store.setError('')
      expect(store.hasErrors).toBe(true)
      expect(store.lastError).toBe('')
    })

    it('handles long error message', () => {
      const longError = 'A'.repeat(1000)
      store.setError(longError)
      expect(store.lastError).toBe(longError)
    })
  })

  // ============================================================================
  // Actions - clearError
  // ============================================================================

  describe('clearError', () => {
    it('sets hasErrors to false', () => {
      store.setError('Test error')
      store.clearError()
      expect(store.hasErrors).toBe(false)
    })

    it('sets lastError to null', () => {
      store.setError('Test error')
      store.clearError()
      expect(store.lastError).toBeNull()
    })

    it('is safe to call when no error exists', () => {
      store.clearError()
      expect(store.hasErrors).toBe(false)
      expect(store.lastError).toBeNull()
    })

    it('can be called multiple times safely', () => {
      store.setError('Test error')
      store.clearError()
      store.clearError()
      expect(store.hasErrors).toBe(false)
      expect(store.lastError).toBeNull()
    })

    it('restores status getters after clearing', () => {
      store.setAvailable(true, 'Test GPU')
      store.setError('Test error')
      expect(store.statusIcon).toBe('i-heroicons-exclamation-triangle')
      expect(store.statusColor).toBe('warning')
      expect(store.statusText).toBe('GPU Error')

      store.clearError()
      expect(store.statusIcon).toBe('i-heroicons-bolt')
      expect(store.statusColor).toBe('success')
      expect(store.statusText).toBe('GPU: Test GPU')
    })
  })

  // ============================================================================
  // Actions - setRenderTiming
  // ============================================================================

  describe('setRenderTiming', () => {
    const mockTiming: EditPipelineTiming = {
      total: 12.5,
      upload: 1.5,
      rotation: 2.0,
      adjustments: 4.0,
      toneCurve: 2.5,
      masks: 1.0,
      readback: 1.5,
    }

    it('sets lastRenderTiming', () => {
      store.setRenderTiming(mockTiming)
      expect(store.lastRenderTiming).toEqual(mockTiming)
    })

    it('updates totalRenderTime getter', () => {
      store.setRenderTiming(mockTiming)
      expect(store.totalRenderTime).toBe(12.5)
    })

    it('overwrites previous timing', () => {
      store.setRenderTiming(mockTiming)
      const newTiming: EditPipelineTiming = {
        total: 8.0,
        upload: 1.0,
        rotation: 0,
        adjustments: 3.0,
        toneCurve: 2.0,
        masks: 0,
        readback: 2.0,
      }
      store.setRenderTiming(newTiming)
      expect(store.lastRenderTiming).toEqual(newTiming)
      expect(store.totalRenderTime).toBe(8.0)
    })

    it('handles timing with all zeros', () => {
      const zeroTiming: EditPipelineTiming = {
        total: 0,
        upload: 0,
        rotation: 0,
        adjustments: 0,
        toneCurve: 0,
        masks: 0,
        readback: 0,
      }
      store.setRenderTiming(zeroTiming)
      expect(store.lastRenderTiming).toEqual(zeroTiming)
      expect(store.totalRenderTime).toBe(0)
    })

    it('handles fractional timing values', () => {
      const fractionalTiming: EditPipelineTiming = {
        total: 0.123456,
        upload: 0.001,
        rotation: 0.0005,
        adjustments: 0.1,
        toneCurve: 0.02,
        masks: 0.001,
        readback: 0.0009,
      }
      store.setRenderTiming(fractionalTiming)
      expect(store.totalRenderTime).toBe(0.123456)
    })
  })

  // ============================================================================
  // State Transitions
  // ============================================================================

  describe('state transitions', () => {
    it('initialization flow: unknown -> available', () => {
      expect(store.backend).toBe('unknown')
      expect(store.isInitialized).toBe(false)
      expect(store.statusText).toBe('Initializing...')

      store.setAvailable(true, 'Test GPU')

      expect(store.backend).toBe('webgpu')
      expect(store.isInitialized).toBe(true)
      expect(store.statusText).toBe('GPU: Test GPU')
    })

    it('initialization flow: unknown -> unavailable', () => {
      expect(store.backend).toBe('unknown')

      store.setAvailable(false)

      expect(store.backend).toBe('wasm')
      expect(store.isInitialized).toBe(true)
      expect(store.statusText).toBe('GPU Unavailable')
    })

    it('error recovery flow', () => {
      store.setAvailable(true, 'Test GPU')
      expect(store.statusColor).toBe('success')

      store.setError('Context lost')
      expect(store.statusColor).toBe('warning')
      expect(store.statusText).toBe('GPU Error')

      store.clearError()
      expect(store.statusColor).toBe('success')
      expect(store.statusText).toBe('GPU: Test GPU')
    })

    it('backend switch flow', () => {
      store.setAvailable(true)
      expect(store.backend).toBe('webgpu')

      store.setAvailable(false)
      expect(store.backend).toBe('wasm')

      store.setAvailable(true)
      expect(store.backend).toBe('webgpu')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('error state is independent of availability', () => {
      store.setAvailable(true)
      store.setError('Error')

      expect(store.isAvailable).toBe(true)
      expect(store.hasErrors).toBe(true)
    })

    it('clearing error does not affect availability', () => {
      store.setAvailable(true)
      store.setError('Error')
      store.clearError()

      expect(store.isAvailable).toBe(true)
      expect(store.hasErrors).toBe(false)
    })

    it('timing can be set before initialization', () => {
      const timing: EditPipelineTiming = {
        total: 10,
        upload: 1,
        rotation: 1,
        adjustments: 4,
        toneCurve: 2,
        masks: 1,
        readback: 1,
      }
      store.setRenderTiming(timing)
      expect(store.totalRenderTime).toBe(10)
    })

    it('timing persists through availability changes', () => {
      const timing: EditPipelineTiming = {
        total: 15,
        upload: 2,
        rotation: 2,
        adjustments: 5,
        toneCurve: 3,
        masks: 1,
        readback: 2,
      }
      store.setRenderTiming(timing)
      store.setAvailable(true)
      store.setAvailable(false)

      expect(store.totalRenderTime).toBe(15)
    })

    it('timing persists through error state changes', () => {
      const timing: EditPipelineTiming = {
        total: 20,
        upload: 3,
        rotation: 2,
        adjustments: 7,
        toneCurve: 4,
        masks: 2,
        readback: 2,
      }
      store.setRenderTiming(timing)
      store.setError('Error')
      store.clearError()

      expect(store.totalRenderTime).toBe(20)
    })

    it('device name can be set to empty string', () => {
      store.setAvailable(true, '')
      expect(store.deviceName).toBe('')
      // Empty string is falsy, so statusText shows generic message
      expect(store.statusText).toBe('GPU Accelerated')
    })

    it('handles rapid state changes', () => {
      for (let i = 0; i < 100; i++) {
        store.setAvailable(i % 2 === 0)
        if (i % 3 === 0) store.setError(`Error ${i}`)
        if (i % 5 === 0) store.clearError()
      }

      // Final state should be consistent
      expect(typeof store.isAvailable).toBe('boolean')
      expect(typeof store.hasErrors).toBe('boolean')
      expect(typeof store.isInitialized).toBe('boolean')
    })

    it('multiple stores are independent', () => {
      const store1 = useGpuStatusStore()
      store1.setAvailable(true, 'GPU 1')
      store1.setError('Error 1')

      // Create new Pinia instance for independent store
      setActivePinia(createPinia())
      const store2 = useGpuStatusStore()

      expect(store2.isAvailable).toBe(false)
      expect(store2.deviceName).toBeNull()
      expect(store2.hasErrors).toBe(false)
    })
  })
})
