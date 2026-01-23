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
import type { ErrorCode } from './types'

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

        // Create BasicAdjustments instance and set values
        const wasmAdj = new BasicAdjustments()
        wasmAdj.temperature = adjustments.temperature
        wasmAdj.tint = adjustments.tint
        wasmAdj.exposure = adjustments.exposure
        wasmAdj.contrast = adjustments.contrast
        wasmAdj.highlights = adjustments.highlights
        wasmAdj.shadows = adjustments.shadows
        wasmAdj.whites = adjustments.whites
        wasmAdj.blacks = adjustments.blacks
        wasmAdj.vibrance = adjustments.vibrance
        wasmAdj.saturation = adjustments.saturation

        // Create input image from pixels
        const inputImage = new JsDecodedImage(width, height, pixels)

        // Apply adjustments (returns new image)
        const outputImage = apply_adjustments(inputImage, wasmAdj)
        const outputPixels = outputImage.pixels()
        const outputWidth = outputImage.width
        const outputHeight = outputImage.height

        // Free WASM memory
        inputImage.free()
        wasmAdj.free()

        const response: DecodeSuccessResponse = {
          id,
          type: 'success',
          width: outputWidth,
          height: outputHeight,
          pixels: outputPixels
        }

        // Transfer the pixel buffer to avoid copying
        self.postMessage(response, [outputPixels.buffer])

        // Free output image WASM memory
        outputImage.free()
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

        // Create LUT from curve points
        const lut = new JsToneCurveLut(points)

        // Create image wrapper
        const inputImage = new JsDecodedImage(width, height, pixels)

        // Apply tone curve
        const outputImage = apply_tone_curve(inputImage, lut)

        // Extract result
        const outputPixels = outputImage.pixels()
        const outputWidth = outputImage.width
        const outputHeight = outputImage.height

        // Free WASM memory
        lut.free()
        inputImage.free()

        const response: ToneCurveResponse = {
          id,
          type: 'tone-curve-result',
          pixels: outputPixels,
          width: outputWidth,
          height: outputHeight
        }

        // Transfer pixel buffer to avoid copying
        self.postMessage(response, [outputPixels.buffer])

        // Free output image WASM memory
        outputImage.free()
        break
      }

      case 'apply-rotation': {
        const { pixels, width, height, angleDegrees, useLanczos } = request

        // Create image wrapper
        const inputImage = new JsDecodedImage(width, height, pixels)

        // Apply rotation
        const outputImage = apply_rotation(inputImage, angleDegrees, useLanczos)

        // Extract result
        const outputPixels = outputImage.pixels()
        const outputWidth = outputImage.width
        const outputHeight = outputImage.height

        // Free WASM memory
        inputImage.free()

        const response: DecodeSuccessResponse = {
          id,
          type: 'success',
          pixels: outputPixels,
          width: outputWidth,
          height: outputHeight
        }

        // Transfer pixel buffer to avoid copying
        self.postMessage(response, [outputPixels.buffer])

        // Free output image WASM memory
        outputImage.free()
        break
      }

      case 'apply-crop': {
        const { pixels, width, height, left, top, cropWidth, cropHeight } = request

        // Create image wrapper
        const inputImage = new JsDecodedImage(width, height, pixels)

        // Apply crop using normalized coordinates
        const outputImage = apply_crop(inputImage, left, top, cropWidth, cropHeight)

        // Extract result
        const outputPixels = outputImage.pixels()
        const outputWidth = outputImage.width
        const outputHeight = outputImage.height

        // Free WASM memory
        inputImage.free()

        const response: DecodeSuccessResponse = {
          id,
          type: 'success',
          pixels: outputPixels,
          width: outputWidth,
          height: outputHeight
        }

        // Transfer pixel buffer to avoid copying
        self.postMessage(response, [outputPixels.buffer])

        // Free output image WASM memory
        outputImage.free()
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

        // Create input image from pixels
        const inputImage = new JsDecodedImage(width, height, pixels)

        // Convert mask stack to WASM format
        // The WASM function expects snake_case field names
        const wasmMaskData = {
          linear_masks: maskStack.linearMasks
            .filter(m => m.enabled)
            .map(m => ({
              start_x: m.startX,
              start_y: m.startY,
              end_x: m.endX,
              end_y: m.endY,
              feather: m.feather,
              enabled: true,
              adjustments: {
                exposure: m.adjustments.exposure ?? 0,
                contrast: m.adjustments.contrast ?? 0,
                highlights: m.adjustments.highlights ?? 0,
                shadows: m.adjustments.shadows ?? 0,
                whites: m.adjustments.whites ?? 0,
                blacks: m.adjustments.blacks ?? 0,
                temperature: m.adjustments.temperature ?? 0,
                tint: m.adjustments.tint ?? 0,
                saturation: m.adjustments.saturation ?? 0,
                vibrance: m.adjustments.vibrance ?? 0,
              },
            })),
          radial_masks: maskStack.radialMasks
            .filter(m => m.enabled)
            .map(m => ({
              center_x: m.centerX,
              center_y: m.centerY,
              radius_x: m.radiusX,
              radius_y: m.radiusY,
              rotation: m.rotation, // WASM converts degrees to radians
              feather: m.feather,
              invert: m.invert,
              enabled: true,
              adjustments: {
                exposure: m.adjustments.exposure ?? 0,
                contrast: m.adjustments.contrast ?? 0,
                highlights: m.adjustments.highlights ?? 0,
                shadows: m.adjustments.shadows ?? 0,
                whites: m.adjustments.whites ?? 0,
                blacks: m.adjustments.blacks ?? 0,
                temperature: m.adjustments.temperature ?? 0,
                tint: m.adjustments.tint ?? 0,
                saturation: m.adjustments.saturation ?? 0,
                vibrance: m.adjustments.vibrance ?? 0,
              },
            })),
        }

        // Apply masked adjustments (returns new image)
        const outputImage = apply_masked_adjustments(inputImage, wasmMaskData)
        const outputPixels = outputImage.pixels()
        const outputWidth = outputImage.width
        const outputHeight = outputImage.height

        // Free WASM memory
        inputImage.free()

        const maskedResponse: DecodeSuccessResponse = {
          id,
          type: 'success',
          width: outputWidth,
          height: outputHeight,
          pixels: outputPixels
        }

        // Transfer the pixel buffer to avoid copying
        self.postMessage(maskedResponse, [outputPixels.buffer])

        // Free output image WASM memory
        outputImage.free()
        break
      }

      case 'generate-edited-thumbnail': {
        const { bytes, size, editState } = request

        // Step 1: Decode source image
        let currentImage: JsDecodedImage
        if (is_raw_file(bytes)) {
          currentImage = decode_raw_thumbnail(bytes)
        } else {
          currentImage = decode_jpeg(bytes)
        }

        // Step 2: Apply rotation (if any)
        if (editState.rotation) {
          const totalAngle =
            (editState.rotation.angle ?? 0) + (editState.rotation.straighten ?? 0)
          if (totalAngle !== 0) {
            const rotatedImage = apply_rotation(currentImage, totalAngle, false) // bilinear for speed
            currentImage.free()
            currentImage = rotatedImage
          }
        }

        // Step 3: Apply crop (if any)
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

        // Step 4: Apply basic adjustments (if any)
        if (editState.adjustments) {
          const wasmAdj = new BasicAdjustments()
          wasmAdj.temperature = editState.adjustments.temperature ?? 0
          wasmAdj.tint = editState.adjustments.tint ?? 0
          wasmAdj.exposure = editState.adjustments.exposure ?? 0
          wasmAdj.contrast = editState.adjustments.contrast ?? 0
          wasmAdj.highlights = editState.adjustments.highlights ?? 0
          wasmAdj.shadows = editState.adjustments.shadows ?? 0
          wasmAdj.whites = editState.adjustments.whites ?? 0
          wasmAdj.blacks = editState.adjustments.blacks ?? 0
          wasmAdj.vibrance = editState.adjustments.vibrance ?? 0
          wasmAdj.saturation = editState.adjustments.saturation ?? 0

          const adjustedImage = apply_adjustments(currentImage, wasmAdj)
          currentImage.free()
          wasmAdj.free()
          currentImage = adjustedImage
        }

        // Step 5: Apply tone curve (if any)
        if (editState.toneCurve && editState.toneCurve.points && editState.toneCurve.points.length > 0) {
          const lut = new JsToneCurveLut(editState.toneCurve.points)
          const curvedImage = apply_tone_curve(currentImage, lut)
          currentImage.free()
          lut.free()
          currentImage = curvedImage
        }

        // Step 6: Apply masked adjustments (if any)
        if (editState.masks) {
          const hasEnabledMasks =
            (editState.masks.linearMasks?.length ?? 0) > 0 ||
            (editState.masks.radialMasks?.length ?? 0) > 0

          if (hasEnabledMasks) {
            const wasmMaskData = {
              linear_masks: (editState.masks.linearMasks || [])
                .filter(m => m.enabled)
                .map(m => ({
                  start_x: m.startX,
                  start_y: m.startY,
                  end_x: m.endX,
                  end_y: m.endY,
                  feather: m.feather,
                  enabled: true,
                  adjustments: {
                    exposure: m.adjustments.exposure ?? 0,
                    contrast: m.adjustments.contrast ?? 0,
                    highlights: m.adjustments.highlights ?? 0,
                    shadows: m.adjustments.shadows ?? 0,
                    whites: m.adjustments.whites ?? 0,
                    blacks: m.adjustments.blacks ?? 0,
                    temperature: m.adjustments.temperature ?? 0,
                    tint: m.adjustments.tint ?? 0,
                    saturation: m.adjustments.saturation ?? 0,
                    vibrance: m.adjustments.vibrance ?? 0,
                  },
                })),
              radial_masks: (editState.masks.radialMasks || [])
                .filter(m => m.enabled)
                .map(m => ({
                  center_x: m.centerX,
                  center_y: m.centerY,
                  radius_x: m.radiusX,
                  radius_y: m.radiusY,
                  rotation: m.rotation,
                  feather: m.feather,
                  invert: m.invert,
                  enabled: true,
                  adjustments: {
                    exposure: m.adjustments.exposure ?? 0,
                    contrast: m.adjustments.contrast ?? 0,
                    highlights: m.adjustments.highlights ?? 0,
                    shadows: m.adjustments.shadows ?? 0,
                    whites: m.adjustments.whites ?? 0,
                    blacks: m.adjustments.blacks ?? 0,
                    temperature: m.adjustments.temperature ?? 0,
                    tint: m.adjustments.tint ?? 0,
                    saturation: m.adjustments.saturation ?? 0,
                    vibrance: m.adjustments.vibrance ?? 0,
                  },
                })),
            }

            const maskedImage = apply_masked_adjustments(currentImage, wasmMaskData)
            currentImage.free()
            currentImage = maskedImage
          }
        }

        // Step 7: Resize to thumbnail size
        const resizedImage = generate_thumbnail(currentImage, size)
        currentImage.free()

        // Step 8: Encode to JPEG
        const resizedPixels = resizedImage.pixels()
        const thumbnailBytes = encode_jpeg(
          resizedPixels,
          resizedImage.width,
          resizedImage.height,
          85 // JPEG quality for thumbnails
        )

        resizedImage.free()

        const editedThumbResponse: GenerateEditedThumbnailResponse = {
          id,
          type: 'generate-edited-thumbnail-result',
          bytes: thumbnailBytes
        }

        // Transfer the JPEG buffer to avoid copying
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
