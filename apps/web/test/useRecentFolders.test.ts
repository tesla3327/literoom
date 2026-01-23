/**
 * Unit tests for the useRecentFolders composable patterns.
 *
 * Tests the logic and patterns used in the composable:
 * - State management
 * - Computed properties
 * - Demo mode behavior
 * - Error handling patterns
 *
 * NOTE: Full integration tests with Nuxt's plugin system are done in E2E tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { ref, computed } from 'vue'

describe('useRecentFolders patterns', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  // ============================================================================
  // State Management Patterns
  // ============================================================================

  describe('state management patterns', () => {
    it('recentFolders ref pattern works correctly', () => {
      const recentFolders = ref<{ id: number, name: string }[]>([])

      expect(recentFolders.value).toEqual([])

      recentFolders.value = [
        { id: 1, name: 'Photos' },
        { id: 2, name: 'Vacation' },
      ]

      expect(recentFolders.value).toHaveLength(2)
    })

    it('hasRecentFolders computed pattern works', () => {
      const recentFolders = ref<{ id: number, name: string }[]>([])
      const hasRecentFolders = computed(() => recentFolders.value.length > 0)

      expect(hasRecentFolders.value).toBe(false)

      recentFolders.value = [{ id: 1, name: 'Test' }]

      expect(hasRecentFolders.value).toBe(true)
    })

    it('accessibleFolders filter pattern works', () => {
      const recentFolders = ref([
        { id: 1, name: 'Accessible', isAccessible: true },
        { id: 2, name: 'Inaccessible', isAccessible: false },
        { id: 3, name: 'Also Accessible', isAccessible: true },
      ])

      const accessibleFolders = computed(() =>
        recentFolders.value.filter(f => f.isAccessible),
      )

      expect(accessibleFolders.value).toHaveLength(2)
      expect(accessibleFolders.value.map(f => f.name)).toEqual(['Accessible', 'Also Accessible'])
    })

    it('inaccessibleFolders filter pattern works', () => {
      const recentFolders = ref([
        { id: 1, name: 'Accessible', isAccessible: true },
        { id: 2, name: 'Inaccessible', isAccessible: false },
      ])

      const inaccessibleFolders = computed(() =>
        recentFolders.value.filter(f => !f.isAccessible),
      )

      expect(inaccessibleFolders.value).toHaveLength(1)
      expect(inaccessibleFolders.value[0].name).toBe('Inaccessible')
    })
  })

  // ============================================================================
  // Loading State Patterns
  // ============================================================================

  describe('loading state patterns', () => {
    it('isLoadingFolders ref pattern works', () => {
      const isLoadingFolders = ref(false)

      expect(isLoadingFolders.value).toBe(false)

      isLoadingFolders.value = true
      expect(isLoadingFolders.value).toBe(true)

      isLoadingFolders.value = false
      expect(isLoadingFolders.value).toBe(false)
    })

    it('isLoadingFolderId ref pattern works', () => {
      const isLoadingFolderId = ref<number | null>(null)

      expect(isLoadingFolderId.value).toBeNull()

      isLoadingFolderId.value = 5
      expect(isLoadingFolderId.value).toBe(5)

      isLoadingFolderId.value = null
      expect(isLoadingFolderId.value).toBeNull()
    })
  })

  // ============================================================================
  // Error Handling Patterns
  // ============================================================================

  describe('error handling patterns', () => {
    it('error ref pattern works', () => {
      const error = ref<string | null>(null)

      expect(error.value).toBeNull()

      error.value = 'Something went wrong'
      expect(error.value).toBe('Something went wrong')

      error.value = null
      expect(error.value).toBeNull()
    })

    it('extracting error message pattern works', () => {
      const extractErrorMessage = (err: unknown): string => {
        return err instanceof Error ? err.message : 'Unknown error'
      }

      expect(extractErrorMessage(new Error('Test error'))).toBe('Test error')
      expect(extractErrorMessage('string error')).toBe('Unknown error')
      expect(extractErrorMessage(null)).toBe('Unknown error')
    })
  })

  // ============================================================================
  // Demo Mode Pattern
  // ============================================================================

  describe('demo mode pattern', () => {
    it('demo mode skips service calls', async () => {
      const isDemoMode = true
      const recentFolders = ref<{ id: number, name: string }[]>([])
      const mockListFolders = vi.fn()

      // Demo mode pattern from composable
      async function loadRecentFolders() {
        if (isDemoMode) {
          recentFolders.value = []
          return
        }
        recentFolders.value = await mockListFolders()
      }

      await loadRecentFolders()

      expect(mockListFolders).not.toHaveBeenCalled()
      expect(recentFolders.value).toEqual([])
    })

    it('non-demo mode calls service', async () => {
      const isDemoMode = false
      const recentFolders = ref<{ id: number, name: string }[]>([])
      const mockListFolders = vi.fn().mockResolvedValue([{ id: 1, name: 'Test' }])

      // Non-demo mode pattern
      async function loadRecentFolders() {
        if (isDemoMode) {
          recentFolders.value = []
          return
        }
        recentFolders.value = await mockListFolders()
      }

      await loadRecentFolders()

      expect(mockListFolders).toHaveBeenCalled()
      expect(recentFolders.value).toHaveLength(1)
    })
  })

  // ============================================================================
  // AbortError Handling Pattern
  // ============================================================================

  describe('AbortError handling pattern', () => {
    it('ignores AbortError (user cancelled)', async () => {
      const error = ref<string | null>(null)

      async function handleAction() {
        try {
          throw new DOMException('User cancelled', 'AbortError')
        }
        catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return false
          }
          error.value = err instanceof Error ? err.message : 'Unknown error'
          return false
        }
      }

      const result = await handleAction()

      expect(result).toBe(false)
      expect(error.value).toBeNull() // AbortError should not set error
    })

    it('sets error for other errors', async () => {
      const error = ref<string | null>(null)

      async function handleAction() {
        try {
          throw new Error('Permission denied')
        }
        catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') {
            return false
          }
          error.value = err instanceof Error ? err.message : 'Unknown error'
          return false
        }
      }

      const result = await handleAction()

      expect(result).toBe(false)
      expect(error.value).toBe('Permission denied')
    })
  })

  // ============================================================================
  // Folder Access Pattern
  // ============================================================================

  describe('folder access pattern', () => {
    it('checkFolderAccess returns isAccessible value', () => {
      const isDemoMode = false

      function checkFolderAccess(folder: { isAccessible?: boolean }): boolean {
        if (isDemoMode) {
          return false
        }
        return folder.isAccessible ?? false
      }

      expect(checkFolderAccess({ isAccessible: true })).toBe(true)
      expect(checkFolderAccess({ isAccessible: false })).toBe(false)
      expect(checkFolderAccess({})).toBe(false)
    })

    it('checkFolderAccess returns false in demo mode', () => {
      const isDemoMode = true

      function checkFolderAccess(folder: { isAccessible?: boolean }): boolean {
        if (isDemoMode) {
          return false
        }
        return folder.isAccessible ?? false
      }

      expect(checkFolderAccess({ isAccessible: true })).toBe(false)
    })
  })
})
