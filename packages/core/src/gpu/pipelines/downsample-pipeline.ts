/// <reference types="@webgpu/types" />
/**
 * GPU pipeline for image downsampling.
 *
 * Downsamples images by averaging pixel blocks using a WebGPU compute shader.
 * Supports arbitrary scale factors for efficient preview generation.
 */

import { getGPUCapabilityService } from '../capabilities'
import { DOWNSAMPLE_SHADER_SOURCE } from '../shaders'
import { alignTo256, removeRowPadding, calculateDispatchSize } from '../texture-utils'

/**
 * Parameters for downsampling operation.
 */
export interface DownsampleParams {
  inputWidth: number
  inputHeight: number
  outputWidth: number
  outputHeight: number
  scale: number
}

/**
 * GPU pipeline for downsampling images.
 */
export class DownsamplePipeline {
  private device: GPUDevice
  private pipeline: GPUComputePipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null

  // Reusable uniform buffer for dimensions/scale
  private paramsBuffer: GPUBuffer | null = null

  // Workgroup size (must match shader)
  private static readonly WORKGROUP_SIZE = 16

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
      label: 'Downsample Shader',
      code: DOWNSAMPLE_SHADER_SOURCE,
    })

    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Downsample Bind Group Layout',
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
          // Output storage texture
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: {
            access: 'write-only',
            format: 'rgba8unorm',
            viewDimension: '2d',
          },
        },
        {
          // Params uniform buffer (dimensions + scale)
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
      label: 'Downsample Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout],
    })

    // Create compute pipeline
    this.pipeline = this.device.createComputePipeline({
      label: 'Downsample Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    })

    // Create reusable uniform buffer
    // Params: inputWidth, inputHeight, outputWidth, outputHeight (4 u32) + scale (1 f32) + padding (3 f32) = 32 bytes
    this.paramsBuffer = this.device.createBuffer({
      label: 'Downsample Params Uniform Buffer',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  /**
   * Downsample an image with textures already on GPU.
   *
   * This is more efficient when chaining multiple operations
   * as it avoids CPU-GPU transfers between operations.
   *
   * @param inputTexture - Input GPU texture
   * @param outputTexture - Output GPU texture (must be storage-compatible)
   * @param params - Downsample parameters
   * @param encoder - Command encoder (optional, creates new if not provided)
   * @returns The command encoder used (for chaining)
   */
  downsampleToTextures(
    inputTexture: GPUTexture,
    outputTexture: GPUTexture,
    params: DownsampleParams,
    encoder?: GPUCommandEncoder
  ): GPUCommandEncoder {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Update params uniform buffer
    // Layout: inputWidth(u32), inputHeight(u32), outputWidth(u32), outputHeight(u32), scale(f32), padding(3xf32)
    const paramsData = new ArrayBuffer(32)
    const uint32View = new Uint32Array(paramsData, 0, 4)
    const float32View = new Float32Array(paramsData, 16, 4)
    uint32View[0] = params.inputWidth
    uint32View[1] = params.inputHeight
    uint32View[2] = params.outputWidth
    uint32View[3] = params.outputHeight
    float32View[0] = params.scale
    float32View[1] = 0 // padding
    float32View[2] = 0 // padding
    float32View[3] = 0 // padding

    this.device.queue.writeBuffer(this.paramsBuffer!, 0, paramsData)

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Downsample Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: this.paramsBuffer! } },
      ],
    })

    // Create encoder if not provided
    const commandEncoder =
      encoder ||
      this.device.createCommandEncoder({
        label: 'Downsample Command Encoder',
      })

    // Calculate dispatch sizes based on output dimensions
    const [workgroupsX, workgroupsY] = calculateDispatchSize(
      params.outputWidth,
      params.outputHeight,
      DownsamplePipeline.WORKGROUP_SIZE
    )

    // Begin compute pass
    const pass = commandEncoder.beginComputePass({
      label: 'Downsample Compute Pass',
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1)
    pass.end()

    return commandEncoder
  }

  /**
   * Downsample an image.
   *
   * @param inputPixels - Input RGBA pixel data (Uint8Array)
   * @param inputWidth - Input image width in pixels
   * @param inputHeight - Input image height in pixels
   * @param scale - Scale factor (e.g., 0.5 for half resolution)
   * @returns Downsampled RGBA pixel data and dimensions
   */
  async downsample(
    inputPixels: Uint8Array,
    inputWidth: number,
    inputHeight: number,
    scale: number
  ): Promise<{ pixels: Uint8Array; width: number; height: number }> {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Calculate output dimensions
    const outputWidth = Math.max(1, Math.floor(inputWidth * scale))
    const outputHeight = Math.max(1, Math.floor(inputHeight * scale))

    // No downsampling needed for scale >= 1.0
    if (scale >= 1.0) {
      return { pixels: inputPixels, width: inputWidth, height: inputHeight }
    }

    // Create input texture
    const inputTexture = this.device.createTexture({
      label: 'Downsample Input Texture',
      size: { width: inputWidth, height: inputHeight, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })

    // Upload input pixels
    this.device.queue.writeTexture(
      { texture: inputTexture },
      inputPixels.buffer,
      { bytesPerRow: inputWidth * 4, rowsPerImage: inputHeight, offset: inputPixels.byteOffset },
      { width: inputWidth, height: inputHeight, depthOrArrayLayers: 1 }
    )

    // Create output texture
    const outputTexture = this.device.createTexture({
      label: 'Downsample Output Texture',
      size: { width: outputWidth, height: outputHeight, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING,
    })

    // Set up params
    const params: DownsampleParams = {
      inputWidth,
      inputHeight,
      outputWidth,
      outputHeight,
      scale,
    }

    // Create command encoder and run downsample
    const encoder = this.downsampleToTextures(inputTexture, outputTexture, params)

    // Create staging buffer for readback with aligned bytesPerRow
    const actualBytesPerRow = outputWidth * 4
    const alignedBytesPerRow = alignTo256(actualBytesPerRow)
    const stagingBuffer = this.device.createBuffer({
      label: 'Downsample Staging Buffer',
      size: alignedBytesPerRow * outputHeight,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    // Copy output texture to staging buffer
    encoder.copyTextureToBuffer(
      { texture: outputTexture },
      { buffer: stagingBuffer, bytesPerRow: alignedBytesPerRow, rowsPerImage: outputHeight },
      { width: outputWidth, height: outputHeight, depthOrArrayLayers: 1 }
    )

    // Submit commands
    this.device.queue.submit([encoder.finish()])

    // Wait for GPU to finish and read back results
    await stagingBuffer.mapAsync(GPUMapMode.READ)
    const paddedData = new Uint8Array(stagingBuffer.getMappedRange()).slice()
    stagingBuffer.unmap()

    // Remove row padding if needed
    const resultData = removeRowPadding(paddedData, outputWidth, outputHeight, alignedBytesPerRow)

    // Cleanup temporary resources
    inputTexture.destroy()
    outputTexture.destroy()
    stagingBuffer.destroy()

    return { pixels: resultData, width: outputWidth, height: outputHeight }
  }

  /**
   * Destroy the pipeline and release resources.
   */
  destroy(): void {
    this.paramsBuffer?.destroy()
    this.paramsBuffer = null
    this.pipeline = null
    this.bindGroupLayout = null
  }
}

/**
 * Singleton instance of the downsample pipeline.
 */
let _downsamplePipeline: DownsamplePipeline | null = null

/**
 * Get or create the downsample pipeline singleton.
 *
 * @returns The pipeline, or null if GPU is not available
 */
export async function getDownsamplePipeline(): Promise<DownsamplePipeline | null> {
  const gpuService = getGPUCapabilityService()

  if (!gpuService.isReady || !gpuService.device) {
    return null
  }

  if (!_downsamplePipeline) {
    _downsamplePipeline = new DownsamplePipeline(gpuService.device)
    await _downsamplePipeline.initialize()
  }

  return _downsamplePipeline
}

/**
 * Reset the downsample pipeline singleton (for testing).
 */
export function resetDownsamplePipeline(): void {
  if (_downsamplePipeline) {
    _downsamplePipeline.destroy()
    _downsamplePipeline = null
  }
}
