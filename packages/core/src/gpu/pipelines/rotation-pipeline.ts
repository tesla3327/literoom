/// <reference types="@webgpu/types" />
/**
 * GPU pipeline for image rotation.
 *
 * Rotates images using bilinear interpolation with GPU compute shaders.
 * Computes output dimensions dynamically based on rotation angle.
 */

import { getGPUCapabilityService } from '../capabilities'
import { ROTATION_SHADER_SOURCE } from '../shaders'
import { calculateDispatchSize } from '../texture-utils'

/**
 * Result of rotation operation.
 */
export interface RotationResult {
  pixels: Uint8Array // RGB format (not RGBA)
  width: number
  height: number
}

/**
 * GPU pipeline for image rotation.
 */
export class RotationPipeline {
  private device: GPUDevice
  private pipeline: GPUComputePipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null
  private paramsBuffer: GPUBuffer | null = null
  private dimsBuffer: GPUBuffer | null = null

  static readonly WORKGROUP_SIZE = 16

  constructor(device: GPUDevice) {
    this.device = device
  }

  /**
   * Compute output dimensions for a rotated image.
   *
   * Uses the bounding box formula for rotated rectangles.
   * Fast paths for common angles (0, 90, 180, 270 degrees).
   *
   * @param width - Source image width
   * @param height - Source image height
   * @param angleDegrees - Rotation angle in degrees
   * @returns Dimensions of the rotated image
   */
  static computeRotatedDimensions(
    width: number,
    height: number,
    angleDegrees: number
  ): { width: number; height: number } {
    // Fast paths for common angles
    const normalizedAngle = ((angleDegrees % 360) + 360) % 360
    if (normalizedAngle < 0.001 || Math.abs(normalizedAngle - 360) < 0.001) {
      return { width, height }
    }
    if (Math.abs(normalizedAngle - 90) < 0.001 || Math.abs(normalizedAngle - 270) < 0.001) {
      return { width: height, height: width }
    }
    if (Math.abs(normalizedAngle - 180) < 0.001) {
      return { width, height }
    }

    // General formula
    const angleRad = (angleDegrees * Math.PI) / 180
    const cos = Math.abs(Math.cos(angleRad))
    const sin = Math.abs(Math.sin(angleRad))
    return {
      width: Math.round(width * cos + height * sin),
      height: Math.round(width * sin + height * cos),
    }
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
      label: 'Rotation Shader',
      code: ROTATION_SHADER_SOURCE,
    })

    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Rotation Bind Group Layout',
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
          // Rotation parameters uniform buffer
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
      label: 'Rotation Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout],
    })

    // Create compute pipeline
    this.pipeline = this.device.createComputePipeline({
      label: 'Rotation Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    })

    // Create reusable uniform buffers
    // Params: cos_angle, sin_angle, src_cx, src_cy, dst_cx, dst_cy, src_width, src_height (8 f32 = 32 bytes)
    this.paramsBuffer = this.device.createBuffer({
      label: 'Rotation Params Uniform Buffer',
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Dimensions: width, height, padding, padding (4 u32 = 16 bytes)
    this.dimsBuffer = this.device.createBuffer({
      label: 'Rotation Dimensions Uniform Buffer',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  /**
   * Apply rotation to an image.
   *
   * @param inputPixels - Input RGB pixel data (width * height * 3 bytes)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param angleDegrees - Rotation angle in degrees (clockwise)
   * @returns RotationResult with rotated RGB pixel data and new dimensions
   */
  async apply(
    inputPixels: Uint8Array,
    width: number,
    height: number,
    angleDegrees: number
  ): Promise<RotationResult> {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Convert RGB to RGBA (GPU expects RGBA)
    const rgbaPixels = rgbToRgba(inputPixels, width, height)

    // Compute output dimensions
    const outDims = RotationPipeline.computeRotatedDimensions(width, height, angleDegrees)

    // Create input texture
    const inputTexture = this.device.createTexture({
      label: 'Rotation Input Texture',
      size: { width, height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    })

    // Upload input pixels
    this.device.queue.writeTexture(
      { texture: inputTexture },
      rgbaPixels.buffer,
      { bytesPerRow: width * 4, rowsPerImage: height, offset: rgbaPixels.byteOffset },
      { width, height, depthOrArrayLayers: 1 }
    )

    // Create output texture with new dimensions
    const outputTexture = this.device.createTexture({
      label: 'Rotation Output Texture',
      size: { width: outDims.width, height: outDims.height, depthOrArrayLayers: 1 },
      format: 'rgba8unorm',
      usage:
        GPUTextureUsage.STORAGE_BINDING |
        GPUTextureUsage.COPY_SRC |
        GPUTextureUsage.TEXTURE_BINDING,
    })

    // Calculate rotation parameters
    // Shader uses inverse rotation, so we pass cos(-angle), sin(-angle)
    const angleRad = (angleDegrees * Math.PI) / 180
    const cosAngle = Math.cos(-angleRad)
    const sinAngle = Math.sin(-angleRad)
    const srcCx = width / 2
    const srcCy = height / 2
    const dstCx = outDims.width / 2
    const dstCy = outDims.height / 2

    // Update params uniform buffer
    // Layout: cos_angle (f32), sin_angle (f32), src_cx (f32), src_cy (f32),
    //         dst_cx (f32), dst_cy (f32), src_width (u32), src_height (u32)
    const paramsData = new ArrayBuffer(32)
    const floatView = new Float32Array(paramsData)
    const uintView = new Uint32Array(paramsData)
    floatView[0] = cosAngle
    floatView[1] = sinAngle
    floatView[2] = srcCx
    floatView[3] = srcCy
    floatView[4] = dstCx
    floatView[5] = dstCy
    uintView[6] = width
    uintView[7] = height
    this.device.queue.writeBuffer(this.paramsBuffer!, 0, paramsData)

    // Update dimensions uniform buffer (output dimensions)
    const dimsData = new Uint32Array([outDims.width, outDims.height, 0, 0])
    this.device.queue.writeBuffer(this.dimsBuffer!, 0, dimsData.buffer)

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Rotation Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: this.paramsBuffer! } },
        { binding: 3, resource: { buffer: this.dimsBuffer! } },
      ],
    })

    // Calculate dispatch sizes
    const [workgroupsX, workgroupsY, workgroupsZ] = calculateDispatchSize(
      outDims.width,
      outDims.height,
      RotationPipeline.WORKGROUP_SIZE
    )

    // Create command encoder
    const encoder = this.device.createCommandEncoder({
      label: 'Rotation Command Encoder',
    })

    // Begin compute pass
    const pass = encoder.beginComputePass({
      label: 'Rotation Compute Pass',
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ)
    pass.end()

    // Create staging buffer for readback
    const stagingBuffer = this.device.createBuffer({
      label: 'Rotation Staging Buffer',
      size: outDims.width * outDims.height * 4,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    })

    // Copy output texture to staging buffer
    encoder.copyTextureToBuffer(
      { texture: outputTexture },
      { buffer: stagingBuffer, bytesPerRow: outDims.width * 4, rowsPerImage: outDims.height },
      { width: outDims.width, height: outDims.height, depthOrArrayLayers: 1 }
    )

    // Submit commands
    this.device.queue.submit([encoder.finish()])

    // Wait for GPU to finish and read back results
    await stagingBuffer.mapAsync(GPUMapMode.READ)
    const resultRgba = new Uint8Array(stagingBuffer.getMappedRange()).slice()
    stagingBuffer.unmap()

    // Cleanup temporary resources
    inputTexture.destroy()
    outputTexture.destroy()
    stagingBuffer.destroy()

    // Convert RGBA back to RGB
    const resultRgb = rgbaToRgb(resultRgba, outDims.width, outDims.height)

    return {
      pixels: resultRgb,
      width: outDims.width,
      height: outDims.height,
    }
  }

  /**
   * Apply rotation with textures already on GPU.
   *
   * This is more efficient when chaining multiple operations
   * as it avoids CPU-GPU transfers between operations.
   *
   * @param inputTexture - Input GPU texture
   * @param outputTexture - Output GPU texture (must be storage-compatible and correctly sized)
   * @param srcWidth - Source image width
   * @param srcHeight - Source image height
   * @param dstWidth - Destination image width
   * @param dstHeight - Destination image height
   * @param angleDegrees - Rotation angle in degrees
   * @param encoder - Command encoder (optional, creates new if not provided)
   * @returns The command encoder used (for chaining)
   */
  applyToTextures(
    inputTexture: GPUTexture,
    outputTexture: GPUTexture,
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number,
    angleDegrees: number,
    encoder?: GPUCommandEncoder
  ): GPUCommandEncoder {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Calculate rotation parameters
    // Shader uses inverse rotation, so we pass cos(-angle), sin(-angle)
    const angleRad = (angleDegrees * Math.PI) / 180
    const cosAngle = Math.cos(-angleRad)
    const sinAngle = Math.sin(-angleRad)
    const srcCx = srcWidth / 2
    const srcCy = srcHeight / 2
    const dstCx = dstWidth / 2
    const dstCy = dstHeight / 2

    // Update params uniform buffer
    // Layout: cos_angle (f32), sin_angle (f32), src_cx (f32), src_cy (f32),
    //         dst_cx (f32), dst_cy (f32), src_width (u32), src_height (u32)
    const paramsData = new ArrayBuffer(32)
    const floatView = new Float32Array(paramsData)
    const uintView = new Uint32Array(paramsData)
    floatView[0] = cosAngle
    floatView[1] = sinAngle
    floatView[2] = srcCx
    floatView[3] = srcCy
    floatView[4] = dstCx
    floatView[5] = dstCy
    uintView[6] = srcWidth
    uintView[7] = srcHeight
    this.device.queue.writeBuffer(this.paramsBuffer!, 0, paramsData)

    // Update dimensions uniform buffer (output dimensions)
    const dimsData = new Uint32Array([dstWidth, dstHeight, 0, 0])
    this.device.queue.writeBuffer(this.dimsBuffer!, 0, dimsData.buffer)

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Rotation Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: this.paramsBuffer! } },
        { binding: 3, resource: { buffer: this.dimsBuffer! } },
      ],
    })

    // Create encoder if not provided
    const commandEncoder =
      encoder ||
      this.device.createCommandEncoder({
        label: 'Rotation Command Encoder',
      })

    // Calculate dispatch sizes
    const [workgroupsX, workgroupsY, workgroupsZ] = calculateDispatchSize(
      dstWidth,
      dstHeight,
      RotationPipeline.WORKGROUP_SIZE
    )

    // Begin compute pass
    const pass = commandEncoder.beginComputePass({
      label: 'Rotation Compute Pass',
    })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ)
    pass.end()

    return commandEncoder
  }

  /**
   * Destroy the pipeline and release resources.
   */
  destroy(): void {
    this.paramsBuffer?.destroy()
    this.dimsBuffer?.destroy()
    this.paramsBuffer = null
    this.dimsBuffer = null
    this.pipeline = null
    this.bindGroupLayout = null
  }
}

/**
 * Convert RGB pixel data to RGBA.
 */
function rgbToRgba(
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
 */
function rgbaToRgb(
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

/**
 * Singleton instance of the rotation pipeline.
 */
let _pipeline: RotationPipeline | null = null
let _initPromise: Promise<RotationPipeline | null> | null = null

/**
 * Get or create the rotation pipeline singleton.
 *
 * @returns The pipeline, or null if GPU is not available
 */
export async function getRotationPipeline(): Promise<RotationPipeline | null> {
  // Return in-flight initialization if one is running
  if (_initPromise) {
    return _initPromise
  }

  // Return existing instance if available
  if (_pipeline) {
    return _pipeline
  }

  // Start new initialization
  _initPromise = (async () => {
    const gpuService = getGPUCapabilityService()

    if (!gpuService.isReady || !gpuService.device) {
      return null
    }

    const pipeline = new RotationPipeline(gpuService.device)
    await pipeline.initialize()
    _pipeline = pipeline
    return pipeline
  })()

  try {
    return await _initPromise
  } finally {
    _initPromise = null
  }
}

/**
 * Reset the rotation pipeline singleton (for testing).
 */
export function resetRotationPipeline(): void {
  if (_pipeline) {
    _pipeline.destroy()
    _pipeline = null
  }
  _initPromise = null
}
