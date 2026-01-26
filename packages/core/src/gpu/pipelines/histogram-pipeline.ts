/// <reference types="@webgpu/types" />
/**
 * GPU pipeline for histogram computation.
 *
 * Computes histogram data (red, green, blue, luminance) for an image
 * using a WebGPU compute shader with atomic operations for bin counting.
 */

import { getGPUCapabilityService } from '../capabilities'
import { HISTOGRAM_SHADER_SOURCE } from '../shaders'
import { calculateDispatchSize } from '../texture-utils'
import { StagingBufferPool } from '../utils/staging-buffer-pool'

/**
 * Histogram result containing 256 bins for each channel.
 */
export interface HistogramResult {
  /** Red channel histogram (256 bins) */
  red: Uint32Array
  /** Green channel histogram (256 bins) */
  green: Uint32Array
  /** Blue channel histogram (256 bins) */
  blue: Uint32Array
  /** Luminance histogram (256 bins) */
  luminance: Uint32Array
}

/**
 * GPU pipeline for computing image histograms.
 */
export class HistogramPipeline {
  private device: GPUDevice
  private pipeline: GPUComputePipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null

  // Reusable buffers
  private histogramBuffer: GPUBuffer | null = null // 4KB storage (4 channels × 256 bins × 4 bytes)
  private dimensionsBuffer: GPUBuffer | null = null

  // Triple-buffered async readback
  private stagingPool: StagingBufferPool | null = null
  private lastHistogramData: HistogramResult | null = null

  // Workgroup size (must match shader)
  private static readonly WORKGROUP_SIZE = 16

  // Buffer sizes
  private static readonly HISTOGRAM_BUFFER_SIZE = 256 * 4 * 4 // 4 channels × 256 bins × 4 bytes = 4096 bytes
  private static readonly DIMENSIONS_BUFFER_SIZE = 8 // 2 × u32 = 8 bytes

  constructor(device: GPUDevice) {
    this.device = device
  }

  /**
   * Initialize the pipeline (compile shader, create layouts).
   */
  async initialize(): Promise<void> {
    if (this.pipeline) {
      return // Already initialized
    }

    // Create shader module
    const shaderModule = this.device.createShaderModule({
      label: 'Histogram Shader',
      code: HISTOGRAM_SHADER_SOURCE,
    })

    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Histogram Bind Group Layout',
      entries: [
        {
          // Input texture
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: {
            sampleType: 'float',
            viewDimension: '2d',
          },
        },
        {
          // Histogram storage buffer (read_write for atomic operations)
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'storage',
          },
        },
        {
          // Dimensions uniform buffer
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'uniform',
          },
        },
      ],
    })

    // Create pipeline layout
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Histogram Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout],
    })

    // Create compute pipeline
    this.pipeline = this.device.createComputePipeline({
      label: 'Histogram Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    })

    // Create histogram storage buffer (4 channels × 256 bins × 4 bytes)
    this.histogramBuffer = this.device.createBuffer({
      label: 'Histogram Storage Buffer',
      size: HistogramPipeline.HISTOGRAM_BUFFER_SIZE,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    })

    // Create dimensions uniform buffer (2 × u32 = 8 bytes)
    this.dimensionsBuffer = this.device.createBuffer({
      label: 'Histogram Dimensions Buffer',
      size: HistogramPipeline.DIMENSIONS_BUFFER_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Create staging buffer pool for async readback (triple-buffered)
    // HISTOGRAM_BUFFER_SIZE = 4 channels × 256 bins × 4 bytes = 4096 bytes
    this.stagingPool = new StagingBufferPool(
      this.device,
      HistogramPipeline.HISTOGRAM_BUFFER_SIZE,
      3 // Triple buffer
    )
  }

  /**
   * Compute histogram from a GPU texture.
   *
   * @param inputTexture - Input GPU texture (rgba8unorm or compatible)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @returns Histogram data for red, green, blue, and luminance channels
   */
  async compute(
    inputTexture: GPUTexture,
    width: number,
    height: number
  ): Promise<HistogramResult> {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Clear histogram buffer to zeros
    const zeroData = new Uint32Array(256 * 4)
    this.device.queue.writeBuffer(this.histogramBuffer!, 0, zeroData.buffer)

    // Update dimensions uniform buffer
    const dimensionsData = new Uint32Array([width, height])
    this.device.queue.writeBuffer(
      this.dimensionsBuffer!,
      0,
      dimensionsData.buffer
    )

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Histogram Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: { buffer: this.histogramBuffer! } },
        { binding: 2, resource: { buffer: this.dimensionsBuffer! } },
      ],
    })

    // Calculate dispatch sizes
    const [workgroupsX, workgroupsY] = calculateDispatchSize(width, height, HistogramPipeline.WORKGROUP_SIZE)

    // Create command encoder
    const encoder = this.device.createCommandEncoder({
      label: 'Histogram Command Encoder',
    })

    // Begin compute pass
    const pass = encoder.beginComputePass({
      label: 'Histogram Compute Pass',
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1)
    pass.end()

    // Create staging buffer for readback
    const stagingBuffer = this.device.createBuffer({
      label: 'Histogram Staging Buffer',
      size: HistogramPipeline.HISTOGRAM_BUFFER_SIZE,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    // Copy histogram buffer to staging buffer
    encoder.copyBufferToBuffer(
      this.histogramBuffer!,
      0,
      stagingBuffer,
      0,
      HistogramPipeline.HISTOGRAM_BUFFER_SIZE
    )

    // Submit commands
    this.device.queue.submit([encoder.finish()])

    // Wait for GPU to finish and read back results
    await stagingBuffer.mapAsync(GPUMapMode.READ)
    const resultData = new Uint32Array(stagingBuffer.getMappedRange()).slice()
    stagingBuffer.unmap()

    // Cleanup staging buffer
    stagingBuffer.destroy()

    // Parse histogram data into separate channels
    // Layout: [red[0..255], green[0..255], blue[0..255], luminance[0..255]]
    const result: HistogramResult = {
      red: resultData.slice(0, 256),
      green: resultData.slice(256, 512),
      blue: resultData.slice(512, 768),
      luminance: resultData.slice(768, 1024),
    }

    return result
  }

  /**
   * Compute histogram from pixel data.
   *
   * Creates a temporary texture from the pixel data, computes the histogram,
   * and cleans up the texture.
   *
   * @param pixels - Input RGBA pixel data (Uint8Array)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @returns Histogram data for red, green, blue, and luminance channels
   */
  async computeFromPixels(
    pixels: Uint8Array,
    width: number,
    height: number
  ): Promise<HistogramResult> {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Create input texture
    const inputTexture = this.device.createTexture({
      label: 'Histogram Input Texture',
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })

    // Upload pixels to texture
    this.device.queue.writeTexture(
      { texture: inputTexture },
      pixels.buffer,
      {
        bytesPerRow: width * 4,
        rowsPerImage: height,
        offset: pixels.byteOffset,
      },
      { width, height, depthOrArrayLayers: 1 }
    )

    try {
      // Compute histogram using the texture
      const result = await this.compute(inputTexture, width, height)
      return result
    } finally {
      // Cleanup temporary texture
      inputTexture.destroy()
    }
  }

  /**
   * Compute histogram asynchronously with non-blocking readback.
   *
   * This method dispatches the compute shader and uses triple-buffered
   * async readback to avoid blocking the main thread. The callback is
   * invoked when the result is ready.
   *
   * @param inputTexture - Input GPU texture (rgba8unorm or compatible)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param onComplete - Callback invoked with the histogram result
   */
  computeAsync(
    inputTexture: GPUTexture,
    width: number,
    height: number,
    onComplete: (result: HistogramResult) => void
  ): void {
    if (!this.pipeline || !this.bindGroupLayout || !this.stagingPool) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Clear histogram buffer to zeros
    const zeroData = new Uint32Array(256 * 4)
    this.device.queue.writeBuffer(this.histogramBuffer!, 0, zeroData.buffer)

    // Update dimensions uniform buffer
    const dimensionsData = new Uint32Array([width, height])
    this.device.queue.writeBuffer(
      this.dimensionsBuffer!,
      0,
      dimensionsData.buffer
    )

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Histogram Bind Group (Async)',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: { buffer: this.histogramBuffer! } },
        { binding: 2, resource: { buffer: this.dimensionsBuffer! } },
      ],
    })

    // Calculate dispatch sizes
    const [workgroupsX, workgroupsY] = calculateDispatchSize(
      width,
      height,
      HistogramPipeline.WORKGROUP_SIZE
    )

    // Create command encoder
    const encoder = this.device.createCommandEncoder({
      label: 'Histogram Command Encoder (Async)',
    })

    // Begin compute pass
    const pass = encoder.beginComputePass({
      label: 'Histogram Compute Pass (Async)',
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1)
    pass.end()

    // Use staging pool for async readback (fire-and-forget pattern)
    this.stagingPool.readbackAsync(
      encoder,
      this.histogramBuffer!,
      (resultData: Uint32Array) => {
        // Parse histogram data into separate channels
        // Layout: [red[0..255], green[0..255], blue[0..255], luminance[0..255]]
        const result: HistogramResult = {
          red: resultData.slice(0, 256),
          green: resultData.slice(256, 512),
          blue: resultData.slice(512, 768),
          luminance: resultData.slice(768, 1024),
        }

        // Cache the result
        this.lastHistogramData = result

        // Invoke callback
        onComplete(result)
      }
    )

    // Submit commands
    this.device.queue.submit([encoder.finish()])
  }

  /**
   * Get the last computed histogram result.
   *
   * Returns the most recent histogram data from either compute() or computeAsync().
   * Useful for getting immediate feedback when the async result isn't ready yet.
   *
   * @returns The last histogram result, or null if no histogram has been computed
   */
  getLastHistogram(): HistogramResult | null {
    return this.lastHistogramData
  }

  /**
   * Destroy the pipeline and release resources.
   */
  destroy(): void {
    this.histogramBuffer?.destroy()
    this.dimensionsBuffer?.destroy()
    this.stagingPool?.clear()
    this.histogramBuffer = null
    this.dimensionsBuffer = null
    this.stagingPool = null
    this.pipeline = null
    this.bindGroupLayout = null
    this.lastHistogramData = null
  }
}

/**
 * Singleton instance of the histogram pipeline.
 */
let _histogramPipeline: HistogramPipeline | null = null

/**
 * Get or create the histogram pipeline singleton.
 *
 * @returns The pipeline, or null if GPU is not available
 */
export async function getHistogramPipeline(): Promise<HistogramPipeline | null> {
  const gpuService = getGPUCapabilityService()

  if (!gpuService.isReady || !gpuService.device) {
    return null
  }

  if (!_histogramPipeline) {
    _histogramPipeline = new HistogramPipeline(gpuService.device)
    await _histogramPipeline.initialize()
  }

  return _histogramPipeline
}

/**
 * Reset the histogram pipeline singleton (for testing).
 */
export function resetHistogramPipeline(): void {
  if (_histogramPipeline) {
    _histogramPipeline.destroy()
    _histogramPipeline = null
  }
}
