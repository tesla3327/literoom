/**
 * Selection Store
 *
 * Manages selection state for the catalog:
 * - Current (focused) asset
 * - Multi-select with Ctrl/Cmd + click
 * - Range select with Shift + click
 *
 * Supports common selection patterns:
 * - Single click: select one, deselect others
 * - Ctrl/Cmd + click: toggle selection
 * - Shift + click: select range from last to current
 */
export const useSelectionStore = defineStore('selection', () => {
  // ============================================================================
  // State
  // ============================================================================

  /**
   * Currently focused/active asset ID.
   * This is the asset shown in loupe view and the anchor for range selection.
   */
  const currentId = ref<string | null>(null)

  /**
   * Set of selected asset IDs.
   * Uses shallowRef for performance with large selections.
   */
  const selectedIds = shallowRef<Set<string>>(new Set())

  /**
   * Last clicked asset ID (for Shift+click range selection).
   */
  const lastClickedId = ref<string | null>(null)

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Number of selected items.
   */
  const selectionCount = computed(() => selectedIds.value.size)

  /**
   * Whether multiple items are selected.
   */
  const hasMultipleSelected = computed(() => selectedIds.value.size > 1)

  /**
   * Whether the selection is empty.
   */
  const isEmpty = computed(() => selectedIds.value.size === 0)

  /**
   * Get the selected IDs as an array.
   */
  const selectedIdsArray = computed(() => Array.from(selectedIds.value))

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Get the first element from a Set, or null if empty.
   */
  function getFirstFromSet(set: Set<string>): string | null {
    const iterator = set.values()
    const first = iterator.next()
    return first.done ? null : first.value
  }

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Check if an asset is selected.
   */
  function isSelected(assetId: string): boolean {
    return selectedIds.value.has(assetId)
  }

  /**
   * Check if an asset is the current (focused) item.
   */
  function isCurrent(assetId: string): boolean {
    return currentId.value === assetId
  }

  /**
   * Select a single asset, clearing other selections.
   */
  function selectSingle(assetId: string): void {
    currentId.value = assetId
    lastClickedId.value = assetId
    selectedIds.value = new Set([assetId])
  }

  /**
   * Toggle selection of an asset (Ctrl/Cmd + click behavior).
   */
  function toggleSelection(assetId: string): void {
    const newSet = new Set(selectedIds.value)

    if (newSet.has(assetId)) {
      newSet.delete(assetId)
      // If we deselected the current item, move current to another selected item
      if (currentId.value === assetId) {
        currentId.value = getFirstFromSet(newSet)
      }
    }
    else {
      newSet.add(assetId)
      currentId.value = assetId
    }

    lastClickedId.value = assetId
    selectedIds.value = newSet
  }

  /**
   * Add an asset to the selection.
   */
  function addToSelection(assetId: string): void {
    if (!selectedIds.value.has(assetId)) {
      const newSet = new Set(selectedIds.value)
      newSet.add(assetId)
      selectedIds.value = newSet
    }
    currentId.value = assetId
    lastClickedId.value = assetId
  }

  /**
   * Remove an asset from the selection.
   */
  function removeFromSelection(assetId: string): void {
    if (selectedIds.value.has(assetId)) {
      const newSet = new Set(selectedIds.value)
      newSet.delete(assetId)
      selectedIds.value = newSet

      if (currentId.value === assetId) {
        currentId.value = getFirstFromSet(newSet)
      }
    }
  }

  /**
   * Select a range from lastClickedId to assetId.
   * Requires the ordered list of IDs to determine the range.
   */
  function selectRange(assetId: string, orderedIds: string[]): void {
    const anchor = lastClickedId.value
    if (!anchor) {
      selectSingle(assetId)
      return
    }

    const anchorIndex = orderedIds.indexOf(anchor)
    const targetIndex = orderedIds.indexOf(assetId)

    if (anchorIndex === -1 || targetIndex === -1) {
      selectSingle(assetId)
      return
    }

    const startIndex = Math.min(anchorIndex, targetIndex)
    const endIndex = Math.max(anchorIndex, targetIndex)

    // Create new selection with the range
    const newSet = new Set<string>()
    for (let i = startIndex; i <= endIndex; i++) {
      const id = orderedIds[i]
      if (id !== undefined) {
        newSet.add(id)
      }
    }

    currentId.value = assetId
    selectedIds.value = newSet
    // Don't update lastClickedId for range selection
  }

  /**
   * Handle a click event with modifier keys.
   * This is the main entry point for click-based selection.
   *
   * @param assetId - The clicked asset ID
   * @param event - The mouse event (for checking modifiers)
   * @param orderedIds - The ordered list of visible asset IDs
   */
  function handleClick(
    assetId: string,
    event: { shiftKey: boolean, ctrlKey: boolean, metaKey: boolean },
    orderedIds: string[],
  ): void {
    const isCtrlOrCmd = event.ctrlKey || event.metaKey

    if (event.shiftKey) {
      // Shift+click: range selection
      selectRange(assetId, orderedIds)
    }
    else if (isCtrlOrCmd) {
      // Ctrl/Cmd+click: toggle selection
      toggleSelection(assetId)
    }
    else {
      // Plain click: select single
      selectSingle(assetId)
    }
  }

  /**
   * Select all assets from the given ordered list.
   */
  function selectAll(orderedIds: string[]): void {
    if (orderedIds.length === 0) return

    selectedIds.value = new Set(orderedIds)
    const firstId = orderedIds[0]
    if (firstId !== undefined && (!currentId.value || !selectedIds.value.has(currentId.value))) {
      currentId.value = firstId
    }
  }

  /**
   * Navigate to the next asset in the ordered list.
   */
  function navigateNext(orderedIds: string[]): void {
    if (orderedIds.length === 0) return

    const firstId = orderedIds[0]
    if (!currentId.value) {
      if (firstId !== undefined) {
        selectSingle(firstId)
      }
      return
    }

    const currentIndex = orderedIds.indexOf(currentId.value)
    if (currentIndex === -1 || currentIndex >= orderedIds.length - 1) {
      return
    }

    const nextId = orderedIds[currentIndex + 1]
    if (nextId !== undefined) {
      selectSingle(nextId)
    }
  }

  /**
   * Navigate to the previous asset in the ordered list.
   */
  function navigatePrevious(orderedIds: string[]): void {
    if (orderedIds.length === 0) return

    const lastId = orderedIds[orderedIds.length - 1]
    if (!currentId.value) {
      if (lastId !== undefined) {
        selectSingle(lastId)
      }
      return
    }

    const currentIndex = orderedIds.indexOf(currentId.value)
    if (currentIndex <= 0) {
      return
    }

    const prevId = orderedIds[currentIndex - 1]
    if (prevId !== undefined) {
      selectSingle(prevId)
    }
  }

  /**
   * Navigate to the next unflagged asset.
   * Useful for culling workflow.
   */
  function navigateToNextUnflagged(
    orderedIds: string[],
    getFlag: (id: string) => 'none' | 'pick' | 'reject' | undefined,
  ): void {
    if (orderedIds.length === 0) return

    const startIndex = currentId.value ? orderedIds.indexOf(currentId.value) + 1 : 0

    // Search from current position to end
    for (let i = startIndex; i < orderedIds.length; i++) {
      const id = orderedIds[i]
      if (id !== undefined && getFlag(id) === 'none') {
        selectSingle(id)
        return
      }
    }

    // Wrap around and search from beginning
    for (let i = 0; i < startIndex; i++) {
      const id = orderedIds[i]
      if (id !== undefined && getFlag(id) === 'none') {
        selectSingle(id)
        return
      }
    }
  }

  /**
   * Clear all selections.
   */
  function clear(): void {
    currentId.value = null
    lastClickedId.value = null
    selectedIds.value = new Set()
  }

  /**
   * Set the current (focused) asset without changing selection.
   */
  function setCurrent(assetId: string | null): void {
    currentId.value = assetId
    if (assetId) {
      lastClickedId.value = assetId
    }
  }

  return {
    // State
    currentId,
    selectedIds,
    lastClickedId,

    // Computed
    selectionCount,
    hasMultipleSelected,
    isEmpty,
    selectedIdsArray,

    // Actions
    isSelected,
    isCurrent,
    selectSingle,
    toggleSelection,
    addToSelection,
    removeFromSelection,
    selectRange,
    handleClick,
    selectAll,
    navigateNext,
    navigatePrevious,
    navigateToNextUnflagged,
    clear,
    setCurrent,
  }
})
