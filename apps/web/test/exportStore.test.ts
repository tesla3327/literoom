/**
 * Unit tests for the export store.
 *
 * Tests export state management including:
 * - Initial state
 * - Modal visibility
 * - Destination management
 * - Export options
 * - Progress tracking
 * - Validation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  useExportStore,
  RESIZE_PRESETS,
  DEFAULT_FILENAME_TEMPLATE,
  DEFAULT_JPEG_QUALITY,
} from '~/stores/export'

// Mock FileSystemDirectoryHandle
function createMockDirectoryHandle(name: string): FileSystemDirectoryHandle {
  return {
    name,
    kind: 'directory',
    isSameEntry: vi.fn(),
    queryPermission: vi.fn(),
    requestPermission: vi.fn(),
    getDirectoryHandle: vi.fn(),
    getFileHandle: vi.fn(),
    removeEntry: vi.fn(),
    resolve: vi.fn(),
    keys: vi.fn(),
    values: vi.fn(),
    entries: vi.fn(),
    [Symbol.asyncIterator]: vi.fn(),
  } as unknown as FileSystemDirectoryHandle
}

describe('exportStore', () => {
  let store: ReturnType<typeof useExportStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useExportStore()
    vi.clearAllMocks()
  })

  // ============================================================================
  // Constants
  // ============================================================================

  describe('constants', () => {
    it('RESIZE_PRESETS has expected options', () => {
      expect(RESIZE_PRESETS).toHaveLength(4)
      expect(RESIZE_PRESETS[0]!.value).toBe(0)
      expect(RESIZE_PRESETS[0]!.label).toContain('Original')
    })

    it('DEFAULT_FILENAME_TEMPLATE includes required tokens', () => {
      expect(DEFAULT_FILENAME_TEMPLATE).toContain('{orig}')
      expect(DEFAULT_FILENAME_TEMPLATE).toContain('{seq')
    })

    it('DEFAULT_JPEG_QUALITY is 90 (Lightroom standard)', () => {
      expect(DEFAULT_JPEG_QUALITY).toBe(90)
    })
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('isModalOpen is false', () => {
      expect(store.isModalOpen).toBe(false)
    })

    it('destinationHandle is null', () => {
      expect(store.destinationHandle).toBeNull()
    })

    it('destinationName is empty', () => {
      expect(store.destinationName).toBe('')
    })

    it('filenameTemplate has default value', () => {
      expect(store.filenameTemplate).toBe(DEFAULT_FILENAME_TEMPLATE)
    })

    it('quality has default value', () => {
      expect(store.quality).toBe(DEFAULT_JPEG_QUALITY)
    })

    it('resizeLongEdge is 0 (no resize)', () => {
      expect(store.resizeLongEdge).toBe(0)
    })

    it('scope is picks by default', () => {
      expect(store.scope).toBe('picks')
    })

    it('includeRejected is false', () => {
      expect(store.includeRejected).toBe(false)
    })

    it('isExporting is false', () => {
      expect(store.isExporting).toBe(false)
    })

    it('progress is null', () => {
      expect(store.progress).toBeNull()
    })
  })

  // ============================================================================
  // Computed Properties
  // ============================================================================

  describe('isValid', () => {
    it('returns false when no destination', () => {
      expect(store.isValid).toBe(false)
    })

    it('returns false when template is empty', () => {
      store.setDestination(createMockDirectoryHandle('test'))
      store.filenameTemplate = ''
      expect(store.isValid).toBe(false)
    })

    it('returns false when template is whitespace only', () => {
      store.setDestination(createMockDirectoryHandle('test'))
      store.filenameTemplate = '   '
      expect(store.isValid).toBe(false)
    })

    it('returns true when destination and template are set', () => {
      store.setDestination(createMockDirectoryHandle('test'))
      store.filenameTemplate = '{orig}'
      expect(store.isValid).toBe(true)
    })
  })

  describe('progressPercent', () => {
    it('returns 0 when no progress', () => {
      expect(store.progressPercent).toBe(0)
    })

    it('returns 0 when total is 0', () => {
      store.setProgress({
        current: 0,
        total: 0,
        currentFilename: '',
        complete: false,
      })
      expect(store.progressPercent).toBe(0)
    })

    it('calculates percentage correctly', () => {
      store.setProgress({
        current: 5,
        total: 10,
        currentFilename: 'test.jpg',
        complete: false,
      })
      expect(store.progressPercent).toBe(50)
    })

    it('rounds to nearest integer', () => {
      store.setProgress({
        current: 1,
        total: 3,
        currentFilename: 'test.jpg',
        complete: false,
      })
      expect(store.progressPercent).toBe(33)
    })

    it('returns 100 when complete', () => {
      store.setProgress({
        current: 10,
        total: 10,
        currentFilename: 'test.jpg',
        complete: true,
      })
      expect(store.progressPercent).toBe(100)
    })
  })

  // ============================================================================
  // Modal Actions
  // ============================================================================

  describe('openModal', () => {
    it('sets isModalOpen to true', () => {
      store.openModal()
      expect(store.isModalOpen).toBe(true)
    })
  })

  describe('closeModal', () => {
    it('sets isModalOpen to false', () => {
      store.isModalOpen = true
      store.closeModal()
      expect(store.isModalOpen).toBe(false)
    })
  })

  // ============================================================================
  // Destination Actions
  // ============================================================================

  describe('setDestination', () => {
    it('sets destination handle and name', () => {
      const handle = createMockDirectoryHandle('MyPhotos')
      store.setDestination(handle)

      // Handle is stored (compare by name since it's a mock and refs may differ)
      expect(store.destinationHandle?.name).toBe('MyPhotos')
      expect(store.destinationName).toBe('MyPhotos')
    })
  })

  describe('clearDestination', () => {
    it('clears destination handle and name', () => {
      store.setDestination(createMockDirectoryHandle('test'))
      store.clearDestination()

      expect(store.destinationHandle).toBeNull()
      expect(store.destinationName).toBe('')
    })
  })

  // ============================================================================
  // Progress Actions
  // ============================================================================

  describe('setProgress', () => {
    it('sets progress and isExporting to true when in progress', () => {
      const progress = {
        current: 5,
        total: 10,
        currentFilename: 'test.jpg',
        complete: false,
      }

      store.setProgress(progress)

      expect(store.progress).toEqual(progress)
      expect(store.isExporting).toBe(true)
    })

    it('sets isExporting to false when complete', () => {
      const progress = {
        current: 10,
        total: 10,
        currentFilename: 'test.jpg',
        complete: true,
      }

      store.setProgress(progress)

      expect(store.progress).toEqual(progress)
      expect(store.isExporting).toBe(false)
    })

    it('clears progress when null', () => {
      store.setProgress({
        current: 5,
        total: 10,
        currentFilename: 'test.jpg',
        complete: false,
      })

      store.setProgress(null)

      expect(store.progress).toBeNull()
      expect(store.isExporting).toBe(false)
    })
  })

  // ============================================================================
  // Reset Action
  // ============================================================================

  describe('reset', () => {
    it('resets all state to defaults', () => {
      // Set non-default values
      store.setDestination(createMockDirectoryHandle('test'))
      store.filenameTemplate = 'custom_{seq:3}'
      store.quality = 75
      store.resizeLongEdge = 2048
      store.scope = 'all'
      store.includeRejected = true
      store.setProgress({
        current: 5,
        total: 10,
        currentFilename: 'test.jpg',
        complete: false,
      })

      // Reset
      store.reset()

      // Verify all values are reset
      expect(store.destinationHandle).toBeNull()
      expect(store.destinationName).toBe('')
      expect(store.filenameTemplate).toBe(DEFAULT_FILENAME_TEMPLATE)
      expect(store.quality).toBe(DEFAULT_JPEG_QUALITY)
      expect(store.resizeLongEdge).toBe(0)
      expect(store.scope).toBe('picks')
      expect(store.includeRejected).toBe(false)
      expect(store.progress).toBeNull()
      expect(store.isExporting).toBe(false)
    })
  })

  // ============================================================================
  // Scope Options
  // ============================================================================

  describe('scope', () => {
    it('can be set to picks', () => {
      store.scope = 'picks'
      expect(store.scope).toBe('picks')
    })

    it('can be set to selected', () => {
      store.scope = 'selected'
      expect(store.scope).toBe('selected')
    })

    it('can be set to all', () => {
      store.scope = 'all'
      expect(store.scope).toBe('all')
    })
  })

  // ============================================================================
  // Export Options
  // ============================================================================

  describe('quality', () => {
    it('can be set to minimum value', () => {
      store.quality = 1
      expect(store.quality).toBe(1)
    })

    it('can be set to maximum value', () => {
      store.quality = 100
      expect(store.quality).toBe(100)
    })

    it('can be set to any value in range', () => {
      store.quality = 50
      expect(store.quality).toBe(50)
    })
  })

  describe('resizeLongEdge', () => {
    it('can be set to 0 (no resize)', () => {
      store.resizeLongEdge = 0
      expect(store.resizeLongEdge).toBe(0)
    })

    it('can be set to a preset value', () => {
      store.resizeLongEdge = 2048
      expect(store.resizeLongEdge).toBe(2048)
    })

    it('can be set to a custom value', () => {
      store.resizeLongEdge = 1920
      expect(store.resizeLongEdge).toBe(1920)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles rapid progress updates', () => {
      for (let i = 0; i <= 100; i++) {
        store.setProgress({
          current: i,
          total: 100,
          currentFilename: `image_${i}.jpg`,
          complete: i === 100,
        })
      }

      expect(store.progress?.current).toBe(100)
      expect(store.isExporting).toBe(false)
    })

    it('handles template with special characters', () => {
      store.filenameTemplate = '{orig}_test-file (2024)'
      expect(store.filenameTemplate).toBe('{orig}_test-file (2024)')
    })

    it('maintains state independence across multiple instances', () => {
      const store1 = useExportStore()
      const store2 = useExportStore()

      store1.quality = 50
      expect(store2.quality).toBe(50) // Same store instance in Pinia

      // But after reset, both should be affected
      store1.reset()
      expect(store2.quality).toBe(DEFAULT_JPEG_QUALITY)
    })
  })
})
