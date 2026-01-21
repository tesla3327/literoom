/**
 * Composable for accessing the decode service.
 *
 * Provides access to the DecodeService for decoding JPEG and RAW images.
 * The service runs in a Web Worker to keep the main thread responsive.
 *
 * @example
 * ```ts
 * const decode = useDecode()
 *
 * // Decode a JPEG
 * const image = await decode.decodeJpeg(bytes)
 *
 * // Generate a thumbnail
 * const thumb = await decode.generateThumbnail(bytes, { size: 256 })
 * ```
 */
import type { IDecodeService } from '@literoom/core'

export function useDecode(): IDecodeService {
  const { $decodeService } = useNuxtApp()

  if (!$decodeService) {
    throw new Error('DecodeService not available. Ensure decode plugin is loaded.')
  }

  return $decodeService as IDecodeService
}
