/**
 * Unit tests for the copy/paste settings patterns.
 *
 * Tests the logic used in copy/paste settings including:
 * - CopiedSettings structure
 * - Group selection
 * - Settings application
 *
 * NOTE: Full composable integration tests with Nuxt are done in E2E tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, reactive, computed } from 'vue'

// ============================================================================
// Types (matching the actual store types)
// ============================================================================

interface CopyGroups {
  basicAdjustments: boolean
  toneCurve: boolean
  crop: boolean
  rotation: boolean
}

interface CopiedSettings {
  type: 'literoom-settings'
  version: number
  timestamp: number
  sourceAssetId: string
  groups: CopyGroups
  data: {
    adjustments?: Record<string, number>
    toneCurve?: { points: Array<{ x: number, y: number }> }
    crop?: { x: number, y: number, width: number, height: number } | null
    rotation?: { angle: number, straighten: number, flipHorizontal: boolean, flipVertical: boolean }
  }
}

describe('useCopyPasteSettings patterns', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ============================================================================
  // CopyGroups Selection
  // ============================================================================

  describe('CopyGroups selection', () => {
    it('default groups are selected', () => {
      const selectedGroups: CopyGroups = reactive({
        basicAdjustments: true,
        toneCurve: true,
        crop: true,
        rotation: true,
      })

      expect(selectedGroups.basicAdjustments).toBe(true)
      expect(selectedGroups.toneCurve).toBe(true)
      expect(selectedGroups.crop).toBe(true)
      expect(selectedGroups.rotation).toBe(true)
    })

    it('toggleGroup toggles a single group', () => {
      const selectedGroups: CopyGroups = reactive({
        basicAdjustments: true,
        toneCurve: true,
        crop: true,
        rotation: true,
      })

      function toggleGroup(group: keyof CopyGroups) {
        selectedGroups[group] = !selectedGroups[group]
      }

      expect(selectedGroups.basicAdjustments).toBe(true)
      toggleGroup('basicAdjustments')
      expect(selectedGroups.basicAdjustments).toBe(false)
      toggleGroup('basicAdjustments')
      expect(selectedGroups.basicAdjustments).toBe(true)
    })

    it('selectAll selects all groups', () => {
      const selectedGroups: CopyGroups = reactive({
        basicAdjustments: false,
        toneCurve: false,
        crop: false,
        rotation: false,
      })

      function selectAll() {
        selectedGroups.basicAdjustments = true
        selectedGroups.toneCurve = true
        selectedGroups.crop = true
        selectedGroups.rotation = true
      }

      selectAll()

      expect(selectedGroups.basicAdjustments).toBe(true)
      expect(selectedGroups.toneCurve).toBe(true)
      expect(selectedGroups.crop).toBe(true)
      expect(selectedGroups.rotation).toBe(true)
    })

    it('selectNone deselects all groups', () => {
      const selectedGroups: CopyGroups = reactive({
        basicAdjustments: true,
        toneCurve: true,
        crop: true,
        rotation: true,
      })

      function selectNone() {
        selectedGroups.basicAdjustments = false
        selectedGroups.toneCurve = false
        selectedGroups.crop = false
        selectedGroups.rotation = false
      }

      selectNone()

      expect(selectedGroups.basicAdjustments).toBe(false)
      expect(selectedGroups.toneCurve).toBe(false)
      expect(selectedGroups.crop).toBe(false)
      expect(selectedGroups.rotation).toBe(false)
    })

    it('hasSelectedGroups computed works correctly', () => {
      const selectedGroups: CopyGroups = reactive({
        basicAdjustments: false,
        toneCurve: false,
        crop: false,
        rotation: false,
      })

      const hasSelectedGroups = computed(() =>
        selectedGroups.basicAdjustments
        || selectedGroups.toneCurve
        || selectedGroups.crop
        || selectedGroups.rotation,
      )

      expect(hasSelectedGroups.value).toBe(false)

      selectedGroups.basicAdjustments = true
      expect(hasSelectedGroups.value).toBe(true)
    })
  })

  // ============================================================================
  // CopiedSettings Structure
  // ============================================================================

  describe('CopiedSettings structure', () => {
    it('creates correct settings structure', () => {
      const settings: CopiedSettings = {
        type: 'literoom-settings',
        version: 1,
        timestamp: Date.now(),
        sourceAssetId: 'asset-1',
        groups: {
          basicAdjustments: true,
          toneCurve: true,
          crop: false,
          rotation: false,
        },
        data: {
          adjustments: { exposure: 1.5, contrast: 10 },
          toneCurve: { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        },
      }

      expect(settings.type).toBe('literoom-settings')
      expect(settings.version).toBe(1)
      expect(settings.sourceAssetId).toBe('asset-1')
      expect(settings.data.adjustments?.exposure).toBe(1.5)
    })

    it('includes only selected groups in data', () => {
      const selectedGroups: CopyGroups = {
        basicAdjustments: true,
        toneCurve: false,
        crop: true,
        rotation: false,
      }

      const adjustments = { exposure: 1.0, contrast: 5 }
      const crop = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 }
      const toneCurve = { points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
      const rotation = { angle: 90, straighten: 0, flipHorizontal: false, flipVertical: false }

      const data: CopiedSettings['data'] = {}

      if (selectedGroups.basicAdjustments) {
        data.adjustments = { ...adjustments }
      }
      if (selectedGroups.toneCurve) {
        data.toneCurve = toneCurve
      }
      if (selectedGroups.crop) {
        data.crop = crop
      }
      if (selectedGroups.rotation) {
        data.rotation = rotation
      }

      expect(data.adjustments).toBeDefined()
      expect(data.toneCurve).toBeUndefined()
      expect(data.crop).toBeDefined()
      expect(data.rotation).toBeUndefined()
    })
  })

  // ============================================================================
  // Clipboard State
  // ============================================================================

  describe('clipboard state', () => {
    it('canPaste is false when clipboard is empty', () => {
      const copiedSettings = ref<CopiedSettings | null>(null)
      const canPaste = computed(() => copiedSettings.value !== null)

      expect(canPaste.value).toBe(false)
    })

    it('canPaste is true when clipboard has content', () => {
      const copiedSettings = ref<CopiedSettings | null>(null)
      const canPaste = computed(() => copiedSettings.value !== null)

      copiedSettings.value = {
        type: 'literoom-settings',
        version: 1,
        timestamp: Date.now(),
        sourceAssetId: 'asset-1',
        groups: { basicAdjustments: true, toneCurve: false, crop: false, rotation: false },
        data: { adjustments: { exposure: 1.0 } },
      }

      expect(canPaste.value).toBe(true)
    })

    it('clear empties the clipboard', () => {
      const copiedSettings = ref<CopiedSettings | null>({
        type: 'literoom-settings',
        version: 1,
        timestamp: Date.now(),
        sourceAssetId: 'asset-1',
        groups: { basicAdjustments: true, toneCurve: false, crop: false, rotation: false },
        data: {},
      })

      copiedSettings.value = null

      expect(copiedSettings.value).toBeNull()
    })
  })

  // ============================================================================
  // Copy Modal State
  // ============================================================================

  describe('copy modal state', () => {
    it('showCopyModal tracks modal visibility', () => {
      const showCopyModal = ref(false)

      expect(showCopyModal.value).toBe(false)

      showCopyModal.value = true
      expect(showCopyModal.value).toBe(true)

      showCopyModal.value = false
      expect(showCopyModal.value).toBe(false)
    })
  })

  // ============================================================================
  // Clipboard Summary
  // ============================================================================

  describe('clipboard summary', () => {
    it('generates summary from copied settings', () => {
      const copiedSettings = ref<CopiedSettings | null>({
        type: 'literoom-settings',
        version: 1,
        timestamp: Date.now(),
        sourceAssetId: 'asset-1',
        groups: { basicAdjustments: true, toneCurve: true, crop: false, rotation: false },
        data: { adjustments: { exposure: 1.0 } },
      })

      const clipboardSummary = computed(() => {
        if (!copiedSettings.value) return null

        const groups = copiedSettings.value.groups
        const parts: string[] = []

        if (groups.basicAdjustments) parts.push('Basic')
        if (groups.toneCurve) parts.push('Curve')
        if (groups.crop) parts.push('Crop')
        if (groups.rotation) parts.push('Rotation')

        return parts.join(', ')
      })

      expect(clipboardSummary.value).toBe('Basic, Curve')
    })

    it('returns null for empty clipboard', () => {
      const copiedSettings = ref<CopiedSettings | null>(null)

      const clipboardSummary = computed(() => {
        if (!copiedSettings.value) return null
        return 'Settings copied'
      })

      expect(clipboardSummary.value).toBeNull()
    })
  })

  // ============================================================================
  // Settings Application
  // ============================================================================

  describe('settings application', () => {
    it('applies adjustments correctly', () => {
      const currentAdjustments = reactive({
        exposure: 0,
        contrast: 0,
        highlights: 0,
      })

      const settingsToApply = {
        exposure: 1.5,
        contrast: 20,
      }

      Object.assign(currentAdjustments, settingsToApply)

      expect(currentAdjustments.exposure).toBe(1.5)
      expect(currentAdjustments.contrast).toBe(20)
      expect(currentAdjustments.highlights).toBe(0) // Not in settings, unchanged
    })

    it('applies tone curve correctly', () => {
      const currentCurve = reactive({
        points: [{ x: 0, y: 0 }, { x: 1, y: 1 }],
      })

      const settingsToApply = {
        points: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.6 }, { x: 1, y: 0.9 }],
      }

      // Deep clone to avoid reference issues
      currentCurve.points = settingsToApply.points.map(p => ({ x: p.x, y: p.y }))

      expect(currentCurve.points).toHaveLength(3)
      expect(currentCurve.points[1].y).toBe(0.6)
    })

    it('applies crop correctly', () => {
      const currentCrop = ref<{ x: number, y: number, width: number, height: number } | null>(null)

      const settingsToApply = { x: 0.2, y: 0.2, width: 0.6, height: 0.6 }

      currentCrop.value = { ...settingsToApply }

      expect(currentCrop.value).toEqual(settingsToApply)
    })

    it('applies null crop correctly', () => {
      const currentCrop = ref<{ x: number, y: number, width: number, height: number } | null>({
        x: 0.1, y: 0.1, width: 0.8, height: 0.8,
      })

      const settingsToApply: null = null

      currentCrop.value = settingsToApply

      expect(currentCrop.value).toBeNull()
    })

    it('applies rotation correctly', () => {
      const currentRotation = reactive({
        angle: 0,
        straighten: 0,
        flipHorizontal: false,
        flipVertical: false,
      })

      const settingsToApply = {
        angle: 90,
        straighten: 5,
        flipHorizontal: true,
        flipVertical: false,
      }

      Object.assign(currentRotation, settingsToApply)

      expect(currentRotation.angle).toBe(90)
      expect(currentRotation.straighten).toBe(5)
      expect(currentRotation.flipHorizontal).toBe(true)
    })
  })

  // ============================================================================
  // Target Selection
  // ============================================================================

  describe('target selection', () => {
    it('uses provided targetIds when available', () => {
      const selectedIds = new Set(['asset-2', 'asset-3'])
      const currentId = 'asset-1'
      const providedTargets = ['asset-4', 'asset-5']

      let targets: string[]
      if (providedTargets && providedTargets.length > 0) {
        targets = providedTargets
      }
      else if (selectedIds.size > 0) {
        targets = [...selectedIds]
      }
      else if (currentId) {
        targets = [currentId]
      }
      else {
        targets = []
      }

      expect(targets).toEqual(['asset-4', 'asset-5'])
    })

    it('falls back to selected assets', () => {
      const selectedIds = new Set(['asset-2', 'asset-3'])
      const currentId = 'asset-1'
      const providedTargets: string[] = []

      let targets: string[]
      if (providedTargets && providedTargets.length > 0) {
        targets = providedTargets
      }
      else if (selectedIds.size > 0) {
        targets = [...selectedIds]
      }
      else if (currentId) {
        targets = [currentId]
      }
      else {
        targets = []
      }

      expect(targets).toContain('asset-2')
      expect(targets).toContain('asset-3')
    })

    it('falls back to current asset', () => {
      const selectedIds = new Set<string>()
      const currentId = 'asset-1'
      const providedTargets: string[] = []

      let targets: string[]
      if (providedTargets && providedTargets.length > 0) {
        targets = providedTargets
      }
      else if (selectedIds.size > 0) {
        targets = [...selectedIds]
      }
      else if (currentId) {
        targets = [currentId]
      }
      else {
        targets = []
      }

      expect(targets).toEqual(['asset-1'])
    })

    it('returns empty when no targets available', () => {
      const selectedIds = new Set<string>()
      const currentId: string | null = null
      const providedTargets: string[] = []

      let targets: string[]
      if (providedTargets && providedTargets.length > 0) {
        targets = providedTargets
      }
      else if (selectedIds.size > 0) {
        targets = [...selectedIds]
      }
      else if (currentId) {
        targets = [currentId]
      }
      else {
        targets = []
      }

      expect(targets).toEqual([])
    })
  })
})
