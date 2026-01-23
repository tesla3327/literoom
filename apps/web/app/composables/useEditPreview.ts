/**
 * useEditPreview Composable
 *
 * Manages the preview rendering pipeline for the edit view:
 * - Loads source preview for an asset
 * - Watches for edit changes and triggers re-renders
 * - Applies transforms (rotation, crop) and adjustments via WASM decode service
 * - Implements throttling to prevent excessive renders during slider drag
 *   (first update is immediate, subsequent ones rate-limited)
 * - Provides draft/full render quality indicators
 *
 * Transform order: Rotate -> Crop -> Adjustments -> Tone Curve -> Masked Adjustments
 */
import type { Ref } from 'vue'
import type { Adjustments } from '@literoom/core/catalog'
import type { MaskStackData } from '@literoom/core/decode'
import {
  hasModifiedAdjustments,
  isModifiedToneCurve,
  isModifiedCropTransform,
  getTotalRotation,
  ThumbnailPriority,
} from '@literoom/core/catalog'
import {
  applyMaskedAdjustmentsAdaptive,
  applyRotationAdaptive,
  applyAdjustmentsAdaptive,
  applyToneCurveFromPointsAdaptive,
  getGPUEditPipeline,
  type EditPipelineParams,
  type MaskStackInput,
  type BasicAdjustments,
} from '@literoom/core/gpu'
import { useGpuStatusStore } from '~/stores/gpuStatus'

// ============================================================================
// Types
// ============================================================================

/**
 * Per-channel clipping detection flags.
 */
export interface ChannelClipping {
  r: boolean
  g: boolean
  b: boolean
}

/**
 * Clipping map data for overlay rendering.
 * Each pixel is encoded as a 6-bit field:
 * - Bit 0 (1): R shadow (R = 0)
 * - Bit 1 (2): G shadow (G = 0)
 * - Bit 2 (4): B shadow (B = 0)
 * - Bit 3 (8): R highlight (R = 255)
 * - Bit 4 (16): G highlight (G = 255)
 * - Bit 5 (32): B highlight (B = 255)
 */
export interface ClippingMap {
  /** Per-channel clipping data (6-bit encoding per pixel) */
  data: Uint8Array
  /** Width of the image */
  width: number
  /** Height of the image */
  height: number
  /** Per-channel shadow clipping presence (legacy compatibility) */
  hasShadowClipping: boolean
  /** Per-channel highlight clipping presence (legacy compatibility) */
  hasHighlightClipping: boolean
  /** Per-channel shadow clipping detection */
  shadowClipping: ChannelClipping
  /** Per-channel highlight clipping detection */
  highlightClipping: ChannelClipping
}

// Bit masks for per-channel clipping detection
export const CLIP_SHADOW_R = 1
export const CLIP_SHADOW_G = 2
export const CLIP_SHADOW_B = 4
export const CLIP_HIGHLIGHT_R = 8
export const CLIP_HIGHLIGHT_G = 16
export const CLIP_HIGHLIGHT_B = 32

export interface UseEditPreviewReturn {
  /** URL of the current preview (with edits applied when available) */
  previewUrl: Ref<string | null>
  /** Whether a render is in progress */
  isRendering: Ref<boolean>
  /** Current render quality level */
  renderQuality: Ref<'draft' | 'full'>
  /** Error message if render failed */
  error: Ref<string | null>
  /** Clipping map for overlay rendering */
  clippingMap: Ref<ClippingMap | null>
  /** Dimensions of the current preview image */
  previewDimensions: Ref<{ width: number, height: number } | null>
  /** Adjusted pixel data (RGB, 3 bytes per pixel) for histogram computation */
  adjustedPixels: Ref<Uint8Array | null>
  /** Dimensions of the adjusted pixels */
  adjustedDimensions: Ref<{ width: number, height: number } | null>
  /** Whether we're waiting for a high-quality preview to load (never show thumbnail) */
  isWaitingForPreview: Ref<boolean>
}

// ============================================================================
// Throttle Utility
// ============================================================================

/**
 * Throttle function with leading and trailing edge execution.
 * - First call executes immediately (leading edge) for responsive feel
 * - Subsequent calls during the delay period are throttled
 * - Last call is guaranteed to execute (trailing edge) to capture final value
 */
function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null
  let lastArgs: Parameters<T> | null = null
  let lastCallTime = 0

  const throttled = (...args: Parameters<T>) => {
    const now = Date.now()
    const timeSinceLastCall = now - lastCallTime

    // If enough time has passed, execute immediately (leading edge)
    if (timeSinceLastCall >= delay) {
      lastCallTime = now
      fn(...args)
      return
    }

    // Store args for trailing edge execution
    lastArgs = args

    // Schedule trailing edge if not already scheduled
    if (timeoutId === null) {
      const remainingTime = delay - timeSinceLastCall
      timeoutId = setTimeout(() => {
        timeoutId = null
        if (lastArgs !== null) {
          lastCallTime = Date.now()
          fn(...lastArgs)
          lastArgs = null
        }
      }, remainingTime)
    }
  }

  throttled.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    lastArgs = null
  }

  return throttled as T & { cancel: () => void }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert RGB pixel data (3 bytes per pixel) to RGBA (4 bytes per pixel).
 */
function rgbToRgba(rgb: Uint8Array): Uint8ClampedArray {
  const pixelCount = rgb.length / 3
  const rgba = new Uint8ClampedArray(pixelCount * 4)

  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i]! // R
    rgba[j + 1] = rgb[i + 1]! // G
    rgba[j + 2] = rgb[i + 2]! // B
    rgba[j + 3] = 255 // A (fully opaque)
  }

  return rgba
}

/**
 * Convert pixels to a blob URL for display in an <img> tag.
 */
async function pixelsToUrl(
  pixels: Uint8Array,
  width: number,
  height: number,
): Promise<string> {
  // Create canvas and draw pixels
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!

  const rgbaPixels = rgbToRgba(pixels)
  const imageData = ctx.createImageData(width, height)
  imageData.data.set(rgbaPixels)
  ctx.putImageData(imageData, 0, 0)

  // Convert to blob URL
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b)
        else reject(new Error('Failed to create blob'))
      },
      'image/jpeg',
      0.9,
    )
  })

  return URL.createObjectURL(blob)
}

/**
 * Load an image from a URL and return its pixels.
 */
async function loadImagePixels(
  url: string,
): Promise<{ pixels: Uint8Array, width: number, height: number }> {
  // Load image
  const img = new Image()
  img.crossOrigin = 'anonymous'

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = url
  })

  // Draw to canvas and extract pixels
  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(img, 0, 0)

  const imageData = ctx.getImageData(0, 0, img.width, img.height)
  const rgba = imageData.data

  // Convert RGBA to RGB
  const rgb = new Uint8Array((rgba.length / 4) * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]! // R
    rgb[j + 1] = rgba[i + 1]! // G
    rgb[j + 2] = rgba[i + 2]! // B
  }

  return { pixels: rgb, width: img.width, height: img.height }
}

/**
 * Detect clipped pixels in an RGB image with per-channel tracking.
 * Uses 6-bit encoding per pixel to track which specific channels are clipped.
 *
 * Shadow clipping: channel at 0
 * Highlight clipping: channel at 255
 *
 * @param pixels - RGB pixel data (3 bytes per pixel)
 * @param width - Image width
 * @param height - Image height
 * @returns ClippingMap with per-pixel and per-channel clipping info
 */
function detectClippedPixels(
  pixels: Uint8Array,
  width: number,
  height: number,
): ClippingMap {
  const pixelCount = width * height
  const data = new Uint8Array(pixelCount)
  const shadowClipping: ChannelClipping = { r: false, g: false, b: false }
  const highlightClipping: ChannelClipping = { r: false, g: false, b: false }

  for (let i = 0, idx = 0; i < pixels.length; i += 3, idx++) {
    const r = pixels[i]!
    const g = pixels[i + 1]!
    const b = pixels[i + 2]!
    let clipType = 0

    // Per-channel shadow clipping (channel at 0)
    if (r === 0) {
      clipType |= CLIP_SHADOW_R
      shadowClipping.r = true
    }
    if (g === 0) {
      clipType |= CLIP_SHADOW_G
      shadowClipping.g = true
    }
    if (b === 0) {
      clipType |= CLIP_SHADOW_B
      shadowClipping.b = true
    }

    // Per-channel highlight clipping (channel at 255)
    if (r === 255) {
      clipType |= CLIP_HIGHLIGHT_R
      highlightClipping.r = true
    }
    if (g === 255) {
      clipType |= CLIP_HIGHLIGHT_G
      highlightClipping.g = true
    }
    if (b === 255) {
      clipType |= CLIP_HIGHLIGHT_B
      highlightClipping.b = true
    }

    data[idx] = clipType
  }

  return {
    data,
    width,
    height,
    // Legacy compatibility
    hasShadowClipping: shadowClipping.r || shadowClipping.g || shadowClipping.b,
    hasHighlightClipping: highlightClipping.r || highlightClipping.g || highlightClipping.b,
    // Per-channel tracking
    shadowClipping,
    highlightClipping,
  }
}

// ============================================================================
// GPU Pipeline Helpers
// ============================================================================

/**
 * Convert partial mask adjustments to GPU-compatible format with defaults.
 * The catalog stores mask adjustments as Partial<Adjustments>, but GPU needs all values.
 */
function convertMaskAdjustments(adj: {
  exposure?: number
  contrast?: number
  temperature?: number
  tint?: number
  highlights?: number
  shadows?: number
  saturation?: number
  vibrance?: number
}): {
  exposure: number
  contrast: number
  temperature: number
  tint: number
  highlights: number
  shadows: number
  saturation: number
  vibrance: number
} {
  return {
    exposure: adj.exposure ?? 0,
    contrast: adj.contrast ?? 0,
    temperature: adj.temperature ?? 0,
    tint: adj.tint ?? 0,
    highlights: adj.highlights ?? 0,
    shadows: adj.shadows ?? 0,
    saturation: adj.saturation ?? 0,
    vibrance: adj.vibrance ?? 0,
  }
}

/**
 * Convert edit store masks to GPU MaskStackInput format.
 * This helper bridges the store's mask format with the GPU pipeline's expected format.
 */
function convertMasksToGPUFormat(masks: {
  readonly linearMasks: readonly {
    readonly start: { readonly x: number, readonly y: number }
    readonly end: { readonly x: number, readonly y: number }
    readonly feather: number
    readonly enabled: boolean
    readonly adjustments: {
      readonly exposure?: number
      readonly contrast?: number
      readonly temperature?: number
      readonly tint?: number
      readonly highlights?: number
      readonly shadows?: number
      readonly saturation?: number
      readonly vibrance?: number
    }
  }[]
  readonly radialMasks: readonly {
    readonly center: { readonly x: number, readonly y: number }
    readonly radiusX: number
    readonly radiusY: number
    readonly rotation: number
    readonly feather: number
    readonly invert: boolean
    readonly enabled: boolean
    readonly adjustments: {
      readonly exposure?: number
      readonly contrast?: number
      readonly temperature?: number
      readonly tint?: number
      readonly highlights?: number
      readonly shadows?: number
      readonly saturation?: number
      readonly vibrance?: number
    }
  }[]
} | null): MaskStackInput {
  return {
    linearMasks: masks?.linearMasks.map(m => ({
      startX: m.start.x,
      startY: m.start.y,
      endX: m.end.x,
      endY: m.end.y,
      feather: m.feather,
      enabled: m.enabled,
      adjustments: convertMaskAdjustments(m.adjustments),
    })) ?? [],
    radialMasks: masks?.radialMasks.map(m => ({
      centerX: m.center.x,
      centerY: m.center.y,
      radiusX: m.radiusX,
      radiusY: m.radiusY,
      rotation: m.rotation,
      feather: m.feather,
      invert: m.invert,
      enabled: m.enabled,
      adjustments: convertMaskAdjustments(m.adjustments),
    })) ?? [],
  }
}

/**
 * Convert Adjustments to BasicAdjustments format for GPU pipeline.
 * Strips the toneCurve field which is handled separately.
 */
function convertToBasicAdjustments(adjustments: Adjustments): BasicAdjustments {
  return {
    temperature: adjustments.temperature,
    tint: adjustments.tint,
    exposure: adjustments.exposure,
    contrast: adjustments.contrast,
    highlights: adjustments.highlights,
    shadows: adjustments.shadows,
    whites: adjustments.whites,
    blacks: adjustments.blacks,
    vibrance: adjustments.vibrance,
    saturation: adjustments.saturation,
  }
}

// ============================================================================
// Composable
// ============================================================================

/**
 * Composable for managing edit preview rendering.
 *
 * @param assetId - Reactive ref to the current asset ID
 * @returns Preview state and controls
 */
export function useEditPreview(assetId: Ref<string>): UseEditPreviewReturn {
  const editStore = useEditStore()
  const catalogStore = useCatalogStore()
  const { $decodeService } = useNuxtApp()

  // Only get catalog methods on client-side (catalog service is client-only)
  const catalog = import.meta.client ? useCatalog() : null

  // ============================================================================
  // State
  // ============================================================================

  /** URL of the rendered preview */
  const previewUrl = ref<string | null>(null)

  /** Whether a render is in progress */
  const isRendering = ref(false)

  /** Current render quality */
  const renderQuality = ref<'draft' | 'full'>('full')

  /** Error message if render failed */
  const error = ref<string | null>(null)

  /** Clipping map for overlay rendering */
  const clippingMap = ref<ClippingMap | null>(null)

  /** Dimensions of the current preview image */
  const previewDimensions = ref<{ width: number, height: number } | null>(null)

  /** Adjusted pixel data (RGB, 3 bytes per pixel) for histogram computation */
  const adjustedPixels = shallowRef<Uint8Array | null>(null)

  /** Dimensions of the adjusted pixels */
  const adjustedDimensions = shallowRef<{ width: number, height: number } | null>(null)

  /** Whether we're waiting for a high-quality preview to load (never show thumbnail in edit view) */
  const isWaitingForPreview = ref(false)

  /** Cached source pixels to avoid re-loading on every adjustment */
  const sourceCache = ref<{
    assetId: string
    pixels: Uint8Array
    width: number
    height: number
  } | null>(null)

  /** Generation counter to detect stale renders during rapid navigation */
  const renderGeneration = ref(0)

  /**
   * Whether the current previewUrl is locally owned (created by renderPreview)
   * vs borrowed from the store (the source thumbnail URL).
   * Only owned URLs should be revoked on unmount.
   */
  const isPreviewUrlOwned = ref(false)

  // ============================================================================
  // Computed
  // ============================================================================

  /**
   * Get source image URL for the current asset.
   * Prefers larger preview (2560px) if available, falls back to thumbnail (512px).
   */
  const sourceUrl = computed(() => {
    const asset = catalogStore.assets.get(assetId.value)
    // Prefer higher resolution preview, fall back to thumbnail
    return asset?.preview1xUrl ?? asset?.thumbnailUrl ?? null
  })

  // ============================================================================
  // Render Functions
  // ============================================================================

  /**
   * Load source pixels for an asset.
   * Prefers preview1x (2560px) over thumbnail (512px).
   * If a blob URL has been revoked (LRU eviction), re-request the image.
   */
  async function loadSource(id: string): Promise<void> {
    const asset = catalogStore.assets.get(id)
    // Prefer preview1x over thumbnail
    const url = asset?.preview1xUrl ?? asset?.thumbnailUrl

    if (!url) {
      sourceCache.value = null
      previewUrl.value = null
      return
    }

    try {
      const { pixels, width, height } = await loadImagePixels(url)
      sourceCache.value = { assetId: id, pixels, width, height }

      // Show initial preview immediately (borrowed URL from store)
      previewUrl.value = url
      isPreviewUrlOwned.value = false
    }
    catch (e) {
      console.error('Failed to load source pixels:', e)
      sourceCache.value = null

      // If the blob URL failed (likely revoked due to LRU eviction),
      // re-request from the service which will re-create it from OPFS
      if (url.startsWith('blob:') && import.meta.client && catalog) {
        console.log('[useEditPreview] Blob URL revoked, re-requesting image for:', id)
        // Determine if this was a preview or thumbnail URL
        if (asset?.preview1xUrl === url) {
          catalogStore.updatePreview(id, 'pending', null)
          catalog.requestPreview(id, 0)
        }
        else {
          catalogStore.updateThumbnail(id, 'pending', null)
          catalog.requestThumbnail(id, 0)
        }
        // The sourceUrl watcher will pick up the new URL when it's ready
        return
      }

      // Still show the image as fallback for non-blob URLs
      previewUrl.value = url
      isPreviewUrlOwned.value = false
    }
  }

  /**
   * Render the preview with current transforms and adjustments.
   *
   * Transform order: Rotate -> Crop -> Adjustments -> Tone Curve -> Masked Adjustments
   *
   * @param quality - 'draft' for fast render during drag, 'full' for high quality
   */
  async function renderPreview(quality: 'draft' | 'full'): Promise<void> {
    console.log('[useEditPreview] renderPreview called, quality:', quality)
    if (!sourceCache.value) {
      console.log('[useEditPreview] No source cache, returning early')
      return
    }

    // Don't re-render if still rendering
    if (isRendering.value) {
      console.log('[useEditPreview] Already rendering, returning early')
      return
    }

    // Capture current generation to detect stale renders
    const currentGen = renderGeneration.value

    error.value = null
    isRendering.value = true
    renderQuality.value = quality

    try {
      const { pixels, width, height, assetId: cachedId } = sourceCache.value

      // Check if asset changed while we were waiting
      if (cachedId !== assetId.value || renderGeneration.value !== currentGen) {
        console.log('[useEditPreview] Stale render detected (asset or generation changed), discarding')
        return
      }

      // Get current adjustments from store (deep clone to avoid reactive proxies)
      const adjustments: Adjustments = {
        temperature: editStore.adjustments.temperature,
        tint: editStore.adjustments.tint,
        exposure: editStore.adjustments.exposure,
        contrast: editStore.adjustments.contrast,
        highlights: editStore.adjustments.highlights,
        shadows: editStore.adjustments.shadows,
        whites: editStore.adjustments.whites,
        blacks: editStore.adjustments.blacks,
        vibrance: editStore.adjustments.vibrance,
        saturation: editStore.adjustments.saturation,
        toneCurve: {
          points: editStore.adjustments.toneCurve.points.map(p => ({ x: p.x, y: p.y })),
        },
      }

      // Check if any adjustments, transforms, or masks are non-default
      const hasAdjustments = hasModifiedAdjustments(adjustments)
      const hasTransforms = isModifiedCropTransform(editStore.cropTransform)
      // Check masks separately since editStore.masks is readonly
      const hasMasks = editStore.masks
        ? (editStore.masks.linearMasks.length > 0 || editStore.masks.radialMasks.length > 0)
        : false

      let resultUrl: string

      if (!hasAdjustments && !hasTransforms && !hasMasks) {
        // No adjustments or transforms, use source directly (borrowed URL)
        resultUrl = sourceUrl.value!
        isPreviewUrlOwned.value = false

        // Still compute clipping from source pixels
        clippingMap.value = detectClippedPixels(pixels, width, height)
        previewDimensions.value = { width, height }

        // Store source pixels as adjusted pixels (no modifications needed)
        adjustedPixels.value = pixels
        adjustedDimensions.value = { width, height }
      }
      else {
        // Apply transforms and adjustments
        // Uses unified GPU pipeline when possible for maximum performance (1 GPU round-trip)
        let currentPixels = pixels
        let currentWidth = width
        let currentHeight = height

        // Check if crop is needed (determines which GPU path to use)
        const crop = editStore.cropTransform.crop
        const totalRotation = getTotalRotation(editStore.cropTransform.rotation)
        const hasCrop = !!crop
        const hasRotation = Math.abs(totalRotation) > 0.001
        const hasToneCurve = isModifiedToneCurve(adjustments.toneCurve)

        // Try to use the unified GPU pipeline for better performance
        let usedUnifiedPipeline = false

        // Get the GPU edit pipeline (singleton)
        const gpuPipeline = getGPUEditPipeline()

        // Initialize pipeline if not ready
        let pipelineReady = gpuPipeline.isReady
        if (!pipelineReady) {
          try {
            pipelineReady = await gpuPipeline.initialize()
          }
          catch (e) {
            console.warn('[useEditPreview] GPU pipeline initialization failed:', e)
            pipelineReady = false
          }
        }

        if (pipelineReady && !hasCrop) {
          // ===== PATH A: No crop - Use unified pipeline for ALL operations =====
          // This gives us 1 GPU round-trip instead of 4
          try {
            const pipelineParams: EditPipelineParams = {}

            // Add rotation if needed
            if (hasRotation) {
              pipelineParams.rotation = totalRotation
            }

            // Add adjustments if needed
            if (hasAdjustments) {
              pipelineParams.adjustments = convertToBasicAdjustments(adjustments)
            }

            // Add tone curve if needed
            if (hasToneCurve) {
              pipelineParams.toneCurvePoints = adjustments.toneCurve.points
            }

            // Add masks if needed
            if (hasMasks && editStore.masks) {
              pipelineParams.masks = convertMasksToGPUFormat(editStore.masks)
            }

            const result = await gpuPipeline.process(
              { pixels, width, height },
              pipelineParams,
            )

            console.log(`[useEditPreview] GPU Pipeline: ${JSON.stringify(result.timing)}`)

            // Update GPU status store with timing
            const gpuStatus = useGpuStatusStore()
            gpuStatus.setRenderTiming(result.timing)

            currentPixels = result.pixels
            currentWidth = result.width
            currentHeight = result.height
            usedUnifiedPipeline = true
          }
          catch (e) {
            console.warn('[useEditPreview] GPU unified pipeline failed, falling back to sequential:', e)
            usedUnifiedPipeline = false
          }
        }
        else if (pipelineReady && hasCrop) {
          // ===== PATH B: Crop IS needed - Split into stages =====
          // Stage 1: Rotation via unified pipeline (if needed)
          // Stage 2: Crop via WASM (must happen on CPU)
          // Stage 3: Adjustments + Tone Curve + Masks via unified pipeline (without rotation)
          // This gives us 2 GPU round-trips (necessary due to crop)
          try {
            // Stage 1: Rotation only (if needed)
            if (hasRotation) {
              const rotationResult = await gpuPipeline.process(
                { pixels: currentPixels, width: currentWidth, height: currentHeight },
                { rotation: totalRotation },
              )
              console.log(`[useEditPreview] GPU Pipeline (rotation stage): ${JSON.stringify(rotationResult.timing)}`)
              currentPixels = rotationResult.pixels
              currentWidth = rotationResult.width
              currentHeight = rotationResult.height
            }

            // Stage 2: Crop via WASM (CPU operation)
            console.log('[useEditPreview] Applying crop:', crop)
            const cropped = await $decodeService.applyCrop(
              currentPixels,
              currentWidth,
              currentHeight,
              crop,
            )
            currentPixels = cropped.pixels
            currentWidth = cropped.width
            currentHeight = cropped.height

            // Stage 3: Adjustments + Tone Curve + Masks via unified pipeline
            const hasPostCropEdits = hasAdjustments || hasToneCurve || hasMasks
            if (hasPostCropEdits) {
              const postCropParams: EditPipelineParams = {}

              if (hasAdjustments) {
                postCropParams.adjustments = convertToBasicAdjustments(adjustments)
              }

              if (hasToneCurve) {
                postCropParams.toneCurvePoints = adjustments.toneCurve.points
              }

              if (hasMasks && editStore.masks) {
                postCropParams.masks = convertMasksToGPUFormat(editStore.masks)
              }

              const postCropResult = await gpuPipeline.process(
                { pixels: currentPixels, width: currentWidth, height: currentHeight },
                postCropParams,
              )
              console.log(`[useEditPreview] GPU Pipeline (post-crop stage): ${JSON.stringify(postCropResult.timing)}`)
              currentPixels = postCropResult.pixels
              currentWidth = postCropResult.width
              currentHeight = postCropResult.height
            }

            usedUnifiedPipeline = true
          }
          catch (e) {
            console.warn('[useEditPreview] GPU pipeline with crop failed, falling back to sequential:', e)
            usedUnifiedPipeline = false
            // Reset to original pixels for fallback
            currentPixels = pixels
            currentWidth = width
            currentHeight = height
          }
        }

        // ===== PATH C: Fallback - Sequential processing =====
        // Used when GPU pipeline unavailable or fails
        if (!usedUnifiedPipeline) {
          // ===== STEP 1: Apply rotation (if needed) =====
          if (hasRotation) {
            const { result: rotated, backend, timing } = await applyRotationAdaptive(
              currentPixels,
              currentWidth,
              currentHeight,
              totalRotation,
              // WASM fallback
              () => $decodeService.applyRotation(
                currentPixels, currentWidth, currentHeight,
                totalRotation,
                false, // bilinear for preview
              ),
            )
            console.log(`[useEditPreview] Rotation via ${backend} in ${timing.toFixed(1)}ms`)
            currentPixels = rotated.pixels
            currentWidth = rotated.width
            currentHeight = rotated.height
          }

          // ===== STEP 2: Apply crop (if needed) =====
          if (crop) {
            console.log('[useEditPreview] Applying crop:', crop)
            const cropped = await $decodeService.applyCrop(
              currentPixels,
              currentWidth,
              currentHeight,
              crop,
            )
            currentPixels = cropped.pixels
            currentWidth = cropped.width
            currentHeight = cropped.height
          }

          // ===== STEP 3: Apply basic adjustments (exposure, contrast, etc.) =====
          // Uses GPU-accelerated processing when available, falls back to WASM
          if (hasAdjustments) {
            const { result, backend, timing } = await applyAdjustmentsAdaptive(
              currentPixels,
              currentWidth,
              currentHeight,
              adjustments,
              // WASM fallback
              () => $decodeService.applyAdjustments(
                currentPixels, currentWidth, currentHeight, adjustments,
              ),
            )
            console.log(`[useEditPreview] Adjustments via ${backend} in ${timing.toFixed(1)}ms`)
            currentPixels = result.pixels
            currentWidth = result.width
            currentHeight = result.height
          }

          // ===== STEP 4: Apply tone curve if it differs from linear =====
          // Uses GPU-accelerated processing when available, falls back to WASM
          if (hasToneCurve) {
            const { result: curveResult, backend, timing } = await applyToneCurveFromPointsAdaptive(
              currentPixels,
              currentWidth,
              currentHeight,
              adjustments.toneCurve.points,
              // WASM fallback
              () => $decodeService.applyToneCurve(
                currentPixels, currentWidth, currentHeight, adjustments.toneCurve.points,
              ),
            )
            console.log(`[useEditPreview] Tone curve via ${backend} in ${timing.toFixed(1)}ms`)
            currentPixels = curveResult.pixels
            currentWidth = curveResult.width
            currentHeight = curveResult.height
          }

          // ===== STEP 5: Apply masked adjustments (local adjustments) =====
          // Uses GPU-accelerated processing when available, falls back to WASM
          if (hasMasks && editStore.masks) {
            const maskStack: MaskStackData = {
              linearMasks: editStore.masks.linearMasks.map(m => ({
                startX: m.start.x,
                startY: m.start.y,
                endX: m.end.x,
                endY: m.end.y,
                feather: m.feather,
                enabled: m.enabled,
                adjustments: m.adjustments,
              })),
              radialMasks: editStore.masks.radialMasks.map(m => ({
                centerX: m.center.x,
                centerY: m.center.y,
                radiusX: m.radiusX,
                radiusY: m.radiusY,
                rotation: m.rotation,
                feather: m.feather,
                invert: m.invert,
                enabled: m.enabled,
                adjustments: m.adjustments,
              })),
            }

            // Use adaptive GPU/WASM processing for masked adjustments
            const { result: maskedResult, backend, timing } = await applyMaskedAdjustmentsAdaptive(
              currentPixels,
              currentWidth,
              currentHeight,
              maskStack,
              () => $decodeService.applyMaskedAdjustments(currentPixels, currentWidth, currentHeight, maskStack),
            )
            console.log(`[useEditPreview] Masked adjustments via ${backend} in ${timing.toFixed(1)}ms`)
            currentPixels = maskedResult.pixels
            currentWidth = maskedResult.width
            currentHeight = maskedResult.height
          }
        }

        // ===== STEP 6: Detect clipping for overlay =====
        clippingMap.value = detectClippedPixels(currentPixels, currentWidth, currentHeight)
        previewDimensions.value = { width: currentWidth, height: currentHeight }

        // ===== STEP 7: Store adjusted pixels for histogram =====
        adjustedPixels.value = currentPixels
        adjustedDimensions.value = { width: currentWidth, height: currentHeight }

        // Convert result to blob URL
        resultUrl = await pixelsToUrl(currentPixels, currentWidth, currentHeight)

        // Revoke old URL if it was owned (created by us, not borrowed from store)
        if (previewUrl.value && previewUrl.value.startsWith('blob:') && isPreviewUrlOwned.value) {
          URL.revokeObjectURL(previewUrl.value)
        }

        // Mark this new URL as owned
        isPreviewUrlOwned.value = true
      }

      // Check again if asset or generation changed (stale render protection)
      if (cachedId !== assetId.value || renderGeneration.value !== currentGen) {
        // Asset or generation changed, discard result
        console.log('[useEditPreview] Discarding stale render result')
        if (resultUrl.startsWith('blob:')) {
          URL.revokeObjectURL(resultUrl)
        }
        return
      }

      previewUrl.value = resultUrl
    }
    catch (e) {
      // Only update error state if still on same generation
      if (renderGeneration.value === currentGen) {
        error.value = e instanceof Error ? e.message : 'Failed to render preview'
        console.error('[useEditPreview] Render error:', e)
      }
    }
    finally {
      isRendering.value = false
      renderQuality.value = 'full'
    }
  }

  /**
   * Throttled render for use during slider drag.
   * First update is immediate, subsequent updates throttled to 150ms.
   */
  const throttledRender = throttle(() => {
    renderPreview('draft')
  }, 150)

  // ============================================================================
  // Watchers
  // ============================================================================

  /**
   * Watch for adjustment changes and trigger throttled render.
   * Deep watch to catch individual slider changes.
   */
  watch(
    () => editStore.adjustments,
    () => {
      if (sourceCache.value) {
        throttledRender()
      }
    },
    { deep: true },
  )

  /**
   * Watch for crop/transform changes and trigger throttled render.
   * Deep watch to catch rotation and crop region changes.
   */
  watch(
    () => editStore.cropTransform,
    () => {
      if (sourceCache.value) {
        throttledRender()
      }
    },
    { deep: true },
  )

  /**
   * Watch for mask changes and trigger throttled render.
   * Deep watch to catch mask position, adjustments, and enabled state changes.
   */
  watch(
    () => editStore.masks,
    () => {
      if (sourceCache.value) {
        throttledRender()
      }
    },
    { deep: true },
  )

  /**
   * Watch for asset changes and immediately load new source.
   * Uses generation counter to prevent stale updates during rapid navigation.
   *
   * IMPORTANT: Edit view should NEVER show the small thumbnail (512px).
   * We wait for the high-quality preview (2560px) to be ready before displaying.
   * If preview is already cached, display immediately (no loading flash).
   */
  watch(
    assetId,
    async (id) => {
      // Increment generation to invalidate pending operations
      renderGeneration.value++
      const currentGen = renderGeneration.value

      // Cancel any pending throttled renders
      throttledRender.cancel()

      // Reset state
      error.value = null
      sourceCache.value = null

      if (!id) {
        previewUrl.value = null
        isPreviewUrlOwned.value = false
        isWaitingForPreview.value = false
        return
      }

      // Request generation for edit view
      // This ensures we have images even if navigating directly to edit view
      // Only run on client (catalog service is client-only)
      if (import.meta.client && catalog) {
        // In edit view, preview is the primary display (2560px) - highest priority
        // Thumbnail is only needed as fallback (512px) - lower priority
        catalog.requestPreview(id, ThumbnailPriority.VISIBLE) // Priority 0 - highest
        catalog.requestThumbnail(id, ThumbnailPriority.PRELOAD) // Priority 2 - lower
      }

      // Check if preview is already available (cached)
      const asset = catalogStore.assets.get(id)
      const cachedPreviewUrl = asset?.preview1xStatus === 'ready' && asset.preview1xUrl
        ? asset.preview1xUrl
        : null

      if (!cachedPreviewUrl) {
        // Preview not ready - show loading state, NEVER show thumbnail in edit view
        console.log('[useEditPreview] Waiting for preview to generate for:', id)
        previewUrl.value = null
        isWaitingForPreview.value = true
        return // The preview status watcher will handle loading when ready
      }

      // Preview is cached - but don't show it yet if there are edits to apply
      // This prevents the "flash of unedited image" when returning to edit view
      console.log('[useEditPreview] Preview cached, checking for edits:', id)
      isWaitingForPreview.value = false

      try {
        // Load source pixels in background
        await loadSource(id)

        // Check generation before proceeding (stale protection)
        if (renderGeneration.value !== currentGen) {
          console.log('[useEditPreview] Asset watcher: generation changed, discarding')
          return
        }

        // Wait a tick for edit store to finish loading (it runs concurrently)
        await nextTick()

        // Check generation again after tick
        if (renderGeneration.value !== currentGen) {
          return
        }

        // Render with current adjustments if any
        if (sourceCache.value && editStore.hasModifications) {
          await renderPreview('full')
        }
        else {
          // No modifications - safe to show the unedited preview
          console.log('[useEditPreview] No modifications, showing unedited preview')
          previewUrl.value = cachedPreviewUrl
          isPreviewUrlOwned.value = false
        }
      }
      catch (err) {
        // Only update error if still on same generation
        if (renderGeneration.value === currentGen) {
          error.value = err instanceof Error ? err.message : 'Failed to load preview'
          isRendering.value = false
          console.error('[useEditPreview] Asset load error:', err)
        }
      }
    },
    { immediate: true },
  )

  /**
   * Watch for preview URL becoming available (when preview generation completes).
   * This handles the case where we're waiting for the high-quality preview.
   */
  watch(
    () => {
      const asset = catalogStore.assets.get(assetId.value)
      return asset?.preview1xUrl
    },
    async (newUrl) => {
      if (newUrl && isWaitingForPreview.value) {
        console.log('[useEditPreview] Preview ready, loading:', newUrl)
        const currentGen = renderGeneration.value

        // Preview is ready - but don't show yet, wait to check for edits
        isWaitingForPreview.value = false

        try {
          await loadSource(assetId.value)

          // Check generation before proceeding
          if (renderGeneration.value !== currentGen) {
            return
          }

          // Wait a tick for edit store to finish loading
          await nextTick()

          if (renderGeneration.value !== currentGen) {
            return
          }

          // Render with current adjustments after loading
          if (sourceCache.value && editStore.hasModifications) {
            await renderPreview('full')
          }
          else {
            // No modifications - safe to show the unedited preview
            previewUrl.value = newUrl
            isPreviewUrlOwned.value = false
          }
        }
        catch (err) {
          if (renderGeneration.value === currentGen) {
            error.value = err instanceof Error ? err.message : 'Failed to load preview'
            isRendering.value = false
            console.error('[useEditPreview] Preview load error:', err)
          }
        }
      }
    },
  )

  /**
   * Watch for preview generation errors.
   * If preview fails, fall back to thumbnail with a warning message.
   */
  watch(
    () => {
      const asset = catalogStore.assets.get(assetId.value)
      return asset?.preview1xStatus
    },
    async (status) => {
      if (status === 'error' && isWaitingForPreview.value) {
        console.log('[useEditPreview] Preview generation failed, falling back to thumbnail')
        const asset = catalogStore.assets.get(assetId.value)
        const currentGen = renderGeneration.value

        if (asset?.thumbnailUrl) {
          isWaitingForPreview.value = false
          error.value = 'Preview generation failed, showing thumbnail'

          try {
            await loadSource(assetId.value)

            // Check generation before proceeding
            if (renderGeneration.value !== currentGen) {
              return
            }

            // Wait a tick for edit store to finish loading
            await nextTick()

            if (renderGeneration.value !== currentGen) {
              return
            }

            // Render with current adjustments after loading
            if (sourceCache.value && editStore.hasModifications) {
              await renderPreview('full')
            }
            else {
              // No modifications - safe to show the unedited thumbnail
              previewUrl.value = asset.thumbnailUrl
              isPreviewUrlOwned.value = false
            }
          }
          catch (err) {
            if (renderGeneration.value === currentGen) {
              console.error('[useEditPreview] Thumbnail fallback load error:', err)
            }
          }
        }
        else {
          // No thumbnail either, show error state
          isWaitingForPreview.value = false
          error.value = 'Failed to generate preview'
        }
      }
    },
  )

  /**
   * Watch for source URL changes (e.g., when thumbnail loads after request).
   * This handles the case where we navigate to edit view before thumbnail is ready.
   * Note: In edit view, this is primarily for the preview URL, not thumbnail.
   */
  watch(
    sourceUrl,
    async (url) => {
      // Skip if we're waiting for preview (preview watcher will handle it)
      if (isWaitingForPreview.value) return
      if (!url || sourceCache.value) return

      const currentGen = renderGeneration.value

      try {
        await loadSource(assetId.value)

        // Check generation before proceeding
        if (renderGeneration.value !== currentGen) {
          return
        }

        // Render with current adjustments after loading
        if (sourceCache.value) {
          await renderPreview('full')
        }
      }
      catch (err) {
        if (renderGeneration.value === currentGen) {
          error.value = err instanceof Error ? err.message : 'Failed to load source'
          isRendering.value = false
          console.error('[useEditPreview] Source load error:', err)
        }
      }
    },
  )

  // ============================================================================
  // Cleanup
  // ============================================================================

  onUnmounted(() => {
    throttledRender.cancel()
    // Only revoke blob URL if we created it (owned), not if it's borrowed from the store
    if (previewUrl.value && previewUrl.value.startsWith('blob:') && isPreviewUrlOwned.value) {
      URL.revokeObjectURL(previewUrl.value)
    }
  })

  return {
    previewUrl,
    isRendering,
    renderQuality,
    error,
    clippingMap,
    previewDimensions,
    adjustedPixels,
    adjustedDimensions,
    isWaitingForPreview,
  }
}
