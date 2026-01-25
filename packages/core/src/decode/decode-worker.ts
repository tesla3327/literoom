/**
 * Decode Worker - Handles image decoding operations in a background thread.
 *
 * This worker loads the WASM module and handles decode requests from the main
 * thread. All heavy image processing runs here to keep the UI responsive.
 *
 * The worker is initialized lazily on first request to avoid blocking initial
 * page load.
 */

// Tell TypeScript this is a Web Worker context
declare const self: DedicatedWorkerGlobalScope

// Note: Import path will be resolved by Vite at build time
import init, {
  decode_jpeg,
  decode_raw_thumbnail,
  generate_thumbnail,
  resize_to_fit,
  is_raw_file,
  apply_adjustments,
  apply_tone_curve,
  apply_rotation,
  apply_crop,
  compute_histogram,
  encode_jpeg,
  apply_masked_adjustments,
  BasicAdjustments,
  JsDecodedImage,
  JsToneCurveLut
} from 'literoom-wasm'

import type {
  DecodeRequest,
  DecodeResponse,
  DecodeSuccessResponse,
  DecodeErrorResponse,
  HistogramResponse,
  ToneCurveResponse,
  EncodeJpegResponse,
  GenerateEditedThumbnailResponse
} from './worker-messages'
import type { ErrorCode, Adjustments } from './types'
import type { MaskStackData } from './worker-messages'

/** Whether WASM module has been initialized */
let initialized = false

/** Error message if initialization failed */
let initError: string | null = null

/**
 * Initialize WASM module on first use.
 * Throws if initialization fails.
 */
async function ensureInitialized(): Promise<void> {
  if (initialized) return

  if (initError) {
    throw new Error(initError)
  }

  try {
    await init()
    initialized = true
  } catch (error) {
    initError = error instanceof Error ? error.message : String(error)
    throw error
  }
}

/**
 * Send a success response with image data.
 * Uses Transferable to avoid copying the pixel buffer.
 */
function sendSuccess(id: string, image: JsDecodedImage): void {
  const pixels = image.pixels()
  const response: DecodeSuccessResponse = {
    id,
    type: 'success',
    width: image.width,
    height: image.height,
    pixels
  }

  // Transfer the pixel buffer to avoid copying
  self.postMessage(response, [pixels.buffer])

  // Free WASM memory for the image
  image.free()
}

/**
 * Send an error response.
 */
function sendError(id: string, error: unknown, code: ErrorCode): void {
  const message = error instanceof Error ? error.message : String(error)
  const response: DecodeErrorResponse = {
    id,
    type: 'error',
    message,
    code
  }
  self.postMessage(response)
}

/**
 * Create a BasicAdjustments WASM object from a TypeScript adjustments object.
 * Caller is responsible for calling .free() on the returned object.
 */
function createWasmAdjustments(adjustments: Partial<Adjustments>): BasicAdjustments {
  const wasmAdj = new BasicAdjustments()
  wasmAdj.temperature = adjustments.temperature ?? 0
  wasmAdj.tint = adjustments.tint ?? 0
  wasmAdj.exposure = adjustments.exposure ?? 0
  wasmAdj.contrast = adjustments.contrast ?? 0
  wasmAdj.highlights = adjustments.highlights ?? 0
  wasmAdj.shadows = adjustments.shadows ?? 0
  wasmAdj.whites = adjustments.whites ?? 0
  wasmAdj.blacks = adjustments.blacks ?? 0
  wasmAdj.vibrance = adjustments.vibrance ?? 0
  wasmAdj.saturation = adjustments.saturation ?? 0
  return wasmAdj
}

/**
 * Convert a TypeScript mask adjustments object to WASM format (all fields defaulted to 0).
 */
function toWasmMaskAdjustments(adjustments: Partial<Adjustments>) {
  return {
    exposure: adjustments.exposure ?? 0,
    contrast: adjustments.contrast ?? 0,
    highlights: adjustments.highlights ?? 0,
    shadows: adjustments.shadows ?? 0,
    whites: adjustments.whites ?? 0,
    blacks: adjustments.blacks ?? 0,
    temperature: adjustments.temperature ?? 0,
    tint: adjustments.tint ?? 0,
    saturation: adjustments.saturation ?? 0,
    vibrance: adjustments.vibrance ?? 0,
  }
}

/** Linear mask type from MaskStackData */
type LinearMask = MaskStackData['linearMasks'][number]

/** Radial mask type from MaskStackData */
type RadialMask = MaskStackData['radialMasks'][number]

/**
 * Convert a linear mask to WASM format (snake_case field names).
 */
function toWasmLinearMask(m: LinearMask) {
  return {
    start_x: m.startX,
    start_y: m.startY,
    end_x: m.endX,
    end_y: m.endY,
    feather: m.feather,
    enabled: true,
    adjustments: toWasmMaskAdjustments(m.adjustments),
  }
}

/**
 * Convert a radial mask to WASM format (snake_case field names).
 */
function toWasmRadialMask(m: RadialMask) {
  return {
    center_x: m.centerX,
    center_y: m.centerY,
    radius_x: m.radiusX,
    radius_y: m.radiusY,
    rotation: m.rotation,
    feather: m.feather,
    invert: m.invert,
    enabled: true,
    adjustments: toWasmMaskAdjustments(m.adjustments),
  }
}

/**
 * Convert a mask stack to WASM format.
 */
function toWasmMaskStack(maskStack: MaskStackData) {
  return {
    linear_masks: maskStack.linearMasks.filter(m => m.enabled).map(toWasmLinearMask),
    radial_masks: maskStack.radialMasks.filter(m => m.enabled).map(toWasmRadialMask),
  }
}

/**
 * Process an output image and send a success response.
 * Extracts pixels, sends with transfer, and frees WASM memory.
 */
function sendImageSuccess(id: string, outputImage: JsDecodedImage): void {
  const outputPixels = outputImage.pixels()
  const response: DecodeSuccessResponse = {
    id,
    type: 'success',
    width: outputImage.width,
    height: outputImage.height,
    pixels: outputPixels
  }
  self.postMessage(response, [outputPixels.buffer])
  outputImage.free()
}

/**
 * Determine error code from error message.
 */
function classifyError(error: unknown): ErrorCode {
  const message = error instanceof Error ? error.message : String(error)
  const lowerMessage = message.toLowerCase()

  if (lowerMessage.includes('invalid') || lowerMessage.includes('not a valid')) {
    return 'INVALID_FORMAT'
  }
  if (lowerMessage.includes('unsupported')) {
    return 'UNSUPPORTED_FILE_TYPE'
  }
  if (lowerMessage.includes('corrupt') || lowerMessage.includes('truncated')) {
    return 'CORRUPTED_FILE'
  }
  if (lowerMessage.includes('memory') || lowerMessage.includes('alloc')) {
    return 'OUT_OF_MEMORY'
  }
  if (initError || !initialized) {
    return 'WASM_INIT_FAILED'
  }
  return 'UNKNOWN'
}

/**
 * Handle incoming decode requests.
 */
self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const request = event.data
  const { id, type } = request

  try {
    await ensureInitialized()

    switch (type) {
      case 'decode-jpeg': {
        const image = decode_jpeg(request.bytes)
        sendSuccess(id, image)
        break
      }

      case 'decode-raw-thumbnail': {
        const image = decode_raw_thumbnail(request.bytes)
        sendSuccess(id, image)
        break
      }

      case 'generate-thumbnail': {
        // First decode the image, then generate thumbnail
        // Try RAW first, fall back to JPEG
        let sourceImage: JsDecodedImage

        if (is_raw_file(request.bytes)) {
          sourceImage = decode_raw_thumbnail(request.bytes)
        } else {
          sourceImage = decode_jpeg(request.bytes)
        }

        const thumb = generate_thumbnail(sourceImage, request.size)
        sourceImage.free()
        sendSuccess(id, thumb)
        break
      }

      case 'generate-preview': {
        // First decode the image, then resize for preview
        let sourceImage: JsDecodedImage

        if (is_raw_file(request.bytes)) {
          sourceImage = decode_raw_thumbnail(request.bytes)
        } else {
          sourceImage = decode_jpeg(request.bytes)
        }

        const preview = resize_to_fit(sourceImage, request.maxEdge, request.filter)
        sourceImage.free()
        sendSuccess(id, preview)
        break
      }

      case 'detect-file-type': {
        // Quick check without full decode
        let fileType: 'jpeg' | 'raw' | 'unknown'

        if (is_raw_file(request.bytes)) {
          fileType = 'raw'
        } else if (
          request.bytes.length >= 2 &&
          request.bytes[0] === 0xff &&
          request.bytes[1] === 0xd8
        ) {
          fileType = 'jpeg'
        } else {
          fileType = 'unknown'
        }

        const response: DecodeResponse = {
          id,
          type: 'file-type',
          fileType
        }
        self.postMessage(response)
        break
      }

      case 'apply-adjustments': {
        const { pixels, width, height, adjustments } = request
        const wasmAdj = createWasmAdjustments(adjustments)
        const inputImage = new JsDecodedImage(width, height, pixels)
        const outputImage = apply_adjustments(inputImage, wasmAdj)
        inputImage.free()
        wasmAdj.free()
        sendImageSuccess(id, outputImage)
        break
      }

      case 'compute-histogram': {
        const { pixels, width, height } = request

        // Compute histogram via WASM
        const histogram = compute_histogram(pixels, width, height)

        // Extract data from WASM histogram
        const red = new Uint32Array(histogram.red())
        const green = new Uint32Array(histogram.green())
        const blue = new Uint32Array(histogram.blue())
        const luminance = new Uint32Array(histogram.luminance())
        const maxValue = histogram.max_value
        const hasHighlightClipping = histogram.has_highlight_clipping
        const hasShadowClipping = histogram.has_shadow_clipping

        // Free WASM memory
        histogram.free()

        const response: HistogramResponse = {
          id,
          type: 'histogram',
          red,
          green,
          blue,
          luminance,
          maxValue,
          hasHighlightClipping,
          hasShadowClipping
        }

        // Transfer buffers to avoid copying
        self.postMessage(response, [
          red.buffer,
          green.buffer,
          blue.buffer,
          luminance.buffer
        ])
        break
      }

      case 'apply-tone-curve': {
        const { pixels, width, height, points } = request
        const lut = new JsToneCurveLut(points)
        const inputImage = new JsDecodedImage(width, height, pixels)
        const outputImage = apply_tone_curve(inputImage, lut)
        lut.free()
        inputImage.free()

        const outputPixels = outputImage.pixels()
        const response: ToneCurveResponse = {
          id,
          type: 'tone-curve-result',
          pixels: outputPixels,
          width: outputImage.width,
          height: outputImage.height
        }
        self.postMessage(response, [outputPixels.buffer])
        outputImage.free()
        break
      }

      case 'apply-rotation': {
        const { pixels, width, height, angleDegrees, useLanczos } = request
        const inputImage = new JsDecodedImage(width, height, pixels)
        const outputImage = apply_rotation(inputImage, angleDegrees, useLanczos)
        inputImage.free()
        sendImageSuccess(id, outputImage)
        break
      }

      case 'apply-crop': {
        const { pixels, width, height, left, top, cropWidth, cropHeight } = request
        const inputImage = new JsDecodedImage(width, height, pixels)
        const outputImage = apply_crop(inputImage, left, top, cropWidth, cropHeight)
        inputImage.free()
        sendImageSuccess(id, outputImage)
        break
      }

      case 'encode-jpeg': {
        const { pixels, width, height, quality } = request

        // Encode pixels to JPEG bytes
        const jpegBytes = encode_jpeg(pixels, width, height, quality)

        const response: EncodeJpegResponse = {
          id,
          type: 'encode-jpeg-result',
          bytes: jpegBytes
        }

        // Transfer the JPEG buffer to avoid copying
        self.postMessage(response, [jpegBytes.buffer])
        break
      }

      case 'apply-masked-adjustments': {
        const { pixels, width, height, maskStack } = request
        const inputImage = new JsDecodedImage(width, height, pixels)
        const wasmMaskData = toWasmMaskStack(maskStack)
        const outputImage = apply_masked_adjustments(inputImage, wasmMaskData)
        inputImage.free()
        sendImageSuccess(id, outputImage)
        break
      }

      case 'generate-edited-thumbnail': {
        const { bytes, size, editState } = request

        // Decode source image
        let currentImage: JsDecodedImage = is_raw_file(bytes)
          ? decode_raw_thumbnail(bytes)
          : decode_jpeg(bytes)

        // Apply rotation (if any)
        if (editState.rotation) {
          const totalAngle = (editState.rotation.angle ?? 0) + (editState.rotation.straighten ?? 0)
          if (totalAngle !== 0) {
            const rotatedImage = apply_rotation(currentImage, totalAngle, false)
            currentImage.free()
            currentImage = rotatedImage
          }
        }

        // Apply crop (if any)
        if (editState.crop) {
          const croppedImage = apply_crop(
            currentImage,
            editState.crop.left,
            editState.crop.top,
            editState.crop.width,
            editState.crop.height
          )
          currentImage.free()
          currentImage = croppedImage
        }

        // Apply basic adjustments (if any)
        if (editState.adjustments) {
          const wasmAdj = createWasmAdjustments(editState.adjustments)
          const adjustedImage = apply_adjustments(currentImage, wasmAdj)
          currentImage.free()
          wasmAdj.free()
          currentImage = adjustedImage
        }

        // Apply tone curve (if any)
        if (editState.toneCurve?.points?.length) {
          const lut = new JsToneCurveLut(editState.toneCurve.points)
          const curvedImage = apply_tone_curve(currentImage, lut)
          currentImage.free()
          lut.free()
          currentImage = curvedImage
        }

        // Apply masked adjustments (if any)
        if (editState.masks) {
          const linearMasks = editState.masks.linearMasks || []
          const radialMasks = editState.masks.radialMasks || []
          if (linearMasks.length > 0 || radialMasks.length > 0) {
            const wasmMaskData = toWasmMaskStack({ linearMasks, radialMasks })
            const maskedImage = apply_masked_adjustments(currentImage, wasmMaskData)
            currentImage.free()
            currentImage = maskedImage
          }
        }

        // Resize to thumbnail size and encode to JPEG
        const resizedImage = generate_thumbnail(currentImage, size)
        currentImage.free()
        const resizedPixels = resizedImage.pixels()
        const thumbnailBytes = encode_jpeg(resizedPixels, resizedImage.width, resizedImage.height, 85)
        resizedImage.free()

        const editedThumbResponse: GenerateEditedThumbnailResponse = {
          id,
          type: 'generate-edited-thumbnail-result',
          bytes: thumbnailBytes
        }
        self.postMessage(editedThumbResponse, [thumbnailBytes.buffer])
        break
      }

      default: {
        // TypeScript exhaustiveness check
        const _exhaustive: never = type
        sendError(id, `Unknown request type: ${_exhaustive}`, 'UNKNOWN')
      }
    }
  } catch (error) {
    const code = classifyError(error)
    sendError(id, error, code)
  }
}

// Signal that worker is ready
self.postMessage({ type: 'ready' })
