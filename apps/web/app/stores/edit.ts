/**
 * Edit Store
 *
 * Manages edit state for photo editing:
 * - Current asset being edited
 * - Adjustment values (temperature, exposure, etc.)
 * - Dirty flag tracking
 * - Load/reset/save operations
 *
 * Edit state is persisted per-asset in the database.
 */
import type { Adjustments, EditState } from '@literoom/core/catalog'
import {
  DEFAULT_ADJUSTMENTS,
  EDIT_SCHEMA_VERSION,
  createDefaultEditState,
  hasModifiedAdjustments,
} from '@literoom/core/catalog'

export const useEditStore = defineStore('edit', () => {
  // ============================================================================
  // State
  // ============================================================================

  /**
   * ID of the asset currently being edited.
   */
  const currentAssetId = ref<string | null>(null)

  /**
   * Current adjustment values.
   */
  const adjustments = ref<Adjustments>({ ...DEFAULT_ADJUSTMENTS })

  /**
   * Whether the edit state has been modified since loading.
   */
  const isDirty = ref(false)

  /**
   * Whether edits are currently being saved.
   */
  const isSaving = ref(false)

  /**
   * Error message if last operation failed.
   */
  const error = ref<string | null>(null)

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Whether any adjustments have been modified from defaults.
   */
  const hasModifications = computed(() => hasModifiedAdjustments(adjustments.value))

  /**
   * Get the full edit state object.
   */
  const editState = computed<EditState>(() => ({
    version: EDIT_SCHEMA_VERSION,
    adjustments: { ...adjustments.value },
  }))

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Load edit state for an asset.
   * If no saved state exists, initializes with defaults.
   */
  async function loadForAsset(assetId: string): Promise<void> {
    // Save current edits before switching
    if (isDirty.value && currentAssetId.value) {
      await save()
    }

    currentAssetId.value = assetId
    error.value = null

    // TODO: Load from database once persistence is implemented
    // For now, initialize with defaults
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    isDirty.value = false
  }

  /**
   * Update a single adjustment value.
   */
  function setAdjustment<K extends keyof Adjustments>(key: K, value: number): void {
    adjustments.value[key] = value
    isDirty.value = true
    error.value = null
  }

  /**
   * Update multiple adjustment values at once.
   */
  function setAdjustments(updates: Partial<Adjustments>): void {
    adjustments.value = {
      ...adjustments.value,
      ...updates,
    }
    isDirty.value = true
    error.value = null
  }

  /**
   * Reset all adjustments to default values.
   */
  function reset(): void {
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    isDirty.value = true
    error.value = null
  }

  /**
   * Save current edit state to database.
   */
  async function save(): Promise<void> {
    if (!currentAssetId.value) return
    if (!isDirty.value) return

    isSaving.value = true
    error.value = null

    try {
      // TODO: Save to database once persistence is implemented
      // const state = editState.value
      // await saveEditState(currentAssetId.value, state)
      isDirty.value = false
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save edits'
      throw e
    } finally {
      isSaving.value = false
    }
  }

  /**
   * Clear edit state (e.g., when navigating away from edit view).
   */
  function clear(): void {
    currentAssetId.value = null
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    isDirty.value = false
    isSaving.value = false
    error.value = null
  }

  return {
    // State
    currentAssetId,
    adjustments,
    isDirty,
    isSaving,
    error,

    // Computed
    hasModifications,
    editState,

    // Actions
    loadForAsset,
    setAdjustment,
    setAdjustments,
    reset,
    save,
    clear,
  }
})
