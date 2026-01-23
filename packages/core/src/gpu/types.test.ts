/**
 * Unit tests for GPU types.
 *
 * Tests type definitions, constants, and the GPUError class.
 */

import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GPU_CAPABILITIES,
  DEFAULT_GPU_INIT_OPTIONS,
  GPUError,
  type ProcessingBackend,
  type GPUOperation,
  type GPUErrorCode,
} from './types'

// ============================================================================
// DEFAULT_GPU_CAPABILITIES Tests
// ============================================================================

describe('DEFAULT_GPU_CAPABILITIES', () => {
  it('has available set to false', () => {
    expect(DEFAULT_GPU_CAPABILITIES.available).toBe(false)
  })

  it('has backend set to wasm', () => {
    expect(DEFAULT_GPU_CAPABILITIES.backend).toBe('wasm')
  })

  it('has isFallbackAdapter set to false', () => {
    expect(DEFAULT_GPU_CAPABILITIES.isFallbackAdapter).toBe(false)
  })

  it('has zero limits', () => {
    expect(DEFAULT_GPU_CAPABILITIES.limits.maxTextureSize).toBe(0)
    expect(DEFAULT_GPU_CAPABILITIES.limits.maxBufferSize).toBe(0)
    expect(DEFAULT_GPU_CAPABILITIES.limits.maxComputeWorkgroupSize).toBe(0)
    expect(DEFAULT_GPU_CAPABILITIES.limits.maxComputeWorkgroupsPerDimension).toBe(0)
  })

  it('has all features disabled', () => {
    expect(DEFAULT_GPU_CAPABILITIES.features.float32Filtering).toBe(false)
    expect(DEFAULT_GPU_CAPABILITIES.features.textureCompressionBC).toBe(false)
  })

  it('does not have adapterInfo', () => {
    expect(DEFAULT_GPU_CAPABILITIES.adapterInfo).toBeUndefined()
  })
})

// ============================================================================
// DEFAULT_GPU_INIT_OPTIONS Tests
// ============================================================================

describe('DEFAULT_GPU_INIT_OPTIONS', () => {
  it('prefers high performance by default', () => {
    expect(DEFAULT_GPU_INIT_OPTIONS.preferHighPerformance).toBe(true)
  })

  it('does not allow fallback adapter by default', () => {
    expect(DEFAULT_GPU_INIT_OPTIONS.allowFallbackAdapter).toBe(false)
  })

  it('is not force disabled by default', () => {
    expect(DEFAULT_GPU_INIT_OPTIONS.forceDisabled).toBe(false)
  })
})

// ============================================================================
// GPUError Tests
// ============================================================================

describe('GPUError', () => {
  it('creates error with message and code', () => {
    const error = new GPUError('Test error message', 'ADAPTER_NOT_FOUND')

    expect(error.message).toBe('Test error message')
    expect(error.code).toBe('ADAPTER_NOT_FOUND')
    expect(error.name).toBe('GPUError')
  })

  it('includes cause when provided', () => {
    const cause = new Error('Original error')
    const error = new GPUError('Wrapper error', 'INTERNAL_ERROR', cause)

    expect(error.cause).toBe(cause)
  })

  it('is instance of Error', () => {
    const error = new GPUError('Test', 'NOT_SUPPORTED')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(GPUError)
  })

  it('supports all error codes', () => {
    const errorCodes: GPUErrorCode[] = [
      'NOT_SUPPORTED',
      'ADAPTER_NOT_FOUND',
      'DEVICE_CREATION_FAILED',
      'DEVICE_LOST',
      'OUT_OF_MEMORY',
      'VALIDATION_ERROR',
      'INTERNAL_ERROR',
      'DISABLED',
    ]

    for (const code of errorCodes) {
      const error = new GPUError(`Error: ${code}`, code)
      expect(error.code).toBe(code)
    }
  })

  it('has correct stack trace', () => {
    const error = new GPUError('Test error', 'INTERNAL_ERROR')

    expect(error.stack).toBeDefined()
    expect(error.stack).toContain('GPUError')
  })
})

// ============================================================================
// Type Guard Tests
// ============================================================================

describe('type validation', () => {
  it('ProcessingBackend accepts valid values', () => {
    const backends: ProcessingBackend[] = ['webgpu', 'wasm']

    expect(backends).toContain('webgpu')
    expect(backends).toContain('wasm')
    expect(backends).toHaveLength(2)
  })

  it('GPUOperation accepts valid values', () => {
    const operations: GPUOperation[] = [
      'adjustments',
      'toneCurve',
      'linearMask',
      'radialMask',
      'histogram',
      'resize',
      'rotation',
      'clipping',
    ]

    expect(operations).toHaveLength(8)
  })
})

// ============================================================================
// Immutability Tests
// ============================================================================

describe('constant immutability', () => {
  it('DEFAULT_GPU_CAPABILITIES should not be mutated', () => {
    // Create a copy before test
    const originalAvailable = DEFAULT_GPU_CAPABILITIES.available
    const originalBackend = DEFAULT_GPU_CAPABILITIES.backend

    // Attempt to read (not mutate)
    expect(DEFAULT_GPU_CAPABILITIES.available).toBe(originalAvailable)
    expect(DEFAULT_GPU_CAPABILITIES.backend).toBe(originalBackend)
  })

  it('DEFAULT_GPU_INIT_OPTIONS should not be mutated', () => {
    const originalPreference = DEFAULT_GPU_INIT_OPTIONS.preferHighPerformance

    expect(DEFAULT_GPU_INIT_OPTIONS.preferHighPerformance).toBe(originalPreference)
  })
})
