/**
 * Permission Recovery Store
 *
 * Manages the state for folder permission recovery when access is lost.
 * Used when reopening the app with stored folder handles that need re-authorization.
 *
 * Follows established store patterns:
 * - Composition API setup function
 * - shallowRef for collections
 * - Dedicated error ref
 * - Actions delegate to services
 */
import { BrowserFileSystemProvider } from '@literoom/core/filesystem'
import type { DirectoryHandle } from '@literoom/core/filesystem'

// ============================================================================
// Types
// ============================================================================

export interface FolderIssue {
  /** Key used in IndexedDB for this folder handle */
  folderId: string
  /** Display name of the folder */
  folderName: string
  /** Display path (may be partial, extracted from catalog) */
  folderPath: string
  /** Current permission state */
  permissionState: 'prompt' | 'denied'
  /** Optional error message if something went wrong */
  error?: string
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Update a specific folder issue in the issues array by folderId.
 * Returns a new array with the updated issue.
 */
function updateIssueById(
  issues: FolderIssue[],
  folderId: string,
  update: Partial<FolderIssue>,
): FolderIssue[] {
  return issues.map(issue =>
    issue.folderId === folderId ? { ...issue, ...update } : issue,
  )
}

// ============================================================================
// Store
// ============================================================================

export const usePermissionRecoveryStore = defineStore('permissionRecovery', () => {
  // ============================================================================
  // State
  // ============================================================================

  /**
   * Whether the permission recovery modal is visible.
   */
  const showModal = ref(false)

  /**
   * List of folders with permission issues.
   * Uses shallowRef for performance.
   */
  const folderIssues = shallowRef<FolderIssue[]>([])

  /**
   * Whether a recheck/retry operation is in progress.
   */
  const isRechecking = ref(false)

  /**
   * Error message from the last operation.
   */
  const error = ref<string | null>(null)

  // ============================================================================
  // Services
  // ============================================================================

  /**
   * FileSystemProvider instance for permission operations.
   * Lazily initialized to avoid SSR issues.
   */
  let fsProvider: BrowserFileSystemProvider | null = null

  function getProvider(): BrowserFileSystemProvider {
    if (!fsProvider) {
      fsProvider = new BrowserFileSystemProvider()
    }
    return fsProvider
  }

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Whether there are any folder issues.
   */
  const hasIssues = computed(() => folderIssues.value.length > 0)

  /**
   * Number of folders that are currently accessible.
   * For now, this returns 0 when we have issues (single-folder model).
   * In multi-folder catalogs, this would count folders without issues.
   */
  const accessibleCount = computed(() => {
    // In single-folder mode, if we have issues, nothing is accessible
    return folderIssues.value.length > 0 ? 0 : 1
  })

  /**
   * Total number of folders with issues.
   */
  const issueCount = computed(() => folderIssues.value.length)

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Check permission for a single folder handle.
   * Returns the permission state ('granted', 'prompt', or 'denied').
   */
  async function checkFolderPermission(handle: DirectoryHandle): Promise<'granted' | 'prompt' | 'denied'> {
    const provider = getProvider()
    try {
      const state = await provider.queryPermission(handle, 'read')
      return state
    }
    catch {
      return 'prompt'
    }
  }

  /**
   * Add a folder issue to the list and show the modal.
   */
  function addFolderIssue(
    folderId: string,
    folderName: string,
    folderPath: string,
    permissionState: 'prompt' | 'denied',
    issueError?: string,
  ): void {
    const issue: FolderIssue = { folderId, folderName, folderPath, permissionState, error: issueError }
    const existingIndex = folderIssues.value.findIndex(i => i.folderId === folderId)

    if (existingIndex >= 0) {
      // Update existing issue
      folderIssues.value = updateIssueById(folderIssues.value, folderId, issue)
    }
    else {
      // Add new issue
      folderIssues.value = [...folderIssues.value, issue]
    }

    showModal.value = true
  }

  /**
   * Re-authorize a specific folder.
   * Must be called from a user gesture (button click).
   *
   * @returns The handle if re-authorization succeeded, null otherwise
   */
  async function reauthorizeFolder(folderId: string): Promise<DirectoryHandle | null> {
    const provider = getProvider()
    error.value = null

    try {
      // Load the stored handle
      const handle = await provider.loadHandle(folderId)
      if (!handle) {
        error.value = 'Folder handle not found in storage'
        return null
      }

      // Request permission (requires user gesture)
      const state = await provider.requestPermission(handle, 'read')

      if (state === 'granted') {
        // Remove this folder from issues
        folderIssues.value = folderIssues.value.filter(issue => issue.folderId !== folderId)

        // Close modal if no more issues
        if (folderIssues.value.length === 0) {
          showModal.value = false
        }

        return handle
      }
      else {
        // Update the issue state to denied
        folderIssues.value = updateIssueById(folderIssues.value, folderId, { permissionState: 'denied' })
        return null
      }
    }
    catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to re-authorize folder'
      error.value = message

      // Update issue with error
      folderIssues.value = updateIssueById(folderIssues.value, folderId, { error: message })

      return null
    }
  }

  /**
   * Retry all folder authorizations.
   * Must be called from a user gesture (button click).
   */
  async function retryAll(): Promise<void> {
    isRechecking.value = true
    error.value = null

    // Process each issue sequentially (each needs user interaction)
    const issues = [...folderIssues.value]
    for (const issue of issues) {
      await reauthorizeFolder(issue.folderId)
    }

    isRechecking.value = false
  }

  /**
   * Clear all issues and close the modal.
   * Used when user chooses to continue with limited access or select a new folder.
   */
  function clearIssues(): void {
    folderIssues.value = []
    showModal.value = false
    error.value = null
  }

  /**
   * Open the modal manually.
   */
  function openModal(): void {
    showModal.value = true
  }

  /**
   * Close the modal without clearing issues.
   * Used when continuing with accessible folders.
   */
  function closeModal(): void {
    showModal.value = false
  }

  /**
   * Remove a specific folder from the issues list.
   */
  function removeFolderIssue(folderId: string): void {
    folderIssues.value = folderIssues.value.filter(issue => issue.folderId !== folderId)

    if (folderIssues.value.length === 0) {
      showModal.value = false
    }
  }

  // ============================================================================
  // Return
  // ============================================================================

  return {
    // State
    showModal,
    folderIssues,
    isRechecking,
    error,

    // Computed
    hasIssues,
    accessibleCount,
    issueCount,

    // Actions
    checkFolderPermission,
    addFolderIssue,
    reauthorizeFolder,
    retryAll,
    clearIssues,
    openModal,
    closeModal,
    removeFolderIssue,
  }
})
