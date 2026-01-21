import { describe, expect, it } from 'vitest'
import { DecodeError, filterToNumber } from './types'
import type { ErrorCode, FilterType } from './types'

describe('DecodeError', () => {
  it('creates error with message and code', () => {
    const error = new DecodeError('Test error', 'INVALID_FORMAT')

    expect(error.message).toBe('Test error')
    expect(error.code).toBe('INVALID_FORMAT')
    expect(error.name).toBe('DecodeError')
    expect(error.cause).toBeUndefined()
  })

  it('creates error with cause', () => {
    const cause = new Error('Original error')
    const error = new DecodeError('Wrapped error', 'CORRUPTED_FILE', cause)

    expect(error.message).toBe('Wrapped error')
    expect(error.code).toBe('CORRUPTED_FILE')
    expect(error.cause).toBe(cause)
  })

  it('extends Error', () => {
    const error = new DecodeError('Test', 'UNKNOWN')

    expect(error).toBeInstanceOf(Error)
    expect(error).toBeInstanceOf(DecodeError)
  })

  it('supports all error codes', () => {
    const codes: ErrorCode[] = [
      'INVALID_FORMAT',
      'UNSUPPORTED_FILE_TYPE',
      'CORRUPTED_FILE',
      'OUT_OF_MEMORY',
      'WORKER_ERROR',
      'WASM_INIT_FAILED',
      'TIMEOUT',
      'UNKNOWN'
    ]

    for (const code of codes) {
      const error = new DecodeError(`Error: ${code}`, code)
      expect(error.code).toBe(code)
    }
  })
})

describe('filterToNumber', () => {
  it('converts nearest to 0', () => {
    expect(filterToNumber('nearest')).toBe(0)
  })

  it('converts bilinear to 1', () => {
    expect(filterToNumber('bilinear')).toBe(1)
  })

  it('converts lanczos3 to 2', () => {
    expect(filterToNumber('lanczos3')).toBe(2)
  })

  it('defaults to lanczos3 (2) for undefined', () => {
    expect(filterToNumber(undefined)).toBe(2)
  })

  it('handles all FilterType values', () => {
    const filters: FilterType[] = ['nearest', 'bilinear', 'lanczos3']
    const expected = [0, 1, 2]

    filters.forEach((filter, i) => {
      expect(filterToNumber(filter)).toBe(expected[i])
    })
  })
})
