/**
 * Copy/Paste Settings Composable
 *
 * Provides copy/paste functionality for edit settings:
 * - Copy current asset's settings to clipboard
 * - Paste clipboard settings to current or selected assets
 * - Integration with selection store for batch operations
 */
import type { CopiedSettings, CopyGroups } from '~/stores/editClipboard'
import { useClipboard } from '@vueuse/core'

export function useCopyPasteSettings() {
  const clipboardStore = useEditClipboardStore()
  const editStore = useEditStore()
  const selectionStore = useSelectionStore()
  const toast = useToast()
  const { copy: copyToSystemClipboard } = useClipboard()

  /**
   * Copy settings from the current asset.
   * Uses the selected groups from the clipboard store.
   */
  function copySettings(): void {
    const currentId = selectionStore.currentId
    if (!currentId) {
      toast.add({
        title: 'No photo selected',
        description: 'Select a photo to copy settings from',
        color: 'warning',
      })
      return
    }

    const { basicAdjustments, toneCurve, crop, rotation } = clipboardStore.selectedGroups

    // Check if any groups are selected
    if (!basicAdjustments && !toneCurve && !crop && !rotation) {
      toast.add({
        title: 'No settings selected',
        description: 'Select at least one group of settings to copy',
        color: 'warning',
      })
      return
    }

    // Build the copied settings object
    const settings: CopiedSettings = {
      type: 'literoom-settings',
      version: 1,
      timestamp: Date.now(),
      sourceAssetId: currentId,
      groups: { basicAdjustments, toneCurve, crop, rotation },
      data: {},
    }

    // Copy basic adjustments (excluding toneCurve)
    if (basicAdjustments) {
      const { toneCurve: _excludedCurve, ...basicAdj } = editStore.adjustments
      settings.data.adjustments = { ...basicAdj }
    }

    // Copy tone curve
    if (toneCurve) {
      settings.data.toneCurve = {
        points: editStore.adjustments.toneCurve.points.map(p => ({ ...p })),
      }
    }

    // Copy crop rectangle
    if (crop) {
      const cropRect = editStore.cropTransform.crop
      settings.data.crop = cropRect ? { ...cropRect } : null
    }

    // Copy rotation parameters
    if (rotation) {
      settings.data.rotation = { ...editStore.cropTransform.rotation }
    }

    // Store in clipboard store
    clipboardStore.setCopiedSettings(settings)
    clipboardStore.closeCopyModal()

    // Also copy to system clipboard (for potential future cross-tab support)
    copyToSystemClipboard(JSON.stringify(settings))

    // Show success toast
    toast.add({
      title: 'Settings copied',
      description: clipboardStore.clipboardSummary ?? 'Edit settings copied to clipboard',
      color: 'success',
    })
  }

  /**
   * Paste settings to target assets.
   * If no targets specified, uses selected assets or current asset.
   */
  async function pasteSettings(targetIds?: string[]): Promise<void> {
    const settings = clipboardStore.copiedSettings
    if (!settings) {
      toast.add({
        title: 'Nothing to paste',
        description: 'Copy settings from a photo first',
        color: 'warning',
      })
      return
    }

    // Determine targets
    let targets: string[]
    if (targetIds && targetIds.length > 0) {
      targets = targetIds
    }
    else if (selectionStore.selectedIds.size > 0) {
      // Use selected assets in grid view
      targets = [...selectionStore.selectedIds]
    }
    else if (selectionStore.currentId) {
      // Use current asset
      targets = [selectionStore.currentId]
    }
    else {
      toast.add({
        title: 'No photo selected',
        description: 'Select photos to paste settings to',
        color: 'warning',
      })
      return
    }

    // Apply to each target
    let appliedCount = 0
    for (const assetId of targets) {
      const success = await applySettingsToAsset(assetId, settings)
      if (success) {
        appliedCount++
      }
    }

    // Show feedback
    if (appliedCount === 0) {
      toast.add({
        title: 'Paste failed',
        description: 'Could not apply settings to any photos',
        color: 'error',
      })
    }
    else if (appliedCount === 1) {
      toast.add({
        title: 'Settings pasted',
        description: 'Edit settings applied',
        color: 'success',
      })
    }
    else {
      toast.add({
        title: 'Settings pasted',
        description: `Applied to ${appliedCount} photos`,
        color: 'success',
      })
    }
  }

  /**
   * Apply copied settings to a single asset.
   * Returns true if successful.
   */
  async function applySettingsToAsset(
    assetId: string,
    settings: CopiedSettings | Readonly<CopiedSettings>,
  ): Promise<boolean> {
    try {
      // If this is the currently selected asset, apply via edit store
      // Use selectionStore.currentId as the authoritative source of the current asset,
      // since editStore.currentAssetId may not be synchronized during navigation
      if (assetId === selectionStore.currentId) {
        applyToEditStore(settings)
        return true
      }

      // For non-current assets, we would need to update via catalog service
      // For v1, only support paste in Edit view (current asset)
      // Grid batch paste can be added in v1.1 via CatalogService.updateEditState(assetId, editState)

      // For now, if the asset is not current, we skip it
      return false
    }
    catch {
      return false
    }
  }

  /**
   * Apply settings directly to the edit store (current asset).
   * Takes a readonly settings object and creates mutable copies for the store.
   */
  function applyToEditStore(settings: CopiedSettings | Readonly<CopiedSettings>): void {
    // Apply basic adjustments
    if (settings.data.adjustments) {
      editStore.setAdjustments({ ...settings.data.adjustments })
    }

    // Apply tone curve - need to deep clone the points array
    if (settings.data.toneCurve) {
      editStore.setToneCurve({
        points: settings.data.toneCurve.points.map(p => ({ x: p.x, y: p.y })),
      })
    }

    // Apply crop - clone if present
    if (settings.data.crop !== undefined) {
      editStore.setCrop(settings.data.crop ? { ...settings.data.crop } : null)
    }

    // Apply rotation - clone if present
    if (settings.data.rotation) {
      editStore.setRotation({ ...settings.data.rotation })
    }
  }

  /**
   * Check if paste is available (clipboard has content).
   */
  const canPaste = computed(() => clipboardStore.hasClipboardContent)

  /**
   * Get clipboard summary for display.
   */
  const clipboardSummary = computed(() => clipboardStore.clipboardSummary)

  /**
   * Get the selected groups for display.
   */
  const selectedGroups = computed(() => clipboardStore.selectedGroups)

  /**
   * Open the copy modal.
   */
  function openCopyModal(): void {
    clipboardStore.openCopyModal()
  }

  /**
   * Close the copy modal.
   */
  function closeCopyModal(): void {
    clipboardStore.closeCopyModal()
  }

  /**
   * Toggle a group selection.
   */
  function toggleGroup(group: keyof CopyGroups): void {
    clipboardStore.toggleGroup(group)
  }

  /**
   * Select all groups.
   */
  function selectAllGroups(): void {
    clipboardStore.selectAll()
  }

  /**
   * Deselect all groups.
   */
  function selectNoGroups(): void {
    clipboardStore.selectNone()
  }

  /**
   * Clear the clipboard.
   */
  function clearClipboard(): void {
    clipboardStore.clear()
  }

  return {
    // Actions
    copySettings,
    pasteSettings,
    openCopyModal,
    closeCopyModal,
    toggleGroup,
    selectAllGroups,
    selectNoGroups,
    clearClipboard,

    // State
    canPaste,
    clipboardSummary,
    selectedGroups,
    showCopyModal: computed(() => clipboardStore.showCopyModal),
    hasSelectedGroups: computed(() => clipboardStore.hasSelectedGroups),
  }
}
