/// <reference types="@webgpu/types" />
/**
 * GPU texture utilities for image data transfer.
 *
 * Provides helpers for:
 * - Creating textures from pixel data
 * - Reading pixels back from textures
 * - Texture pool management for reuse
 */

/**
 * WebGPU alignment constant for buffer operations.
 * bytesPerRow must be a multiple of this value for copyTextureToBuffer.
 */
export const WEBGPU_BYTES_PER_ROW_ALIGNMENT = 256

/**
 * Align a value to the next multiple of 256.
 * WebGPU requires bytesPerRow to be a multiple of 256 for texture copies.
 */
export function alignTo256(value: number): number {
  return Math.ceil(value / 256) * 256
}

/**
 * Remove row padding from texture readback data.
 *
 * When bytesPerRow is padded for alignment, the buffer contains
 * extra padding bytes at the end of each row that need to be removed.
 *
 * @param paddedData - Buffer with padded rows
 * @param width - Actual image width in pixels
 * @param height - Image height in rows
 * @param alignedBytesPerRow - Padded bytes per row (multiple of 256)
 * @returns Uint8Array with padding removed
 */
export function removeRowPadding(
  paddedData: Uint8Array,
  width: number,
  height: number,
  alignedBytesPerRow: number
): Uint8Array {
  const actualBytesPerRow = width * 4

  // If no padding needed, return as-is
  if (alignedBytesPerRow === actualBytesPerRow) {
    return paddedData
  }

  // Strip padding from each row
  const result = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const srcOffset = y * alignedBytesPerRow
    const dstOffset = y * actualBytesPerRow
    result.set(
      paddedData.subarray(srcOffset, srcOffset + actualBytesPerRow),
      dstOffset
    )
  }
  return result
}

/**
 * Texture usage flags for common operations.
 * Uses lazy evaluation to avoid accessing GPUTextureUsage at module load time,
 * which would fail in environments without WebGPU (e.g., Node.js tests).
 */
export const TextureUsage = {
  /** For use as input to shaders */
  get INPUT(): GPUTextureUsageFlags {
    return (
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC
    )
  },
  /** For use as output from compute shaders */
  get OUTPUT(): GPUTextureUsageFlags {
    return (
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_SRC |
      GPUTextureUsage.TEXTURE_BINDING
    )
  },
  /** For use as both input and output (ping-pong) */
  get PINGPONG(): GPUTextureUsageFlags {
    return (
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.STORAGE_BINDING |
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.COPY_SRC
    )
  },
} as const

/**
 * Create a texture and upload pixel data.
 *
 * @param device - GPU device
 * @param pixels - RGBA pixel data (Uint8Array)
 * @param width - Image width
 * @param height - Image height
 * @param usage - Texture usage flags
 * @param label - Optional label for debugging
 * @returns Created texture
 */
export function createTextureFromPixels(
  device: GPUDevice,
  pixels: Uint8Array,
  width: number,
  height: number,
  usage: GPUTextureUsageFlags = TextureUsage.INPUT,
  label?: string
): GPUTexture {
  const texture = device.createTexture({
    label: label ?? `Texture ${width}x${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage,
  })

  device.queue.writeTexture(
    { texture },
    pixels.buffer,
    { bytesPerRow: width * 4, rowsPerImage: height, offset: pixels.byteOffset },
    { width, height, depthOrArrayLayers: 1 }
  )

  return texture
}

/**
 * Create an empty texture for output.
 *
 * @param device - GPU device
 * @param width - Image width
 * @param height - Image height
 * @param usage - Texture usage flags
 * @param label - Optional label for debugging
 * @returns Created texture
 */
export function createOutputTexture(
  device: GPUDevice,
  width: number,
  height: number,
  usage: GPUTextureUsageFlags = TextureUsage.OUTPUT,
  label?: string
): GPUTexture {
  return device.createTexture({
    label: label ?? `Output Texture ${width}x${height}`,
    size: { width, height, depthOrArrayLayers: 1 },
    format: 'rgba8unorm',
    usage,
  })
}

/**
 * Read pixel data from a texture.
 *
 * @param device - GPU device
 * @param texture - Texture to read from
 * @param width - Image width
 * @param height - Image height
 * @returns RGBA pixel data
 */
export async function readTexturePixels(
  device: GPUDevice,
  texture: GPUTexture,
  width: number,
  height: number
): Promise<Uint8Array> {
  const actualBytesPerRow = width * 4
  const alignedBytesPerRow = alignTo256(actualBytesPerRow)
  const bufferSize = alignedBytesPerRow * height

  // Create staging buffer for readback
  const stagingBuffer = device.createBuffer({
    label: 'Texture Readback Staging Buffer',
    size: bufferSize,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  })

  // Create command encoder and copy texture to buffer
  const encoder = device.createCommandEncoder({
    label: 'Texture Readback Encoder',
  })

  encoder.copyTextureToBuffer(
    { texture },
    { buffer: stagingBuffer, bytesPerRow: alignedBytesPerRow, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 }
  )

  device.queue.submit([encoder.finish()])

  // Wait for GPU and read data
  await stagingBuffer.mapAsync(GPUMapMode.READ)
  const paddedData = new Uint8Array(stagingBuffer.getMappedRange()).slice()
  stagingBuffer.unmap()

  // Cleanup
  stagingBuffer.destroy()

  // Remove padding if needed
  return removeRowPadding(paddedData, width, height, alignedBytesPerRow)
}

/**
 * Texture pool for reusing textures.
 *
 * Reduces allocation overhead when processing multiple images
 * of the same size.
 */
export class TexturePool {
  private device: GPUDevice
  private pools = new Map<string, GPUTexture[]>()
  private maxPoolSize: number

  constructor(device: GPUDevice, maxPoolSize: number = 4) {
    this.device = device
    this.maxPoolSize = maxPoolSize
  }

  /**
   * Get a key for pooling textures of the same specification.
   */
  private getKey(
    width: number,
    height: number,
    usage: GPUTextureUsageFlags
  ): string {
    return `${width}x${height}:${usage}`
  }

  /**
   * Acquire a texture from the pool or create a new one.
   */
  acquire(
    width: number,
    height: number,
    usage: GPUTextureUsageFlags,
    label?: string
  ): GPUTexture {
    const key = this.getKey(width, height, usage)
    const pool = this.pools.get(key)

    if (pool && pool.length > 0) {
      return pool.pop()!
    }

    return this.device.createTexture({
      label: label ?? `Pooled Texture ${width}x${height}`,
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage,
    })
  }

  /**
   * Release a texture back to the pool.
   */
  release(
    texture: GPUTexture,
    width: number,
    height: number,
    usage: GPUTextureUsageFlags
  ): void {
    const key = this.getKey(width, height, usage)
    let pool = this.pools.get(key)

    if (!pool) {
      pool = []
      this.pools.set(key, pool)
    }

    if (pool.length < this.maxPoolSize) {
      pool.push(texture)
    } else {
      texture.destroy()
    }
  }

  /**
   * Clear all pooled textures.
   */
  clear(): void {
    for (const pool of this.pools.values()) {
      for (const texture of pool) {
        texture.destroy()
      }
    }
    this.pools.clear()
  }

  /**
   * Get statistics about the pool.
   */
  getStats(): { poolCount: number; totalTextures: number } {
    let totalTextures = 0
    for (const pool of this.pools.values()) {
      totalTextures += pool.length
    }
    return {
      poolCount: this.pools.size,
      totalTextures,
    }
  }
}

/**
 * Buffer pool for reusing staging buffers.
 */
export class BufferPool {
  private device: GPUDevice
  private pools = new Map<number, GPUBuffer[]>()
  private maxPoolSize: number

  constructor(device: GPUDevice, maxPoolSize: number = 4) {
    this.device = device
    this.maxPoolSize = maxPoolSize
  }

  /**
   * Acquire a buffer from the pool or create a new one.
   */
  acquire(size: number, usage: GPUBufferUsageFlags, label?: string): GPUBuffer {
    const key = size
    const pool = this.pools.get(key)

    if (pool && pool.length > 0) {
      return pool.pop()!
    }

    return this.device.createBuffer({
      label: label ?? `Pooled Buffer ${size}`,
      size,
      usage,
    })
  }

  /**
   * Release a buffer back to the pool.
   */
  release(buffer: GPUBuffer, size: number): void {
    const key = size
    let pool = this.pools.get(key)

    if (!pool) {
      pool = []
      this.pools.set(key, pool)
    }

    if (pool.length < this.maxPoolSize) {
      pool.push(buffer)
    } else {
      buffer.destroy()
    }
  }

  /**
   * Clear all pooled buffers.
   */
  clear(): void {
    for (const pool of this.pools.values()) {
      for (const buffer of pool) {
        buffer.destroy()
      }
    }
    this.pools.clear()
  }
}

/**
 * Double-buffered texture pair for ping-pong rendering.
 */
export class DoubleBufferedTextures {
  private textures: [GPUTexture, GPUTexture]
  private currentIndex = 0

  constructor(device: GPUDevice, width: number, height: number, label?: string) {
    const usage = TextureUsage.PINGPONG

    this.textures = [
      device.createTexture({
        label: `${label ?? 'PingPong'} A`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: 'rgba8unorm',
        usage,
      }),
      device.createTexture({
        label: `${label ?? 'PingPong'} B`,
        size: { width, height, depthOrArrayLayers: 1 },
        format: 'rgba8unorm',
        usage,
      }),
    ]
  }

  /**
   * Get the current input texture (source).
   */
  getCurrent(): GPUTexture {
    const texture = this.textures[this.currentIndex]
    if (!texture) {
      throw new Error(`Invalid texture index: ${this.currentIndex}`)
    }
    return texture
  }

  /**
   * Get the other texture (destination).
   */
  getNext(): GPUTexture {
    const nextIndex = 1 - this.currentIndex
    const texture = this.textures[nextIndex as 0 | 1]
    if (!texture) {
      throw new Error(`Invalid texture index: ${nextIndex}`)
    }
    return texture
  }

  /**
   * Swap the textures (after a render pass).
   */
  swap(): void {
    this.currentIndex = 1 - this.currentIndex
  }

  /**
   * Reset to initial state.
   */
  reset(): void {
    this.currentIndex = 0
  }

  /**
   * Destroy both textures.
   */
  destroy(): void {
    this.textures[0].destroy()
    this.textures[1].destroy()
  }
}

/**
 * Calculate workgroup dispatch dimensions.
 *
 * @param width - Image width
 * @param height - Image height
 * @param workgroupSize - Size of workgroup (default 16x16)
 * @returns Dispatch dimensions [x, y, z]
 */
export function calculateDispatchSize(
  width: number,
  height: number,
  workgroupSize: number = 16
): [number, number, number] {
  return [
    Math.ceil(width / workgroupSize),
    Math.ceil(height / workgroupSize),
    1,
  ]
}

// ============================================================================
// Pixel Format Conversion
// ============================================================================

/**
 * Downsample RGBA pixel data by averaging 2x2 blocks.
 *
 * Used for draft mode processing to reduce workload during interactive editing.
 * The algorithm averages each 2x2 block of pixels into a single output pixel.
 *
 * @param pixels - RGBA pixel data (4 bytes per pixel)
 * @param width - Input image width in pixels
 * @param height - Input image height in pixels
 * @param scale - Target scale (0.5 for half resolution, 1.0 for no change)
 * @returns Object containing downsampled pixels and new dimensions
 */
export function downsamplePixels(
  pixels: Uint8Array,
  width: number,
  height: number,
  scale: number
): { pixels: Uint8Array; width: number; height: number } {
  // No downsampling needed for scale >= 1.0
  if (scale >= 1.0) {
    return { pixels, width, height }
  }

  // For scale 0.5, we average 2x2 blocks
  const newWidth = Math.floor(width / 2)
  const newHeight = Math.floor(height / 2)

  // Handle edge case where dimensions are too small
  if (newWidth < 1 || newHeight < 1) {
    return { pixels, width, height }
  }

  const result = new Uint8Array(newWidth * newHeight * 4)

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      // Source coordinates for 2x2 block
      const srcX = x * 2
      const srcY = y * 2

      // Get indices for the 4 source pixels
      const idx00 = (srcY * width + srcX) * 4
      const idx10 = (srcY * width + srcX + 1) * 4
      const idx01 = ((srcY + 1) * width + srcX) * 4
      const idx11 = ((srcY + 1) * width + srcX + 1) * 4

      // Destination index
      const dstIdx = (y * newWidth + x) * 4

      // Average each channel (R, G, B, A)
      result[dstIdx] = Math.round(
        (pixels[idx00]! + pixels[idx10]! + pixels[idx01]! + pixels[idx11]!) / 4
      )
      result[dstIdx + 1] = Math.round(
        (pixels[idx00 + 1]! + pixels[idx10 + 1]! + pixels[idx01 + 1]! + pixels[idx11 + 1]!) / 4
      )
      result[dstIdx + 2] = Math.round(
        (pixels[idx00 + 2]! + pixels[idx10 + 2]! + pixels[idx01 + 2]! + pixels[idx11 + 2]!) / 4
      )
      result[dstIdx + 3] = Math.round(
        (pixels[idx00 + 3]! + pixels[idx10 + 3]! + pixels[idx01 + 3]! + pixels[idx11 + 3]!) / 4
      )
    }
  }

  return { pixels: result, width: newWidth, height: newHeight }
}

/**
 * Convert RGB pixel data to RGBA.
 *
 * @param rgb - RGB pixel data (3 bytes per pixel)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns RGBA pixel data (4 bytes per pixel) with alpha set to 255
 */
export function rgbToRgba(
  rgb: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const pixelCount = width * height
  const rgba = new Uint8Array(pixelCount * 4)

  for (let i = 0; i < pixelCount; i++) {
    const rgbIdx = i * 3
    const rgbaIdx = i * 4
    rgba[rgbaIdx] = rgb[rgbIdx]! // R
    rgba[rgbaIdx + 1] = rgb[rgbIdx + 1]! // G
    rgba[rgbaIdx + 2] = rgb[rgbIdx + 2]! // B
    rgba[rgbaIdx + 3] = 255 // A (fully opaque)
  }

  return rgba
}

/**
 * Convert RGBA pixel data to RGB.
 *
 * @param rgba - RGBA pixel data (4 bytes per pixel)
 * @param width - Image width in pixels
 * @param height - Image height in pixels
 * @returns RGB pixel data (3 bytes per pixel), alpha channel discarded
 */
export function rgbaToRgb(
  rgba: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const pixelCount = width * height
  const rgb = new Uint8Array(pixelCount * 3)

  for (let i = 0; i < pixelCount; i++) {
    const rgbaIdx = i * 4
    const rgbIdx = i * 3
    rgb[rgbIdx] = rgba[rgbaIdx]! // R
    rgb[rgbIdx + 1] = rgba[rgbaIdx + 1]! // G
    rgb[rgbIdx + 2] = rgba[rgbaIdx + 2]! // B
    // Alpha is discarded
  }

  return rgb
}
