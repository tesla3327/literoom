/**
 * Unit tests for the edit clipboard store.
 *
 * Tests clipboard state management for copy/paste settings including:
 * - Initial state
 * - Copy modal visibility
 * - Group selection (toggle, select all/none)
 * - Copied settings storage
 * - Computed properties
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import {
  useEditClipboardStore,
  DEFAULT_COPY_GROUPS,
  type CopiedSettings,
} from '~/stores/editClipboard'

describe('editClipboardStore', () => {
  let store: ReturnType<typeof useEditClipboardStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useEditClipboardStore()
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('has null copiedSettings', () => {
      expect(store.copiedSettings).toBeNull()
    })

    it('has closed copy modal', () => {
      expect(store.showCopyModal).toBe(false)
    })

    it('has default selected groups', () => {
      expect(store.selectedGroups).toEqual(DEFAULT_COPY_GROUPS)
    })

    it('hasClipboardContent is false', () => {
      expect(store.hasClipboardContent).toBe(false)
    })

    it('sourceAssetId is null', () => {
      expect(store.sourceAssetId).toBeNull()
    })

    it('copyTimestamp is null', () => {
      expect(store.copyTimestamp).toBeNull()
    })

    it('clipboardSummary is null', () => {
      expect(store.clipboardSummary).toBeNull()
    })

    it('hasSelectedGroups is true (defaults have selections)', () => {
      expect(store.hasSelectedGroups).toBe(true)
    })
  })

  // ============================================================================
  // Default Copy Groups
  // ============================================================================

  describe('DEFAULT_COPY_GROUPS', () => {
    it('includes basic adjustments by default', () => {
      expect(DEFAULT_COPY_GROUPS.basicAdjustments).toBe(true)
    })

    it('includes tone curve by default', () => {
      expect(DEFAULT_COPY_GROUPS.toneCurve).toBe(true)
    })

    it('excludes crop by default (safety)', () => {
      expect(DEFAULT_COPY_GROUPS.crop).toBe(false)
    })

    it('excludes rotation by default (safety)', () => {
      expect(DEFAULT_COPY_GROUPS.rotation).toBe(false)
    })

    it('is immutable', () => {
      expect(Object.isFrozen(DEFAULT_COPY_GROUPS)).toBe(true)
    })
  })

  // ============================================================================
  // Copy Modal
  // ============================================================================

  describe('copy modal', () => {
    it('opens the copy modal', () => {
      store.openCopyModal()
      expect(store.showCopyModal).toBe(true)
    })

    it('closes the copy modal', () => {
      store.openCopyModal()
      store.closeCopyModal()
      expect(store.showCopyModal).toBe(false)
    })
  })

  // ============================================================================
  // Group Selection
  // ============================================================================

  describe('group selection', () => {
    describe('toggleGroup', () => {
      it('toggles basicAdjustments off', () => {
        store.toggleGroup('basicAdjustments')
        expect(store.selectedGroups.basicAdjustments).toBe(false)
      })

      it('toggles crop on', () => {
        store.toggleGroup('crop')
        expect(store.selectedGroups.crop).toBe(true)
      })

      it('toggles back and forth', () => {
        store.toggleGroup('toneCurve')
        expect(store.selectedGroups.toneCurve).toBe(false)
        store.toggleGroup('toneCurve')
        expect(store.selectedGroups.toneCurve).toBe(true)
      })
    })

    describe('setGroup', () => {
      it('sets a group to true', () => {
        store.setGroup('crop', true)
        expect(store.selectedGroups.crop).toBe(true)
      })

      it('sets a group to false', () => {
        store.setGroup('basicAdjustments', false)
        expect(store.selectedGroups.basicAdjustments).toBe(false)
      })
    })

    describe('selectAll', () => {
      it('selects all groups', () => {
        store.selectAll()
        expect(store.selectedGroups.basicAdjustments).toBe(true)
        expect(store.selectedGroups.toneCurve).toBe(true)
        expect(store.selectedGroups.crop).toBe(true)
        expect(store.selectedGroups.rotation).toBe(true)
      })
    })

    describe('selectNone', () => {
      it('deselects all groups', () => {
        store.selectNone()
        expect(store.selectedGroups.basicAdjustments).toBe(false)
        expect(store.selectedGroups.toneCurve).toBe(false)
        expect(store.selectedGroups.crop).toBe(false)
        expect(store.selectedGroups.rotation).toBe(false)
      })

      it('hasSelectedGroups becomes false', () => {
        store.selectNone()
        expect(store.hasSelectedGroups).toBe(false)
      })
    })

    describe('resetGroups', () => {
      it('resets to default groups', () => {
        store.selectAll()
        store.resetGroups()
        expect(store.selectedGroups).toEqual(DEFAULT_COPY_GROUPS)
      })

      it('resets after selectNone', () => {
        store.selectNone()
        store.resetGroups()
        expect(store.selectedGroups).toEqual(DEFAULT_COPY_GROUPS)
      })
    })
  })

  // ============================================================================
  // Copied Settings
  // ============================================================================

  describe('copied settings', () => {
    const mockSettings: CopiedSettings = {
      type: 'literoom-settings',
      version: 1,
      timestamp: Date.now(),
      sourceAssetId: 'test-asset-123',
      groups: {
        basicAdjustments: true,
        toneCurve: true,
        crop: false,
        rotation: false,
      },
      data: {
        adjustments: {
          exposure: 0.5,
          contrast: 10,
        },
        toneCurve: {
          points: [
            { x: 0, y: 0 },
            { x: 1, y: 1 },
          ],
        },
      },
    }

    describe('setCopiedSettings', () => {
      it('stores copied settings', () => {
        store.setCopiedSettings(mockSettings)
        expect(store.copiedSettings).toEqual(mockSettings)
      })

      it('hasClipboardContent becomes true', () => {
        store.setCopiedSettings(mockSettings)
        expect(store.hasClipboardContent).toBe(true)
      })

      it('sourceAssetId is set', () => {
        store.setCopiedSettings(mockSettings)
        expect(store.sourceAssetId).toBe('test-asset-123')
      })

      it('copyTimestamp is set', () => {
        store.setCopiedSettings(mockSettings)
        expect(store.copyTimestamp).toBe(mockSettings.timestamp)
      })
    })

    describe('clear', () => {
      it('clears copied settings', () => {
        store.setCopiedSettings(mockSettings)
        store.clear()
        expect(store.copiedSettings).toBeNull()
      })

      it('hasClipboardContent becomes false', () => {
        store.setCopiedSettings(mockSettings)
        store.clear()
        expect(store.hasClipboardContent).toBe(false)
      })
    })
  })

  // ============================================================================
  // Clipboard Summary
  // ============================================================================

  describe('clipboardSummary', () => {
    it('shows "Basic Adjustments, Tone Curve" for default groups', () => {
      const settings: CopiedSettings = {
        type: 'literoom-settings',
        version: 1,
        timestamp: Date.now(),
        sourceAssetId: 'test-asset',
        groups: {
          basicAdjustments: true,
          toneCurve: true,
          crop: false,
          rotation: false,
        },
        data: {},
      }
      store.setCopiedSettings(settings)
      expect(store.clipboardSummary).toBe('Basic Adjustments, Tone Curve')
    })

    it('shows all groups when all selected', () => {
      const settings: CopiedSettings = {
        type: 'literoom-settings',
        version: 1,
        timestamp: Date.now(),
        sourceAssetId: 'test-asset',
        groups: {
          basicAdjustments: true,
          toneCurve: true,
          crop: true,
          rotation: true,
        },
        data: {},
      }
      store.setCopiedSettings(settings)
      expect(store.clipboardSummary).toBe('Basic Adjustments, Tone Curve, Crop, Rotation')
    })

    it('shows "Nothing" when no groups selected', () => {
      const settings: CopiedSettings = {
        type: 'literoom-settings',
        version: 1,
        timestamp: Date.now(),
        sourceAssetId: 'test-asset',
        groups: {
          basicAdjustments: false,
          toneCurve: false,
          crop: false,
          rotation: false,
        },
        data: {},
      }
      store.setCopiedSettings(settings)
      expect(store.clipboardSummary).toBe('Nothing')
    })

    it('shows only selected groups', () => {
      const settings: CopiedSettings = {
        type: 'literoom-settings',
        version: 1,
        timestamp: Date.now(),
        sourceAssetId: 'test-asset',
        groups: {
          basicAdjustments: false,
          toneCurve: false,
          crop: true,
          rotation: true,
        },
        data: {},
      }
      store.setCopiedSettings(settings)
      expect(store.clipboardSummary).toBe('Crop, Rotation')
    })
  })

  // ============================================================================
  // hasSelectedGroups Computed
  // ============================================================================

  describe('hasSelectedGroups', () => {
    it('is true when only basicAdjustments selected', () => {
      store.selectNone()
      store.setGroup('basicAdjustments', true)
      expect(store.hasSelectedGroups).toBe(true)
    })

    it('is true when only toneCurve selected', () => {
      store.selectNone()
      store.setGroup('toneCurve', true)
      expect(store.hasSelectedGroups).toBe(true)
    })

    it('is true when only crop selected', () => {
      store.selectNone()
      store.setGroup('crop', true)
      expect(store.hasSelectedGroups).toBe(true)
    })

    it('is true when only rotation selected', () => {
      store.selectNone()
      store.setGroup('rotation', true)
      expect(store.hasSelectedGroups).toBe(true)
    })

    it('is false when nothing selected', () => {
      store.selectNone()
      expect(store.hasSelectedGroups).toBe(false)
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles multiple setCopiedSettings calls', () => {
      const settings1: CopiedSettings = {
        type: 'literoom-settings',
        version: 1,
        timestamp: 1000,
        sourceAssetId: 'asset-1',
        groups: DEFAULT_COPY_GROUPS,
        data: {},
      }
      const settings2: CopiedSettings = {
        type: 'literoom-settings',
        version: 1,
        timestamp: 2000,
        sourceAssetId: 'asset-2',
        groups: DEFAULT_COPY_GROUPS,
        data: {},
      }

      store.setCopiedSettings(settings1)
      expect(store.sourceAssetId).toBe('asset-1')

      store.setCopiedSettings(settings2)
      expect(store.sourceAssetId).toBe('asset-2')
    })

    it('group toggles are independent', () => {
      store.toggleGroup('crop')
      store.toggleGroup('rotation')

      expect(store.selectedGroups.crop).toBe(true)
      expect(store.selectedGroups.rotation).toBe(true)
      expect(store.selectedGroups.basicAdjustments).toBe(true) // unchanged
      expect(store.selectedGroups.toneCurve).toBe(true) // unchanged
    })
  })
})
