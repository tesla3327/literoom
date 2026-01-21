/**
 * Edit Store
 *
 * Manages edit state for photo editing:
 * - Current asset being edited
 * - Adjustment values (temperature, exposure, etc.)
 * - Tone curve control points
 * - Crop and rotation settings
 * - Dirty flag tracking
 * - Load/reset/save operations
 *
 * Edit state is persisted per-asset in the database.
 */
import type { Adjustments, CropRectangle, CropTransform, EditState, RotationParameters } from '@literoom/core/catalog'
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP_TRANSFORM,
  EDIT_SCHEMA_VERSION,
  cloneCropTransform,
  createDefaultEditState,
  hasModifiedAdjustments,
  isModifiedCropTransform,
  isModifiedToneCurve,
} from '@literoom/core/catalog'
import type { CurvePoint, ToneCurve } from '@literoom/core/decode'
import { DEFAULT_TONE_CURVE } from '@literoom/core/decode'

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
   * Current crop and rotation settings.
   */
  const cropTransform = ref<CropTransform>(cloneCropTransform(DEFAULT_CROP_TRANSFORM))

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
  const hasModifications = computed(
    () => hasModifiedAdjustments(adjustments.value) || isModifiedCropTransform(cropTransform.value),
  )

  /**
   * Whether the tone curve has been modified from the default linear curve.
   */
  const hasCurveModifications = computed(() => isModifiedToneCurve(adjustments.value.toneCurve))

  /**
   * Whether the crop/transform has been modified from defaults.
   */
  const hasCropTransformModifications = computed(() => isModifiedCropTransform(cropTransform.value))

  /**
   * Get the full edit state object.
   */
  const editState = computed<EditState>(() => ({
    version: EDIT_SCHEMA_VERSION,
    adjustments: { ...adjustments.value },
    cropTransform: cloneCropTransform(cropTransform.value),
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
    cropTransform.value = cloneCropTransform(DEFAULT_CROP_TRANSFORM)
    isDirty.value = false
  }

  /**
   * Numeric adjustment keys (excludes toneCurve).
   */
  type NumericAdjustmentKey = Exclude<keyof Adjustments, 'toneCurve'>

  /**
   * Update a single numeric adjustment value.
   */
  function setAdjustment(key: NumericAdjustmentKey, value: number): void {
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
    cropTransform.value = cloneCropTransform(DEFAULT_CROP_TRANSFORM)
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
    }
    catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to save edits'
      throw e
    }
    finally {
      isSaving.value = false
    }
  }

  /**
   * Clear edit state (e.g., when navigating away from edit view).
   */
  function clear(): void {
    currentAssetId.value = null
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    cropTransform.value = cloneCropTransform(DEFAULT_CROP_TRANSFORM)
    isDirty.value = false
    isSaving.value = false
    error.value = null
  }

  // ============================================================================
  // Tone Curve Actions
  // ============================================================================

  /**
   * Set the complete tone curve.
   */
  function setToneCurve(curve: ToneCurve): void {
    adjustments.value = {
      ...adjustments.value,
      toneCurve: { points: [...curve.points] },
    }
    isDirty.value = true
    error.value = null
  }

  /**
   * Add a control point to the curve.
   * Points are automatically sorted by x coordinate.
   */
  function addCurvePoint(point: CurvePoint): void {
    const newPoints = [...adjustments.value.toneCurve.points, point].sort(
      (a, b) => a.x - b.x,
    )
    setToneCurve({ points: newPoints })
  }

  /**
   * Update a control point by index.
   * Points are automatically re-sorted by x coordinate.
   */
  function updateCurvePoint(index: number, point: CurvePoint): void {
    const newPoints = [...adjustments.value.toneCurve.points]
    newPoints[index] = point
    newPoints.sort((a, b) => a.x - b.x)
    setToneCurve({ points: newPoints })
  }

  /**
   * Delete a control point by index.
   * Cannot delete anchor points (first and last).
   * Cannot reduce below 2 points.
   */
  function deleteCurvePoint(index: number): void {
    const points = adjustments.value.toneCurve.points
    if (index === 0 || index === points.length - 1) return
    if (points.length <= 2) return

    const newPoints = points.filter((_, i) => i !== index)
    setToneCurve({ points: newPoints })
  }

  /**
   * Reset only the tone curve to the default linear curve.
   */
  function resetToneCurve(): void {
    setToneCurve({ points: [...DEFAULT_TONE_CURVE.points] })
  }

  // ============================================================================
  // Crop/Transform Actions
  // ============================================================================

  /**
   * Set complete crop transform.
   */
  function setCropTransform(transform: CropTransform): void {
    cropTransform.value = cloneCropTransform(transform)
    isDirty.value = true
    error.value = null
  }

  /**
   * Set crop rectangle only.
   */
  function setCrop(crop: CropRectangle | null): void {
    cropTransform.value = {
      ...cropTransform.value,
      crop: crop ? { ...crop } : null,
    }
    isDirty.value = true
    error.value = null
  }

  /**
   * Set rotation parameters only.
   */
  function setRotation(rotation: RotationParameters): void {
    cropTransform.value = {
      ...cropTransform.value,
      rotation: { ...rotation },
    }
    isDirty.value = true
    error.value = null
  }

  /**
   * Set main rotation angle (preserving straighten).
   */
  function setRotationAngle(angle: number): void {
    cropTransform.value = {
      ...cropTransform.value,
      rotation: {
        ...cropTransform.value.rotation,
        angle,
      },
    }
    isDirty.value = true
    error.value = null
  }

  /**
   * Set straighten angle (preserving main rotation).
   */
  function setStraightenAngle(straighten: number): void {
    cropTransform.value = {
      ...cropTransform.value,
      rotation: {
        ...cropTransform.value.rotation,
        straighten,
      },
    }
    isDirty.value = true
    error.value = null
  }

  /**
   * Reset crop transform to default.
   */
  function resetCropTransform(): void {
    cropTransform.value = cloneCropTransform(DEFAULT_CROP_TRANSFORM)
    isDirty.value = true
    error.value = null
  }

  return {
    // State
    currentAssetId,
    adjustments,
    cropTransform: readonly(cropTransform),
    isDirty,
    isSaving,
    error,

    // Computed
    hasModifications,
    hasCurveModifications,
    hasCropTransformModifications,
    editState,

    // Actions
    loadForAsset,
    setAdjustment,
    setAdjustments,
    reset,
    save,
    clear,

    // Tone Curve Actions
    setToneCurve,
    addCurvePoint,
    updateCurvePoint,
    deleteCurvePoint,
    resetToneCurve,

    // Crop/Transform Actions
    setCropTransform,
    setCrop,
    setRotation,
    setRotationAngle,
    setStraightenAngle,
    resetCropTransform,
  }
})
