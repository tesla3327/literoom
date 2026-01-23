/**
 * Unit tests for the permission recovery store.
 *
 * Tests permission state management including:
 * - Folder issue tracking
 * - Modal visibility
 * - Permission checking
 * - Re-authorization flow
 * - Issue clearing and removal
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { usePermissionRecoveryStore, type FolderIssue } from '~/stores/permissionRecovery'

// ============================================================================
// Mocks
// ============================================================================

// Mock the BrowserFileSystemProvider
const mockQueryPermission = vi.fn()
const mockRequestPermission = vi.fn()
const mockLoadHandle = vi.fn()

vi.mock('@literoom/core/filesystem', () => ({
  BrowserFileSystemProvider: vi.fn().mockImplementation(() => ({
    queryPermission: mockQueryPermission,
    requestPermission: mockRequestPermission,
    loadHandle: mockLoadHandle,
  })),
}))

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock folder issue.
 */
function createFolderIssue(overrides: Partial<FolderIssue> = {}): FolderIssue {
  return {
    folderId: 'test-folder-1',
    folderName: 'Photos',
    folderPath: '/Users/test/Photos',
    permissionState: 'prompt',
    ...overrides,
  }
}

/**
 * Create a mock directory handle.
 */
function createMockHandle(name: string = 'Photos'): FileSystemDirectoryHandle {
  return {
    name,
    kind: 'directory',
  } as unknown as FileSystemDirectoryHandle
}

describe('permissionRecoveryStore', () => {
  let store: ReturnType<typeof usePermissionRecoveryStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = usePermissionRecoveryStore()

    // Reset mocks
    vi.clearAllMocks()
  })

  // ============================================================================
  // Initial State
  // ============================================================================

  describe('initial state', () => {
    it('has showModal false', () => {
      expect(store.showModal).toBe(false)
    })

    it('has empty folderIssues', () => {
      expect(store.folderIssues).toEqual([])
    })

    it('has isRechecking false', () => {
      expect(store.isRechecking).toBe(false)
    })

    it('has null error', () => {
      expect(store.error).toBeNull()
    })

    it('hasIssues is false', () => {
      expect(store.hasIssues).toBe(false)
    })

    it('issueCount is 0', () => {
      expect(store.issueCount).toBe(0)
    })

    it('accessibleCount is 1 (no issues means accessible)', () => {
      expect(store.accessibleCount).toBe(1)
    })
  })

  // ============================================================================
  // Add Folder Issue
  // ============================================================================

  describe('addFolderIssue', () => {
    it('adds a new folder issue', () => {
      store.addFolderIssue('folder-1', 'Photos', '/Users/test/Photos', 'prompt')

      expect(store.folderIssues).toHaveLength(1)
      expect(store.folderIssues[0]).toEqual({
        folderId: 'folder-1',
        folderName: 'Photos',
        folderPath: '/Users/test/Photos',
        permissionState: 'prompt',
        error: undefined,
      })
    })

    it('shows modal when issue is added', () => {
      expect(store.showModal).toBe(false)
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt')
      expect(store.showModal).toBe(true)
    })

    it('adds issue with error message', () => {
      store.addFolderIssue('folder-1', 'Photos', '/path', 'denied', 'Access denied by user')

      expect(store.folderIssues[0].error).toBe('Access denied by user')
    })

    it('updates existing issue by folderId', () => {
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt')
      store.addFolderIssue('folder-1', 'Photos Updated', '/new/path', 'denied', 'New error')

      expect(store.folderIssues).toHaveLength(1)
      expect(store.folderIssues[0]).toEqual({
        folderId: 'folder-1',
        folderName: 'Photos Updated',
        folderPath: '/new/path',
        permissionState: 'denied',
        error: 'New error',
      })
    })

    it('can add multiple different issues', () => {
      store.addFolderIssue('folder-1', 'Photos', '/path1', 'prompt')
      store.addFolderIssue('folder-2', 'Documents', '/path2', 'denied')

      expect(store.folderIssues).toHaveLength(2)
      expect(store.folderIssues[0].folderId).toBe('folder-1')
      expect(store.folderIssues[1].folderId).toBe('folder-2')
    })

    it('updates hasIssues computed', () => {
      expect(store.hasIssues).toBe(false)
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt')
      expect(store.hasIssues).toBe(true)
    })

    it('updates issueCount computed', () => {
      expect(store.issueCount).toBe(0)
      store.addFolderIssue('folder-1', 'Photos', '/path1', 'prompt')
      expect(store.issueCount).toBe(1)
      store.addFolderIssue('folder-2', 'Documents', '/path2', 'prompt')
      expect(store.issueCount).toBe(2)
    })

    it('updates accessibleCount computed', () => {
      expect(store.accessibleCount).toBe(1)
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt')
      expect(store.accessibleCount).toBe(0)
    })
  })

  // ============================================================================
  // Remove Folder Issue
  // ============================================================================

  describe('removeFolderIssue', () => {
    beforeEach(() => {
      store.addFolderIssue('folder-1', 'Photos', '/path1', 'prompt')
      store.addFolderIssue('folder-2', 'Documents', '/path2', 'denied')
    })

    it('removes a specific folder issue', () => {
      store.removeFolderIssue('folder-1')

      expect(store.folderIssues).toHaveLength(1)
      expect(store.folderIssues[0].folderId).toBe('folder-2')
    })

    it('does nothing if folderId not found', () => {
      store.removeFolderIssue('non-existent')
      expect(store.folderIssues).toHaveLength(2)
    })

    it('closes modal when last issue is removed', () => {
      store.removeFolderIssue('folder-1')
      expect(store.showModal).toBe(true) // Still has folder-2

      store.removeFolderIssue('folder-2')
      expect(store.showModal).toBe(false)
    })

    it('updates computed properties', () => {
      expect(store.issueCount).toBe(2)
      store.removeFolderIssue('folder-1')
      expect(store.issueCount).toBe(1)
      expect(store.hasIssues).toBe(true)

      store.removeFolderIssue('folder-2')
      expect(store.issueCount).toBe(0)
      expect(store.hasIssues).toBe(false)
      expect(store.accessibleCount).toBe(1)
    })
  })

  // ============================================================================
  // Clear Issues
  // ============================================================================

  describe('clearIssues', () => {
    beforeEach(() => {
      store.addFolderIssue('folder-1', 'Photos', '/path1', 'prompt')
      store.addFolderIssue('folder-2', 'Documents', '/path2', 'denied')
    })

    it('clears all folder issues', () => {
      store.clearIssues()
      expect(store.folderIssues).toEqual([])
    })

    it('closes the modal', () => {
      expect(store.showModal).toBe(true)
      store.clearIssues()
      expect(store.showModal).toBe(false)
    })

    it('clears error', () => {
      // Simulate an error being set
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt', 'Some error')
      store.clearIssues()
      expect(store.error).toBeNull()
    })

    it('resets computed properties', () => {
      store.clearIssues()
      expect(store.hasIssues).toBe(false)
      expect(store.issueCount).toBe(0)
      expect(store.accessibleCount).toBe(1)
    })
  })

  // ============================================================================
  // Modal Control
  // ============================================================================

  describe('openModal', () => {
    it('opens the modal', () => {
      expect(store.showModal).toBe(false)
      store.openModal()
      expect(store.showModal).toBe(true)
    })
  })

  describe('closeModal', () => {
    it('closes the modal without clearing issues', () => {
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt')
      expect(store.showModal).toBe(true)

      store.closeModal()

      expect(store.showModal).toBe(false)
      expect(store.folderIssues).toHaveLength(1) // Issues not cleared
    })
  })

  // ============================================================================
  // Check Folder Permission
  // ============================================================================

  describe('checkFolderPermission', () => {
    const mockHandle = createMockHandle()

    it('returns "granted" when permission is granted', async () => {
      mockQueryPermission.mockResolvedValue('granted')

      const result = await store.checkFolderPermission(mockHandle)

      expect(result).toBe('granted')
      expect(mockQueryPermission).toHaveBeenCalledWith(mockHandle, 'read')
    })

    it('returns "prompt" when permission needs prompting', async () => {
      mockQueryPermission.mockResolvedValue('prompt')

      const result = await store.checkFolderPermission(mockHandle)

      expect(result).toBe('prompt')
    })

    it('returns "denied" when permission is denied', async () => {
      mockQueryPermission.mockResolvedValue('denied')

      const result = await store.checkFolderPermission(mockHandle)

      expect(result).toBe('denied')
    })

    it('returns "prompt" on error', async () => {
      mockQueryPermission.mockRejectedValue(new Error('Permission check failed'))

      const result = await store.checkFolderPermission(mockHandle)

      expect(result).toBe('prompt')
    })
  })

  // ============================================================================
  // Reauthorize Folder
  // ============================================================================

  describe('reauthorizeFolder', () => {
    beforeEach(() => {
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt')
    })

    it('returns handle when permission is granted', async () => {
      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('granted')

      const result = await store.reauthorizeFolder('folder-1')

      expect(result).toBe(mockHandle)
      expect(mockLoadHandle).toHaveBeenCalledWith('folder-1')
      expect(mockRequestPermission).toHaveBeenCalledWith(mockHandle, 'read')
    })

    it('removes folder from issues when granted', async () => {
      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('granted')

      await store.reauthorizeFolder('folder-1')

      expect(store.folderIssues).toHaveLength(0)
    })

    it('closes modal when last issue is resolved', async () => {
      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('granted')

      await store.reauthorizeFolder('folder-1')

      expect(store.showModal).toBe(false)
    })

    it('returns null if handle not found', async () => {
      mockLoadHandle.mockResolvedValue(null)

      const result = await store.reauthorizeFolder('folder-1')

      expect(result).toBeNull()
      expect(store.error).toBe('Folder handle not found in storage')
    })

    it('returns null and updates state to denied when permission denied', async () => {
      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('denied')

      const result = await store.reauthorizeFolder('folder-1')

      expect(result).toBeNull()
      expect(store.folderIssues[0].permissionState).toBe('denied')
    })

    it('returns null and sets error on exception', async () => {
      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockRejectedValue(new Error('User cancelled'))

      const result = await store.reauthorizeFolder('folder-1')

      expect(result).toBeNull()
      expect(store.error).toBe('User cancelled')
      expect(store.folderIssues[0].error).toBe('User cancelled')
    })

    it('clears error before operation', async () => {
      // First, create an error
      mockLoadHandle.mockResolvedValue(null)
      await store.reauthorizeFolder('folder-1')
      expect(store.error).toBe('Folder handle not found in storage')

      // Then try again with success
      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('granted')

      await store.reauthorizeFolder('folder-1')

      expect(store.error).toBeNull()
    })

    it('keeps other issues when one is resolved', async () => {
      store.addFolderIssue('folder-2', 'Documents', '/path2', 'prompt')

      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('granted')

      await store.reauthorizeFolder('folder-1')

      expect(store.folderIssues).toHaveLength(1)
      expect(store.folderIssues[0].folderId).toBe('folder-2')
      expect(store.showModal).toBe(true) // Modal still open
    })
  })

  // ============================================================================
  // Retry All
  // ============================================================================

  describe('retryAll', () => {
    beforeEach(() => {
      store.addFolderIssue('folder-1', 'Photos', '/path1', 'prompt')
      store.addFolderIssue('folder-2', 'Documents', '/path2', 'prompt')
    })

    it('sets isRechecking during operation', async () => {
      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('granted')

      expect(store.isRechecking).toBe(false)

      const promise = store.retryAll()

      // Can't easily test mid-operation state, but we can test it resets
      await promise

      expect(store.isRechecking).toBe(false)
    })

    it('processes all folder issues', async () => {
      const mockHandle1 = createMockHandle('Photos')
      const mockHandle2 = createMockHandle('Documents')

      mockLoadHandle
        .mockResolvedValueOnce(mockHandle1)
        .mockResolvedValueOnce(mockHandle2)
      mockRequestPermission.mockResolvedValue('granted')

      await store.retryAll()

      expect(mockLoadHandle).toHaveBeenCalledTimes(2)
      expect(store.folderIssues).toHaveLength(0)
    })

    it('handles mixed results (some granted, some denied)', async () => {
      const mockHandle1 = createMockHandle('Photos')
      const mockHandle2 = createMockHandle('Documents')

      mockLoadHandle
        .mockResolvedValueOnce(mockHandle1)
        .mockResolvedValueOnce(mockHandle2)
      mockRequestPermission
        .mockResolvedValueOnce('granted')
        .mockResolvedValueOnce('denied')

      await store.retryAll()

      // folder-1 should be removed, folder-2 should remain with denied state
      expect(store.folderIssues).toHaveLength(1)
      expect(store.folderIssues[0].folderId).toBe('folder-2')
      expect(store.folderIssues[0].permissionState).toBe('denied')
    })

    it('clears error before operation', async () => {
      // Set up an error state first
      store.addFolderIssue('folder-1', 'Photos', '/path1', 'prompt', 'Previous error')

      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('granted')

      await store.retryAll()

      expect(store.error).toBeNull()
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================

  describe('edge cases', () => {
    it('handles rapid add/remove operations', () => {
      // Add and remove quickly
      for (let i = 0; i < 10; i++) {
        store.addFolderIssue(`folder-${i}`, `Folder ${i}`, `/path${i}`, 'prompt')
      }
      expect(store.folderIssues).toHaveLength(10)

      for (let i = 0; i < 5; i++) {
        store.removeFolderIssue(`folder-${i}`)
      }
      expect(store.folderIssues).toHaveLength(5)
    })

    it('handles adding same folder multiple times (updates)', () => {
      store.addFolderIssue('folder-1', 'Name 1', '/path1', 'prompt')
      store.addFolderIssue('folder-1', 'Name 2', '/path2', 'denied')
      store.addFolderIssue('folder-1', 'Name 3', '/path3', 'prompt')

      expect(store.folderIssues).toHaveLength(1)
      expect(store.folderIssues[0].folderName).toBe('Name 3')
    })

    it('handles clearing when already empty', () => {
      expect(() => store.clearIssues()).not.toThrow()
      expect(store.folderIssues).toEqual([])
    })

    it('handles removing non-existent folder', () => {
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt')
      expect(() => store.removeFolderIssue('non-existent')).not.toThrow()
      expect(store.folderIssues).toHaveLength(1)
    })
  })

  // ============================================================================
  // Permission State Transitions
  // ============================================================================

  describe('permission state transitions', () => {
    it('tracks transition from prompt to granted', async () => {
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt')
      expect(store.folderIssues[0].permissionState).toBe('prompt')

      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('granted')

      await store.reauthorizeFolder('folder-1')

      // Issue should be removed when granted
      expect(store.folderIssues).toHaveLength(0)
    })

    it('tracks transition from prompt to denied', async () => {
      store.addFolderIssue('folder-1', 'Photos', '/path', 'prompt')

      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('denied')

      await store.reauthorizeFolder('folder-1')

      expect(store.folderIssues[0].permissionState).toBe('denied')
    })

    it('allows retry after denied', async () => {
      store.addFolderIssue('folder-1', 'Photos', '/path', 'denied')

      const mockHandle = createMockHandle()
      mockLoadHandle.mockResolvedValue(mockHandle)
      mockRequestPermission.mockResolvedValue('granted')

      const result = await store.reauthorizeFolder('folder-1')

      expect(result).toBe(mockHandle)
      expect(store.folderIssues).toHaveLength(0)
    })
  })
})
