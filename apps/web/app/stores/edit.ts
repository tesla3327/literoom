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
import type {
  Adjustments,
  CropRectangle,
  CropTransform,
  EditState,
  LinearGradientMask,
  MaskAdjustments,
  MaskStack,
  RadialGradientMask,
  RotationParameters,
} from '@literoom/core/catalog'
import {
  DEFAULT_ADJUSTMENTS,
  DEFAULT_CROP_TRANSFORM,
  EDIT_SCHEMA_VERSION,
  cloneCropTransform,
  cloneLinearMask,
  cloneMaskStack,
  cloneRadialMask,
  createDefaultEditState,
  createDefaultMaskStack,
  hasModifiedAdjustments,
  isModifiedCropTransform,
  isModifiedMaskStack,
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
   * Current local adjustment masks.
   */
  const masks = ref<MaskStack | null>(null)

  /**
   * ID of the currently selected mask for editing.
   */
  const selectedMaskId = ref<string | null>(null)

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

  /**
   * In-memory cache of edit states per asset.
   * This allows edits to persist within a session when switching between images.
   * Note: This is NOT persisted to database - edits are lost on page refresh.
   */
  const editCache = ref<Map<string, EditState>>(new Map())

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Whether any edits have been modified from defaults.
   */
  const hasModifications = computed(
    () => hasModifiedAdjustments(adjustments.value) ||
          isModifiedCropTransform(cropTransform.value) ||
          isModifiedMaskStack(masks.value ?? undefined),
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
   * Whether any masks have been added.
   */
  const hasMaskModifications = computed(() => isModifiedMaskStack(masks.value ?? undefined))

  /**
   * The currently selected mask and its type.
   */
  const selectedMask = computed(() => {
    if (!selectedMaskId.value || !masks.value) return null

    const linearMask = masks.value.linearMasks.find(m => m.id === selectedMaskId.value)
    if (linearMask) return { type: 'linear' as const, mask: linearMask }

    const radialMask = masks.value.radialMasks.find(m => m.id === selectedMaskId.value)
    if (radialMask) return { type: 'radial' as const, mask: radialMask }

    return null
  })

  /**
   * Get the full edit state object.
   */
  const editState = computed<EditState>(() => ({
    version: EDIT_SCHEMA_VERSION,
    adjustments: { ...adjustments.value },
    cropTransform: cloneCropTransform(cropTransform.value),
    masks: masks.value ? cloneMaskStack(masks.value) : undefined,
  }))

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Load edit state for an asset.
   * First checks the in-memory cache, then falls back to defaults.
   * Saves current edits to cache before switching.
   */
  async function loadForAsset(assetId: string): Promise<void> {
    // Save current edits to cache before switching
    if (currentAssetId.value && isDirty.value) {
      saveToCache(currentAssetId.value)
    }

    currentAssetId.value = assetId
    error.value = null

    // Try to load from cache
    const cached = editCache.value.get(assetId)
    if (cached) {
      adjustments.value = { ...cached.adjustments }
      cropTransform.value = cloneCropTransform(cached.cropTransform)
      masks.value = cached.masks ? cloneMaskStack(cached.masks) : null
      selectedMaskId.value = null
      isDirty.value = false
      return
    }

    // TODO: Load from database once full persistence is implemented
    // For now, initialize with defaults
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    cropTransform.value = cloneCropTransform(DEFAULT_CROP_TRANSFORM)
    masks.value = null
    selectedMaskId.value = null
    isDirty.value = false
  }

  /**
   * Save current edit state to the in-memory cache.
   */
  function saveToCache(assetId: string): void {
    editCache.value.set(assetId, {
      version: EDIT_SCHEMA_VERSION,
      adjustments: { ...adjustments.value },
      cropTransform: cloneCropTransform(cropTransform.value),
      masks: masks.value ? cloneMaskStack(masks.value) : undefined,
    })
  }

  /**
   * Get edit state for an asset from the cache.
   * Returns null if not in cache.
   */
  function getEditStateForAsset(assetId: string): EditState | null {
    // If it's the current asset, return current state (which may be newer than cache)
    if (assetId === currentAssetId.value) {
      return {
        version: EDIT_SCHEMA_VERSION,
        adjustments: { ...adjustments.value },
        cropTransform: cloneCropTransform(cropTransform.value),
        masks: masks.value ? cloneMaskStack(masks.value) : undefined,
      }
    }
    return editCache.value.get(assetId) ?? null
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
    markDirty()
  }

  /**
   * Mark the edit state as dirty and update the cache.
   */
  function markDirty(): void {
    markDirty()
    // Update cache immediately so export always has latest edits
    if (currentAssetId.value) {
      saveToCache(currentAssetId.value)
    }
  }

  /**
   * Update multiple adjustment values at once.
   */
  function setAdjustments(updates: Partial<Adjustments>): void {
    adjustments.value = {
      ...adjustments.value,
      ...updates,
    }
    markDirty()
  }

  /**
   * Reset all adjustments to default values.
   */
  function reset(): void {
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    cropTransform.value = cloneCropTransform(DEFAULT_CROP_TRANSFORM)
    masks.value = null
    selectedMaskId.value = null
    markDirty()
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
    masks.value = null
    selectedMaskId.value = null
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
    markDirty()
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
    markDirty()
  }

  /**
   * Set crop rectangle only.
   */
  function setCrop(crop: CropRectangle | null): void {
    cropTransform.value = {
      ...cropTransform.value,
      crop: crop ? { ...crop } : null,
    }
    markDirty()
  }

  /**
   * Set rotation parameters only.
   */
  function setRotation(rotation: RotationParameters): void {
    cropTransform.value = {
      ...cropTransform.value,
      rotation: { ...rotation },
    }
    markDirty()
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
    markDirty()
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
    markDirty()
  }

  /**
   * Reset crop transform to default.
   */
  function resetCropTransform(): void {
    cropTransform.value = cloneCropTransform(DEFAULT_CROP_TRANSFORM)
    markDirty()
  }

  // ============================================================================
  // Mask Actions
  // ============================================================================

  /**
   * Add a linear gradient mask.
   */
  function addLinearMask(mask: LinearGradientMask): void {
    if (!masks.value) {
      masks.value = createDefaultMaskStack()
    }
    masks.value.linearMasks.push(cloneLinearMask(mask))
    selectedMaskId.value = mask.id
    markDirty()
  }

  /**
   * Add a radial gradient mask.
   */
  function addRadialMask(mask: RadialGradientMask): void {
    if (!masks.value) {
      masks.value = createDefaultMaskStack()
    }
    masks.value.radialMasks.push(cloneRadialMask(mask))
    selectedMaskId.value = mask.id
    markDirty()
  }

  /**
   * Update a linear mask by ID.
   */
  function updateLinearMask(id: string, updates: Partial<Omit<LinearGradientMask, 'id'>>): void {
    if (!masks.value) return

    const index = masks.value.linearMasks.findIndex(m => m.id === id)
    if (index !== -1) {
      const current = masks.value.linearMasks[index]
      masks.value.linearMasks[index] = {
        id: current.id,
        start: updates.start ?? current.start,
        end: updates.end ?? current.end,
        feather: updates.feather ?? current.feather,
        enabled: updates.enabled ?? current.enabled,
        adjustments: updates.adjustments ?? current.adjustments,
      }
      markDirty()
    }
  }

  /**
   * Update a radial mask by ID.
   */
  function updateRadialMask(id: string, updates: Partial<Omit<RadialGradientMask, 'id'>>): void {
    if (!masks.value) return

    const index = masks.value.radialMasks.findIndex(m => m.id === id)
    if (index !== -1) {
      const current = masks.value.radialMasks[index]
      masks.value.radialMasks[index] = {
        id: current.id,
        center: updates.center ?? current.center,
        radiusX: updates.radiusX ?? current.radiusX,
        radiusY: updates.radiusY ?? current.radiusY,
        rotation: updates.rotation ?? current.rotation,
        feather: updates.feather ?? current.feather,
        invert: updates.invert ?? current.invert,
        enabled: updates.enabled ?? current.enabled,
        adjustments: updates.adjustments ?? current.adjustments,
      }
      markDirty()
    }
  }

  /**
   * Delete a mask by ID.
   */
  function deleteMask(id: string): void {
    if (!masks.value) return

    const linearIndex = masks.value.linearMasks.findIndex(m => m.id === id)
    if (linearIndex !== -1) {
      masks.value.linearMasks.splice(linearIndex, 1)
    }
    else {
      const radialIndex = masks.value.radialMasks.findIndex(m => m.id === id)
      if (radialIndex !== -1) {
        masks.value.radialMasks.splice(radialIndex, 1)
      }
    }

    if (selectedMaskId.value === id) {
      selectedMaskId.value = null
    }

    markDirty()
  }

  /**
   * Toggle mask enabled state.
   */
  function toggleMaskEnabled(id: string): void {
    if (!masks.value) return

    const linearMask = masks.value.linearMasks.find(m => m.id === id)
    if (linearMask) {
      linearMask.enabled = !linearMask.enabled
      markDirty()
      return
    }

    const radialMask = masks.value.radialMasks.find(m => m.id === id)
    if (radialMask) {
      radialMask.enabled = !radialMask.enabled
      markDirty()
    }
  }

  /**
   * Select a mask by ID.
   */
  function selectMask(id: string | null): void {
    selectedMaskId.value = id
  }

  /**
   * Set adjustments for a specific mask.
   */
  function setMaskAdjustments(id: string, adjustments: MaskAdjustments): void {
    if (!masks.value) return

    const linearMask = masks.value.linearMasks.find(m => m.id === id)
    if (linearMask) {
      linearMask.adjustments = { ...adjustments }
      markDirty()
      return
    }

    const radialMask = masks.value.radialMasks.find(m => m.id === id)
    if (radialMask) {
      radialMask.adjustments = { ...adjustments }
      markDirty()
    }
  }

  /**
   * Update a single adjustment for a specific mask.
   */
  function setMaskAdjustment(id: string, key: keyof MaskAdjustments, value: number): void {
    if (!masks.value) return

    const linearMask = masks.value.linearMasks.find(m => m.id === id)
    if (linearMask) {
      linearMask.adjustments = {
        ...linearMask.adjustments,
        [key]: value,
      }
      markDirty()
      return
    }

    const radialMask = masks.value.radialMasks.find(m => m.id === id)
    if (radialMask) {
      radialMask.adjustments = {
        ...radialMask.adjustments,
        [key]: value,
      }
      markDirty()
    }
  }

  /**
   * Reset all masks.
   */
  function resetMasks(): void {
    masks.value = null
    selectedMaskId.value = null
    markDirty()
  }

  /**
   * Set the complete mask stack (e.g., from loaded state or paste).
   */
  function setMasks(maskStack: MaskStack | null): void {
    masks.value = maskStack ? cloneMaskStack(maskStack) : null
    selectedMaskId.value = null
    markDirty()
  }

  return {
    // State
    currentAssetId,
    adjustments,
    cropTransform: readonly(cropTransform),
    masks: readonly(masks),
    selectedMaskId: readonly(selectedMaskId),
    isDirty,
    isSaving,
    error,

    // Computed
    hasModifications,
    hasCurveModifications,
    hasCropTransformModifications,
    hasMaskModifications,
    selectedMask,
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

    // Mask Actions
    addLinearMask,
    addRadialMask,
    updateLinearMask,
    updateRadialMask,
    deleteMask,
    toggleMaskEnabled,
    selectMask,
    setMaskAdjustments,
    setMaskAdjustment,
    resetMasks,
    setMasks,

    // Export-related Actions
    getEditStateForAsset,
  }
})
