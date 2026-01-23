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
  const bufferSize = width * height * 4

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
    { buffer: stagingBuffer, bytesPerRow: width * 4, rowsPerImage: height },
    { width, height, depthOrArrayLayers: 1 }
  )

  device.queue.submit([encoder.finish()])

  // Wait for GPU and read data
  await stagingBuffer.mapAsync(GPUMapMode.READ)
  const data = new Uint8Array(stagingBuffer.getMappedRange()).slice()
  stagingBuffer.unmap()

  // Cleanup
  stagingBuffer.destroy()

  return data
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
    return this.textures[this.currentIndex]
  }

  /**
   * Get the other texture (destination).
   */
  getNext(): GPUTexture {
    return this.textures[1 - this.currentIndex]
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
