/// <reference types="@webgpu/types" />
/**
 * GPU pipeline for tone curve application.
 *
 * Applies a pre-computed 256-entry LUT to each RGB channel using a
 * WebGPU compute shader with hardware linear interpolation.
 */

import { getGPUCapabilityService } from '../capabilities'
import { TONE_CURVE_SHADER_SOURCE } from '../shaders'
import { alignTo256, removeRowPadding, calculateDispatchSize } from '../texture-utils'

/**
 * Tone curve LUT - 256-entry lookup table for tone mapping.
 */
export interface ToneCurveLut {
  /** LUT values (256 entries, each 0-255) */
  lut: Uint8Array
}

/**
 * Default identity LUT (no change).
 */
export function createIdentityLut(): ToneCurveLut {
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    lut[i] = i
  }
  return { lut }
}

/**
 * Check if a LUT is identity (no change).
 */
export function isIdentityLut(lut: ToneCurveLut): boolean {
  for (let i = 0; i < 256; i++) {
    if (lut.lut[i] !== i) {
      return false
    }
  }
  return true
}

/**
 * GPU pipeline for applying tone curve LUT.
 */
export class ToneCurvePipeline {
  private device: GPUDevice
  private pipeline: GPUComputePipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null

  // Reusable resources
  private dimensionsBuffer: GPUBuffer | null = null
  private lutTexture: GPUTexture | null = null
  private lutSampler: GPUSampler | null = null

  // Cached LUT to avoid re-uploading
  private cachedLut: Uint8Array | null = null

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
      label: 'Tone Curve Shader',
      code: TONE_CURVE_SHADER_SOURCE,
    })

    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Tone Curve Bind Group Layout',
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
          // LUT 1D texture
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          texture: {
            sampleType: 'float',
            viewDimension: '1d',
          },
        },
        {
          // LUT sampler
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          sampler: {
            type: 'filtering',
          },
        },
        {
          // Dimensions uniform buffer
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'uniform',
          },
        },
      ],
    })

    // Create pipeline layout
    const pipelineLayout = this.device.createPipelineLayout({
      label: 'Tone Curve Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout],
    })

    // Create compute pipeline
    this.pipeline = this.device.createComputePipeline({
      label: 'Tone Curve Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    })

    // Create dimensions uniform buffer (8 bytes + 8 padding = 16)
    this.dimensionsBuffer = this.device.createBuffer({
      label: 'Tone Curve Dimensions Buffer',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Create LUT texture (256x1 R8 format for single channel)
    this.lutTexture = this.device.createTexture({
      label: 'Tone Curve LUT Texture',
      size: { width: 256, height: 1, depthOrArrayLayers: 1 },
      format: 'r8unorm',
      dimension: '1d',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })

    // Create LUT sampler with linear filtering
    this.lutSampler = this.device.createSampler({
      label: 'Tone Curve LUT Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
    })
  }

  /**
   * Update the LUT texture with new values.
   */
  private updateLut(lut: ToneCurveLut): void {
    if (!this.lutTexture) {
      throw new Error('Pipeline not initialized')
    }

    // Check if LUT has changed
    if (
      this.cachedLut &&
      lut.lut.length === this.cachedLut.length &&
      lut.lut.every((v, i) => v === this.cachedLut![i])
    ) {
      return // LUT unchanged, skip upload
    }

    // Upload LUT to texture
    this.device.queue.writeTexture(
      { texture: this.lutTexture },
      lut.lut.buffer,
      { bytesPerRow: 256, offset: lut.lut.byteOffset },
      { width: 256, height: 1, depthOrArrayLayers: 1 }
    )

    // Cache the LUT
    this.cachedLut = new Uint8Array(lut.lut)
  }

  /**
   * Prepare resources for compute pass and execute it.
   * Shared logic between apply() and applyToTextures().
   */
  private executeComputePass(
    inputTexture: GPUTexture,
    outputTexture: GPUTexture,
    width: number,
    height: number,
    lut: ToneCurveLut,
    encoder?: GPUCommandEncoder
  ): GPUCommandEncoder {
    // Update LUT texture
    this.updateLut(lut)

    // Update dimensions uniform buffer
    const dimensionsData = new Uint32Array([width, height, 0, 0])
    this.device.queue.writeBuffer(this.dimensionsBuffer!, 0, dimensionsData.buffer)

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Tone Curve Bind Group',
      layout: this.bindGroupLayout!,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: this.lutTexture!.createView() },
        { binding: 3, resource: this.lutSampler! },
        { binding: 4, resource: { buffer: this.dimensionsBuffer! } },
      ],
    })

    // Create encoder if not provided
    const commandEncoder =
      encoder ||
      this.device.createCommandEncoder({
        label: 'Tone Curve Command Encoder',
      })

    // Calculate dispatch sizes and execute
    const [workgroupsX, workgroupsY] = calculateDispatchSize(width, height, ToneCurvePipeline.WORKGROUP_SIZE)
    const pass = commandEncoder.beginComputePass({
      label: 'Tone Curve Compute Pass',
    })
    pass.setPipeline(this.pipeline!)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1)
    pass.end()

    return commandEncoder
  }

  /**
   * Apply tone curve LUT to an image.
   *
   * @param inputPixels - Input RGBA pixel data (Uint8Array)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param lut - Tone curve LUT to apply
   * @returns Processed RGBA pixel data
   */
  async apply(
    inputPixels: Uint8Array,
    width: number,
    height: number,
    lut: ToneCurveLut
  ): Promise<Uint8Array> {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Early exit for identity LUT
    if (isIdentityLut(lut)) {
      return inputPixels.slice() // Return copy
    }

    // Create input texture
    const inputTexture = this.device.createTexture({
      label: 'Tone Curve Input Texture',
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
      label: 'Tone Curve Output Texture',
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING,
    })

    // Execute compute pass
    const encoder = this.executeComputePass(inputTexture, outputTexture, width, height, lut)

    // Create staging buffer for readback with aligned bytesPerRow
    const actualBytesPerRow = width * 4
    const alignedBytesPerRow = alignTo256(actualBytesPerRow)
    const stagingBuffer = this.device.createBuffer({
      label: 'Tone Curve Staging Buffer',
      size: alignedBytesPerRow * height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    // Copy output texture to staging buffer
    encoder.copyTextureToBuffer(
      { texture: outputTexture },
      { buffer: stagingBuffer, bytesPerRow: alignedBytesPerRow, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    )

    // Submit commands
    this.device.queue.submit([encoder.finish()])

    // Wait for GPU to finish and read back results
    await stagingBuffer.mapAsync(GPUMapMode.READ)
    const paddedData = new Uint8Array(stagingBuffer.getMappedRange()).slice()
    stagingBuffer.unmap()

    // Remove row padding if needed
    const resultData = removeRowPadding(paddedData, width, height, alignedBytesPerRow)

    // Cleanup temporary resources
    inputTexture.destroy()
    outputTexture.destroy()
    stagingBuffer.destroy()

    return resultData
  }

  /**
   * Apply tone curve with textures already on GPU.
   *
   * This is more efficient when chaining multiple operations
   * as it avoids CPU-GPU transfers between operations.
   *
   * @param inputTexture - Input GPU texture
   * @param outputTexture - Output GPU texture (must be storage-compatible)
   * @param width - Image width
   * @param height - Image height
   * @param lut - Tone curve LUT
   * @param encoder - Command encoder (optional, creates new if not provided)
   * @returns The command encoder used (for chaining)
   */
  applyToTextures(
    inputTexture: GPUTexture,
    outputTexture: GPUTexture,
    width: number,
    height: number,
    lut: ToneCurveLut,
    encoder?: GPUCommandEncoder
  ): GPUCommandEncoder {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    return this.executeComputePass(inputTexture, outputTexture, width, height, lut, encoder)
  }

  /**
   * Destroy the pipeline and release resources.
   */
  destroy(): void {
    this.lutTexture?.destroy()
    this.dimensionsBuffer?.destroy()
    this.lutTexture = null
    this.dimensionsBuffer = null
    this.lutSampler = null
    this.pipeline = null
    this.bindGroupLayout = null
    this.cachedLut = null
  }
}

/**
 * Singleton instance of the tone curve pipeline.
 */
let _toneCurvePipeline: ToneCurvePipeline | null = null

/**
 * Get or create the tone curve pipeline singleton.
 *
 * @returns The pipeline, or null if GPU is not available
 */
export async function getToneCurvePipeline(): Promise<ToneCurvePipeline | null> {
  const gpuService = getGPUCapabilityService()

  if (!gpuService.isReady || !gpuService.device) {
    return null
  }

  if (!_toneCurvePipeline) {
    _toneCurvePipeline = new ToneCurvePipeline(gpuService.device)
    await _toneCurvePipeline.initialize()
  }

  return _toneCurvePipeline
}

/**
 * Reset the tone curve pipeline singleton (for testing).
 */
export function resetToneCurvePipeline(): void {
  if (_toneCurvePipeline) {
    _toneCurvePipeline.destroy()
    _toneCurvePipeline = null
  }
}
