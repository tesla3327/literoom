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
  createDefaultMaskStack,
  hasModifiedAdjustments,
  isModifiedCropTransform,
  isModifiedMaskStack,
  isModifiedToneCurve,
  loadAllEditStatesFromDb,
  loadEditStateFromDb,
  migrateEditState,
  saveEditStateToDb,
} from '@literoom/core/catalog'
import type { CurvePoint, ToneCurve } from '@literoom/core/decode'
import { DEFAULT_TONE_CURVE } from '@literoom/core/decode'

export const useEditStore = defineStore('edit', () => {
  // ============================================================================
  // Helpers
  // ============================================================================

  /**
   * Find a mask by ID across both linear and radial mask arrays.
   * Returns the mask and its type, or null if not found.
   */
  function findMaskById(maskStack: MaskStack | null, id: string): {
    mask: LinearGradientMask | RadialGradientMask
    type: 'linear' | 'radial'
  } | null {
    if (!maskStack) return null

    const linearMask = maskStack.linearMasks.find(m => m.id === id)
    if (linearMask) return { mask: linearMask, type: 'linear' }

    const radialMask = maskStack.radialMasks.find(m => m.id === id)
    if (radialMask) return { mask: radialMask, type: 'radial' }

    return null
  }

  /**
   * Build an EditState object from current state values.
   */
  function buildEditState(
    adj: Adjustments,
    transform: CropTransform,
    maskStack: MaskStack | null,
  ): EditState {
    return {
      version: EDIT_SCHEMA_VERSION,
      adjustments: { ...adj },
      cropTransform: cloneCropTransform(transform),
      masks: maskStack ? cloneMaskStack(maskStack) : undefined,
    }
  }

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
   * Backed by IndexedDB for persistence across page refreshes.
   *
   * NOTE: We use shallowRef<Map> instead of ref<Map> because Vue's reactivity
   * system doesn't track Map.set() mutations. To trigger updates, we create
   * a new Map when modifying the cache.
   */
  const editCache = shallowRef<Map<string, EditState>>(new Map())

  /**
   * Whether the edit cache has been initialized from IndexedDB.
   */
  const isInitialized = ref(false)

  /**
   * Whether initialization is currently in progress.
   */
  const isInitializing = ref(false)

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Whether any edits have been modified from defaults.
   */
  const hasModifications = computed(
    () => hasModifiedAdjustments(adjustments.value)
      || isModifiedCropTransform(cropTransform.value)
      || isModifiedMaskStack(masks.value ?? undefined),
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
    if (!selectedMaskId.value) return null
    return findMaskById(masks.value, selectedMaskId.value)
  })

  /**
   * Get the full edit state object.
   */
  const editState = computed<EditState>(() =>
    buildEditState(adjustments.value, cropTransform.value, masks.value),
  )

  // ============================================================================
  // Actions
  // ============================================================================

  /**
   * Load edit state for an asset.
   * First checks the in-memory cache, then IndexedDB, then falls back to defaults.
   * Saves current edits to cache before switching.
   */
  async function loadForAsset(assetId: string): Promise<void> {
    console.log('[EditStore] loadForAsset called for:', assetId, 'isInitialized:', isInitialized.value, 'cacheSize:', editCache.value.size)
    // Save current edits to cache before switching
    if (currentAssetId.value && isDirty.value) {
      saveToCache(currentAssetId.value)
    }

    currentAssetId.value = assetId
    error.value = null

    // Try to load from in-memory cache first
    const cached = editCache.value.get(assetId)
    console.log('[EditStore] Cache lookup for', assetId, ':', cached ? 'FOUND' : 'NOT FOUND')
    if (cached) {
      console.log('[EditStore] Using cached edit state, exposure:', cached.adjustments?.exposure)
      applyEditState(cached)
      return
    }

    // Try to load from IndexedDB
    try {
      console.log('[EditStore] Checking IndexedDB for:', assetId)
      const dbRecord = await loadEditStateFromDb(assetId)
      console.log('[EditStore] IndexedDB result for', assetId, ':', dbRecord ? 'FOUND' : 'NOT FOUND')
      if (dbRecord) {
        // Migrate if needed and apply
        const migrated = migrateEditState(dbRecord.editState)
        console.log('[EditStore] Using IndexedDB edit state, exposure:', migrated.adjustments?.exposure)
        // Store in memory cache for future access
        editCache.value.set(assetId, migrated)
        applyEditState(migrated)
        return
      }
    }
    catch (err) {
      console.error('[EditStore] Failed to load from IndexedDB:', err)
      // Continue with defaults on error
    }

    // Initialize with defaults
    adjustments.value = { ...DEFAULT_ADJUSTMENTS }
    cropTransform.value = cloneCropTransform(DEFAULT_CROP_TRANSFORM)
    masks.value = null
    selectedMaskId.value = null
    isDirty.value = false
  }

  /**
   * Apply an edit state to the current reactive state.
   */
  function applyEditState(state: EditState): void {
    adjustments.value = { ...state.adjustments }
    cropTransform.value = cloneCropTransform(state.cropTransform)
    masks.value = state.masks ? cloneMaskStack(state.masks) : null
    selectedMaskId.value = null
    isDirty.value = false
  }

  /**
   * Initialize the in-memory cache from IndexedDB.
   * This should be called when the application starts up.
   * Returns the number of edit states loaded.
   */
  async function initializeFromDb(): Promise<number> {
    console.log('[EditStore] initializeFromDb called, isInitialized:', isInitialized.value, 'isInitializing:', isInitializing.value)
    if (isInitialized.value || isInitializing.value) {
      console.log('[EditStore] Already initialized/initializing, returning cache size:', editCache.value.size)
      return editCache.value.size
    }

    isInitializing.value = true

    try {
      const allEditStates = await loadAllEditStatesFromDb()
      console.log('[EditStore] Loaded', allEditStates.size, 'edit states from IndexedDB')
      let loadedCount = 0

      // Create a new Map for Vue reactivity (shallowRef doesn't track Map mutations)
      const newCache = new Map(editCache.value)

      for (const [assetUuid, rawState] of allEditStates) {
        try {
          const migrated = migrateEditState(rawState)
          newCache.set(assetUuid, migrated)
          loadedCount++
        }
        catch (err) {
          console.error(`[EditStore] Failed to migrate edit state for ${assetUuid}:`, err)
        }
      }

      // Assign new Map to trigger reactivity
      editCache.value = newCache
      isInitialized.value = true
      return loadedCount
    }
    catch (err) {
      console.error('[EditStore] Failed to initialize from IndexedDB:', err)
      // Mark as initialized even on failure to prevent infinite retry loops
      isInitialized.value = true
      return 0
    }
    finally {
      isInitializing.value = false
    }
  }

  /**
   * Save current edit state to the in-memory cache and persist to IndexedDB.
   * IndexedDB persistence is async and non-blocking.
   */
  function saveToCache(assetId: string): void {
    const state = buildEditState(adjustments.value, cropTransform.value, masks.value)

    // Update in-memory cache immediately
    // Create a new Map to trigger Vue reactivity (shallowRef doesn't track Map mutations)
    const newCache = new Map(editCache.value)
    newCache.set(assetId, state)
    editCache.value = newCache
    console.log('[EditStore] saveToCache:', assetId, 'exposure:', state.adjustments?.exposure, 'cacheSize:', newCache.size)

    // Persist to IndexedDB asynchronously (don't block the UI)
    saveEditStateToDb(assetId, state, EDIT_SCHEMA_VERSION).catch((err) => {
      console.error('[EditStore] Failed to persist edit state to IndexedDB:', err)
    })
  }

  /**
   * Get edit state for an asset from the cache.
   * Returns null if not in cache.
   */
  function getEditStateForAsset(assetId: string): EditState | null {
    // If it's the current asset, return current state (which may be newer than cache)
    if (assetId === currentAssetId.value) {
      return buildEditState(adjustments.value, cropTransform.value, masks.value)
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
    isDirty.value = true
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
      if (current) {
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
  }

  /**
   * Update a radial mask by ID.
   */
  function updateRadialMask(id: string, updates: Partial<Omit<RadialGradientMask, 'id'>>): void {
    if (!masks.value) return

    const index = masks.value.radialMasks.findIndex(m => m.id === id)
    if (index !== -1) {
      const current = masks.value.radialMasks[index]
      if (current) {
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
    const found = findMaskById(masks.value, id)
    if (found) {
      found.mask.enabled = !found.mask.enabled
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
  function setMaskAdjustments(id: string, newAdjustments: MaskAdjustments): void {
    const found = findMaskById(masks.value, id)
    if (found) {
      found.mask.adjustments = { ...newAdjustments }
      markDirty()
    }
  }

  /**
   * Update a single adjustment for a specific mask.
   */
  function setMaskAdjustment(id: string, key: keyof MaskAdjustments, value: number): void {
    const found = findMaskById(masks.value, id)
    if (found) {
      found.mask.adjustments = {
        ...found.mask.adjustments,
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
    isInitialized: readonly(isInitialized),
    isInitializing: readonly(isInitializing),

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
    initializeFromDb,

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
