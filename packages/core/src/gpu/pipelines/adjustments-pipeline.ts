/// <reference types="@webgpu/types" />
/**
 * GPU pipeline for basic image adjustments.
 *
 * Applies all 10 basic adjustments (exposure, contrast, temperature, tint,
 * highlights, shadows, whites, blacks, saturation, vibrance) using a
 * WebGPU compute shader.
 */

import { getGPUCapabilityService } from '../capabilities'
import { ADJUSTMENTS_SHADER_SOURCE } from '../shaders'

/**
 * Basic adjustments parameters matching the Rust BasicAdjustments struct.
 */
export interface BasicAdjustments {
  temperature: number // White balance temperature (-100 to 100)
  tint: number // White balance tint (-100 to 100)
  exposure: number // Exposure adjustment (-5 to 5 stops)
  contrast: number // Contrast (-100 to 100)
  highlights: number // Highlights (-100 to 100)
  shadows: number // Shadows (-100 to 100)
  whites: number // Whites (-100 to 100)
  blacks: number // Blacks (-100 to 100)
  vibrance: number // Vibrance (-100 to 100)
  saturation: number // Saturation (-100 to 100)
}

/**
 * Default basic adjustments (no changes).
 */
export const DEFAULT_BASIC_ADJUSTMENTS: BasicAdjustments = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  vibrance: 0,
  saturation: 0,
}

/**
 * GPU pipeline for applying basic adjustments.
 */
export class AdjustmentsPipeline {
  private device: GPUDevice
  private pipeline: GPUComputePipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null

  // Reusable uniform buffers
  private adjustmentsBuffer: GPUBuffer | null = null
  private dimensionsBuffer: GPUBuffer | null = null

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
      label: 'Adjustments Shader',
      code: ADJUSTMENTS_SHADER_SOURCE,
    })

    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Adjustments Bind Group Layout',
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
          // Adjustments uniform buffer
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'uniform',
          },
        },
        {
          // Dimensions uniform buffer
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'uniform',
          },
        },
      ],
    })

    // Create pipeline layout
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Adjustments Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout],
    })

    // Create compute pipeline
    this.pipeline = this.device.createComputePipeline({
      label: 'Adjustments Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    })

    // Create reusable uniform buffers
    // Adjustments: 10 f32 values + 2 padding = 48 bytes
    this.adjustmentsBuffer = this.device.createBuffer({
      label: 'Adjustments Uniform Buffer',
      size: 48,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Dimensions: 2 u32 values = 8 bytes (padded to 16)
    this.dimensionsBuffer = this.device.createBuffer({
      label: 'Dimensions Uniform Buffer',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  /**
   * Apply adjustments to an image.
   *
   * @param inputPixels - Input RGBA pixel data (Uint8Array)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param adjustments - Adjustment parameters to apply
   * @returns Processed RGBA pixel data
   */
  async apply(
    inputPixels: Uint8Array,
    width: number,
    height: number,
    adjustments: BasicAdjustments
  ): Promise<Uint8Array> {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Create input texture
    const inputTexture = this.device.createTexture({
      label: 'Adjustments Input Texture',
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })

    // Upload input pixels
    this.device.queue.writeTexture(
      { texture: inputTexture },
      inputPixels.buffer,
      { bytesPerRow: width * 4, rowsPerImage: height, offset: inputPixels.byteOffset },
      { width, height, depthOrArrayLayers: 1 }
    )

    // Create output texture
    const outputTexture = this.device.createTexture({
      label: 'Adjustments Output Texture',
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING,
    })

    // Update adjustments uniform buffer
    const adjustmentsData = new Float32Array([
      adjustments.temperature,
      adjustments.tint,
      adjustments.exposure,
      adjustments.contrast,
      adjustments.highlights,
      adjustments.shadows,
      adjustments.whites,
      adjustments.blacks,
      adjustments.vibrance,
      adjustments.saturation,
      0, // padding
      0, // padding
    ])
    this.device.queue.writeBuffer(
      this.adjustmentsBuffer!,
      0,
      adjustmentsData.buffer
    )

    // Update dimensions uniform buffer
    const dimensionsData = new Uint32Array([width, height, 0, 0])
    this.device.queue.writeBuffer(
      this.dimensionsBuffer!,
      0,
      dimensionsData.buffer
    )

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Adjustments Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: this.adjustmentsBuffer! } },
        { binding: 3, resource: { buffer: this.dimensionsBuffer! } },
      ],
    })

    // Calculate dispatch sizes
    const workgroupsX = Math.ceil(width / AdjustmentsPipeline.WORKGROUP_SIZE)
    const workgroupsY = Math.ceil(height / AdjustmentsPipeline.WORKGROUP_SIZE)

    // Create command encoder
    const encoder = this.device.createCommandEncoder({
      label: 'Adjustments Command Encoder',
    })

    // Begin compute pass
    const pass = encoder.beginComputePass({
      label: 'Adjustments Compute Pass',
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1)
    pass.end()

    // Create staging buffer for readback
    const stagingBuffer = this.device.createBuffer({
      label: 'Adjustments Staging Buffer',
      size: width * height * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    // Copy output texture to staging buffer
    encoder.copyTextureToBuffer(
      { texture: outputTexture },
      { buffer: stagingBuffer, bytesPerRow: width * 4, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    )

    // Submit commands
    this.device.queue.submit([encoder.finish()])

    // Wait for GPU to finish and read back results
    await stagingBuffer.mapAsync(GPUMapMode.READ)
    const resultData = new Uint8Array(stagingBuffer.getMappedRange()).slice()
    stagingBuffer.unmap()

    // Cleanup temporary resources
    inputTexture.destroy()
    outputTexture.destroy()
    stagingBuffer.destroy()

    return resultData
  }

  /**
   * Apply adjustments with textures already on GPU.
   *
   * This is more efficient when chaining multiple operations
   * as it avoids CPU-GPU transfers between operations.
   *
   * @param inputTexture - Input GPU texture
   * @param outputTexture - Output GPU texture (must be storage-compatible)
   * @param width - Image width
   * @param height - Image height
   * @param adjustments - Adjustment parameters
   * @param encoder - Command encoder (optional, creates new if not provided)
   * @returns The command encoder used (for chaining)
   */
  applyToTextures(
    inputTexture: GPUTexture,
    outputTexture: GPUTexture,
    width: number,
    height: number,
    adjustments: BasicAdjustments,
    encoder?: GPUCommandEncoder
  ): GPUCommandEncoder {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Update uniform buffers
    const adjustmentsData = new Float32Array([
      adjustments.temperature,
      adjustments.tint,
      adjustments.exposure,
      adjustments.contrast,
      adjustments.highlights,
      adjustments.shadows,
      adjustments.whites,
      adjustments.blacks,
      adjustments.vibrance,
      adjustments.saturation,
      0,
      0,
    ])
    this.device.queue.writeBuffer(
      this.adjustmentsBuffer!,
      0,
      adjustmentsData.buffer
    )

    const dimensionsData = new Uint32Array([width, height, 0, 0])
    this.device.queue.writeBuffer(
      this.dimensionsBuffer!,
      0,
      dimensionsData.buffer
    )

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Adjustments Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: this.adjustmentsBuffer! } },
        { binding: 3, resource: { buffer: this.dimensionsBuffer! } },
      ],
    })

    // Create encoder if not provided
    const commandEncoder =
      encoder ||
      this.device.createCommandEncoder({
        label: 'Adjustments Command Encoder',
      })

    // Calculate dispatch sizes
    const workgroupsX = Math.ceil(width / AdjustmentsPipeline.WORKGROUP_SIZE)
    const workgroupsY = Math.ceil(height / AdjustmentsPipeline.WORKGROUP_SIZE)

    // Begin compute pass
    const pass = commandEncoder.beginComputePass({
      label: 'Adjustments Compute Pass',
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1)
    pass.end()

    return commandEncoder
  }

  /**
   * Destroy the pipeline and release resources.
   */
  destroy(): void {
    this.adjustmentsBuffer?.destroy()
    this.dimensionsBuffer?.destroy()
    this.adjustmentsBuffer = null
    this.dimensionsBuffer = null
    this.pipeline = null
    this.bindGroupLayout = null
  }
}

/**
 * Singleton instance of the adjustments pipeline.
 */
let _adjustmentsPipeline: AdjustmentsPipeline | null = null

/**
 * Get or create the adjustments pipeline singleton.
 *
 * @returns The pipeline, or null if GPU is not available
 */
export async function getAdjustmentsPipeline(): Promise<AdjustmentsPipeline | null> {
  const gpuService = getGPUCapabilityService()

  if (!gpuService.isReady || !gpuService.device) {
    return null
  }

  if (!_adjustmentsPipeline) {
    _adjustmentsPipeline = new AdjustmentsPipeline(gpuService.device)
    await _adjustmentsPipeline.initialize()
  }

  return _adjustmentsPipeline
}

/**
 * Reset the adjustments pipeline singleton (for testing).
 */
export function resetAdjustmentsPipeline(): void {
  if (_adjustmentsPipeline) {
    _adjustmentsPipeline.destroy()
    _adjustmentsPipeline = null
  }
}
