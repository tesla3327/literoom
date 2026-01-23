/**
 * GPU Status Store
 *
 * Tracks GPU acceleration status for UI display:
 * - GPU availability and initialization state
 * - Error tracking and reporting
 * - Performance timing from the edit pipeline
 * - Backend information (WebGPU, WASM, or unknown)
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { EditPipelineTiming } from '@literoom/core'

// ============================================================================
// Types
// ============================================================================

/**
 * State interface for GPU status tracking.
 */
export interface GPUStatusState {
  /** Whether GPU acceleration is available */
  isAvailable: boolean
  /** Whether GPU initialization has completed */
  isInitialized: boolean
  /** Whether GPU has encountered errors */
  hasErrors: boolean
  /** GPU device name (e.g., "Apple M1 Pro") */
  deviceName: string | null
  /** Last error message */
  lastError: string | null
  /** Last render timing breakdown */
  lastRenderTiming: EditPipelineTiming | null
  /** Current processing backend */
  backend: 'webgpu' | 'wasm' | 'unknown'
}

// ============================================================================
// Store
// ============================================================================

export const useGpuStatusStore = defineStore('gpuStatus', () => {
  // ============================================================================
  // State
  // ============================================================================

  /** Whether GPU acceleration is available */
  const isAvailable = ref(false)

  /** Whether GPU initialization has completed */
  const isInitialized = ref(false)

  /** Whether GPU has encountered errors */
  const hasErrors = ref(false)

  /** GPU device name */
  const deviceName = ref<string | null>(null)

  /** Last error message */
  const lastError = ref<string | null>(null)

  /** Last render timing breakdown */
  const lastRenderTiming = ref<EditPipelineTiming | null>(null)

  /** Current processing backend */
  const backend = ref<'webgpu' | 'wasm' | 'unknown'>('unknown')

  // ============================================================================
  // Getters
  // ============================================================================

  /**
   * Icon name based on current GPU state.
   * - Error state: exclamation triangle (warning)
   * - Available: bolt (active)
   * - Unavailable: bolt slash (inactive)
   */
  const statusIcon = computed(() => {
    if (hasErrors.value) {
      return 'i-heroicons-exclamation-triangle'
    }
    if (isAvailable.value) {
      return 'i-heroicons-bolt'
    }
    return 'i-heroicons-bolt-slash'
  })

  /**
   * Color string based on current GPU state.
   * - Error state: warning (yellow)
   * - Available: success (green)
   * - Unavailable: neutral (gray)
   */
  const statusColor = computed(() => {
    if (hasErrors.value) {
      return 'warning'
    }
    if (isAvailable.value) {
      return 'success'
    }
    return 'neutral'
  })

  /**
   * Human-readable status text.
   */
  const statusText = computed(() => {
    if (hasErrors.value) {
      return 'GPU Error'
    }
    if (!isInitialized.value) {
      return 'Initializing...'
    }
    if (isAvailable.value) {
      return deviceName.value ? `GPU: ${deviceName.value}` : 'GPU Accelerated'
    }
    return 'GPU Unavailable'
  })

  /**
   * Total render time from the last pipeline execution.
   * Returns null if no timing data is available.
   */
  const totalRenderTime = computed(() => {
    return lastRenderTiming.value?.total ?? null
  })

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Set GPU availability status.
   *
   * @param available - Whether GPU is available
   * @param name - Optional GPU device name
   */
  function setAvailable(available: boolean, name?: string): void {
    isAvailable.value = available
    isInitialized.value = true
    backend.value = available ? 'webgpu' : 'wasm'
    if (name !== undefined) {
      deviceName.value = name
    }
  }

  /**
   * Set an error state with message.
   *
   * @param error - Error message to display
   */
  function setError(error: string): void {
    hasErrors.value = true
    lastError.value = error
  }

  /**
   * Clear the current error state.
   */
  function clearError(): void {
    hasErrors.value = false
    lastError.value = null
  }

  /**
   * Update render timing from the edit pipeline.
   *
   * @param timing - Timing breakdown from EditPipeline
   */
  function setRenderTiming(timing: EditPipelineTiming): void {
    lastRenderTiming.value = timing
  }

  return {
    // State
    isAvailable,
    isInitialized,
    hasErrors,
    deviceName,
    lastError,
    lastRenderTiming,
    backend,

    // Getters
    statusIcon,
    statusColor,
    statusText,
    totalRenderTime,

    // Actions
    setAvailable,
    setError,
    clearError,
    setRenderTiming,
  }
})
