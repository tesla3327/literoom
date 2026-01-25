/// <reference types="@webgpu/types" />
/**
 * GPU pipeline for gradient mask application.
 *
 * Applies linear and radial gradient masks with per-mask adjustments using a
 * WebGPU compute shader. Supports up to 8 linear masks and 8 radial masks.
 */

import { getGPUCapabilityService } from '../capabilities'
import { MASKS_SHADER_SOURCE } from '../shaders'
import {
  createTextureFromPixels,
  createOutputTexture,
  readTexturePixels,
  calculateDispatchSize,
  TextureUsage,
} from '../texture-utils'

/**
 * Maximum number of masks supported (must match shader constant).
 */
export const MAX_MASKS = 8

/**
 * Per-mask adjustment parameters for GPU processing.
 */
export interface GPUMaskAdjustments {
  exposure: number // -5 to 5 stops
  contrast: number // -100 to 100
  temperature: number // -100 to 100
  tint: number // -100 to 100
  highlights: number // -100 to 100
  shadows: number // -100 to 100
  saturation: number // -100 to 100
  vibrance: number // -100 to 100
}

/**
 * Default mask adjustments (no change).
 */
export const DEFAULT_GPU_MASK_ADJUSTMENTS: GPUMaskAdjustments = {
  exposure: 0,
  contrast: 0,
  temperature: 0,
  tint: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  vibrance: 0,
}

/**
 * Linear gradient mask definition.
 */
export interface LinearMaskData {
  startX: number // Normalized 0-1
  startY: number // Normalized 0-1
  endX: number // Normalized 0-1
  endY: number // Normalized 0-1
  feather: number // 0 = hard, 1 = full gradient
  enabled: boolean
  adjustments: Partial<GPUMaskAdjustments>
}

/**
 * Radial gradient mask definition.
 */
export interface RadialMaskData {
  centerX: number // Normalized 0-1
  centerY: number // Normalized 0-1
  radiusX: number // Normalized
  radiusY: number // Normalized
  rotation: number // Radians
  feather: number // 0 = hard, 1 = full gradient
  invert: boolean
  enabled: boolean
  adjustments: Partial<GPUMaskAdjustments>
}

/**
 * Mask stack data containing all masks to apply.
 */
export interface MaskStackInput {
  linearMasks: LinearMaskData[]
  radialMasks: RadialMaskData[]
}

// Buffer sizes (in bytes)
// MaskAdjustments: 8 f32 = 32 bytes
// LinearMask: 8 values + MaskAdjustments = 32 + 32 = 64 bytes
// RadialMask: 8 values + MaskAdjustments = 32 + 32 = 64 bytes
// MaskParams: 8*64 + 8*64 + 16 = 1040 bytes
const MASK_ADJUSTMENTS_SIZE = 32 // 8 f32
const LINEAR_MASK_SIZE = 64 // 8 values + adjustments
const RADIAL_MASK_SIZE = 64 // 8 values + adjustments
const MASK_PARAMS_SIZE = LINEAR_MASK_SIZE * MAX_MASKS + RADIAL_MASK_SIZE * MAX_MASKS + 16 // 1040 bytes

/**
 * GPU pipeline for applying gradient masks.
 */
export class MaskPipeline {
  private device: GPUDevice
  private pipeline: GPUComputePipeline | null = null
  private bindGroupLayout: GPUBindGroupLayout | null = null

  // Reusable uniform buffers
  private maskParamsBuffer: GPUBuffer | null = null
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
      label: 'Mask Shader',
      code: MASKS_SHADER_SOURCE,
    })

    // Create bind group layout
    this.bindGroupLayout = this.device.createBindGroupLayout({
      label: 'Mask Bind Group Layout',
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
          // Mask parameters uniform buffer
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
      label: 'Mask Pipeline Layout',
      bindGroupLayouts: [this.bindGroupLayout],
    })

    // Create compute pipeline
    this.pipeline = this.device.createComputePipeline({
      label: 'Mask Compute Pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main_masks',
      },
    })

    // Create reusable uniform buffers
    this.maskParamsBuffer = this.device.createBuffer({
      label: 'Mask Params Uniform Buffer',
      size: MASK_PARAMS_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })

    // Dimensions: 2 u32 values = 8 bytes (padded to 16)
    this.dimensionsBuffer = this.device.createBuffer({
      label: 'Mask Dimensions Uniform Buffer',
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
  }

  /**
   * Pack mask adjustments into a Float32Array.
   */
  private packMaskAdjustments(adj: Partial<GPUMaskAdjustments>): Float32Array {
    return new Float32Array([
      adj.exposure ?? 0,
      adj.contrast ?? 0,
      adj.temperature ?? 0,
      adj.tint ?? 0,
      adj.highlights ?? 0,
      adj.shadows ?? 0,
      adj.saturation ?? 0,
      adj.vibrance ?? 0,
    ])
  }

  /**
   * Pack a linear mask into a Float32Array (with u32 for enabled).
   */
  private packLinearMask(mask: LinearMaskData): ArrayBuffer {
    const buffer = new ArrayBuffer(LINEAR_MASK_SIZE)
    const floatView = new Float32Array(buffer)
    const uintView = new Uint32Array(buffer)

    // Geometry (5 f32)
    floatView[0] = mask.startX
    floatView[1] = mask.startY
    floatView[2] = mask.endX
    floatView[3] = mask.endY
    floatView[4] = mask.feather

    // Enabled (1 u32)
    uintView[5] = mask.enabled ? 1 : 0

    // Padding (2 f32)
    floatView[6] = 0
    floatView[7] = 0

    // Adjustments (8 f32)
    const adj = this.packMaskAdjustments(mask.adjustments)
    for (let i = 0; i < 8; i++) {
      floatView[8 + i] = adj[i]!
    }

    return buffer
  }

  /**
   * Pack a radial mask into a Float32Array (with u32 for invert/enabled).
   */
  private packRadialMask(mask: RadialMaskData): ArrayBuffer {
    const buffer = new ArrayBuffer(RADIAL_MASK_SIZE)
    const floatView = new Float32Array(buffer)
    const uintView = new Uint32Array(buffer)

    // Geometry (6 f32)
    floatView[0] = mask.centerX
    floatView[1] = mask.centerY
    floatView[2] = mask.radiusX
    floatView[3] = mask.radiusY
    floatView[4] = mask.rotation
    floatView[5] = mask.feather

    // Invert and enabled (2 u32)
    uintView[6] = mask.invert ? 1 : 0
    uintView[7] = mask.enabled ? 1 : 0

    // Adjustments (8 f32)
    const adj = this.packMaskAdjustments(mask.adjustments)
    for (let i = 0; i < 8; i++) {
      floatView[8 + i] = adj[i]!
    }

    return buffer
  }

  /**
   * Pack the full mask params into a single buffer.
   */
  private packMaskParams(masks: MaskStackInput): ArrayBuffer {
    const buffer = new ArrayBuffer(MASK_PARAMS_SIZE)
    const uint8View = new Uint8Array(buffer)
    const uintView = new Uint32Array(buffer)

    // Pack linear masks (up to MAX_MASKS)
    const linearCount = Math.min(masks.linearMasks.length, MAX_MASKS)
    for (let i = 0; i < linearCount; i++) {
      const maskBuffer = this.packLinearMask(masks.linearMasks[i]!)
      uint8View.set(new Uint8Array(maskBuffer), i * LINEAR_MASK_SIZE)
    }

    // Pack radial masks (up to MAX_MASKS)
    const radialOffset = LINEAR_MASK_SIZE * MAX_MASKS
    const radialCount = Math.min(masks.radialMasks.length, MAX_MASKS)
    for (let i = 0; i < radialCount; i++) {
      const maskBuffer = this.packRadialMask(masks.radialMasks[i]!)
      uint8View.set(new Uint8Array(maskBuffer), radialOffset + i * RADIAL_MASK_SIZE)
    }

    // Pack counts (at the end of the buffer)
    const countsOffset = (LINEAR_MASK_SIZE * MAX_MASKS + RADIAL_MASK_SIZE * MAX_MASKS) / 4
    uintView[countsOffset] = linearCount
    uintView[countsOffset + 1] = radialCount
    uintView[countsOffset + 2] = 0 // padding
    uintView[countsOffset + 3] = 0 // padding

    return buffer
  }

  /**
   * Check if mask stack has any enabled masks.
   */
  private hasEnabledMasks(masks: MaskStackInput): boolean {
    const hasLinear = masks.linearMasks.some((m) => m.enabled)
    const hasRadial = masks.radialMasks.some((m) => m.enabled)
    return hasLinear || hasRadial
  }

  /**
   * Apply masks to an image.
   *
   * @param inputPixels - Input RGBA pixel data (Uint8Array)
   * @param width - Image width in pixels
   * @param height - Image height in pixels
   * @param masks - Mask stack to apply
   * @returns Processed RGBA pixel data
   */
  async apply(
    inputPixels: Uint8Array,
    width: number,
    height: number,
    masks: MaskStackInput
  ): Promise<Uint8Array> {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Early exit if no enabled masks
    if (!this.hasEnabledMasks(masks)) {
      return inputPixels.slice() // Return copy
    }

    // Create textures using shared utilities
    const inputTexture = createTextureFromPixels(
      this.device,
      inputPixels,
      width,
      height,
      TextureUsage.INPUT,
      'Mask Input Texture'
    )
    const outputTexture = createOutputTexture(
      this.device,
      width,
      height,
      TextureUsage.OUTPUT,
      'Mask Output Texture'
    )

    // Update uniform buffers
    this.device.queue.writeBuffer(this.maskParamsBuffer!, 0, this.packMaskParams(masks))
    this.device.queue.writeBuffer(this.dimensionsBuffer!, 0, new Uint32Array([width, height, 0, 0]))

    // Create bind group and dispatch
    const bindGroup = this.device.createBindGroup({
      label: 'Mask Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: this.maskParamsBuffer! } },
        { binding: 3, resource: { buffer: this.dimensionsBuffer! } },
      ],
    })

    const encoder = this.device.createCommandEncoder({ label: 'Mask Command Encoder' })
    const pass = encoder.beginComputePass({ label: 'Mask Compute Pass' })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    const [workgroupsX, workgroupsY] = calculateDispatchSize(width, height, MaskPipeline.WORKGROUP_SIZE)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1)
    pass.end()
    this.device.queue.submit([encoder.finish()])

    // Read back results using shared utility
    const resultData = await readTexturePixels(this.device, outputTexture, width, height)

    // Cleanup
    inputTexture.destroy()
    outputTexture.destroy()

    return resultData
  }

  /**
   * Apply masks with textures already on GPU.
   *
   * This is more efficient when chaining multiple operations
   * as it avoids CPU-GPU transfers between operations.
   *
   * @param inputTexture - Input GPU texture
   * @param outputTexture - Output GPU texture (must be storage-compatible)
   * @param width - Image width
   * @param height - Image height
   * @param masks - Mask stack to apply
   * @param encoder - Command encoder (optional, creates new if not provided)
   * @returns The command encoder used (for chaining)
   */
  applyToTextures(
    inputTexture: GPUTexture,
    outputTexture: GPUTexture,
    width: number,
    height: number,
    masks: MaskStackInput,
    encoder?: GPUCommandEncoder
  ): GPUCommandEncoder {
    if (!this.pipeline || !this.bindGroupLayout) {
      throw new Error('Pipeline not initialized. Call initialize() first.')
    }

    // Update uniform buffers
    this.device.queue.writeBuffer(this.maskParamsBuffer!, 0, this.packMaskParams(masks))
    this.device.queue.writeBuffer(this.dimensionsBuffer!, 0, new Uint32Array([width, height, 0, 0]))

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Mask Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: inputTexture.createView() },
        { binding: 1, resource: outputTexture.createView() },
        { binding: 2, resource: { buffer: this.maskParamsBuffer! } },
        { binding: 3, resource: { buffer: this.dimensionsBuffer! } },
      ],
    })

    const commandEncoder = encoder || this.device.createCommandEncoder({ label: 'Mask Command Encoder' })
    const pass = commandEncoder.beginComputePass({ label: 'Mask Compute Pass' })
    pass.setPipeline(this.pipeline)
    pass.setBindGroup(0, bindGroup)
    const [workgroupsX, workgroupsY] = calculateDispatchSize(width, height, MaskPipeline.WORKGROUP_SIZE)
    pass.dispatchWorkgroups(workgroupsX, workgroupsY, 1)
    pass.end()

    return commandEncoder
  }

  /**
   * Destroy the pipeline and release resources.
   */
  destroy(): void {
    this.maskParamsBuffer?.destroy()
    this.dimensionsBuffer?.destroy()
    this.maskParamsBuffer = null
    this.dimensionsBuffer = null
    this.pipeline = null
    this.bindGroupLayout = null
  }
}

/**
 * Singleton instance of the mask pipeline.
 */
let _maskPipeline: MaskPipeline | null = null

/**
 * Get or create the mask pipeline singleton.
 *
 * @returns The pipeline, or null if GPU is not available
 */
export async function getMaskPipeline(): Promise<MaskPipeline | null> {
  const gpuService = getGPUCapabilityService()

  if (!gpuService.isReady || !gpuService.device) {
    return null
  }

  if (!_maskPipeline) {
    _maskPipeline = new MaskPipeline(gpuService.device)
    await _maskPipeline.initialize()
  }

  return _maskPipeline
}

/**
 * Reset the mask pipeline singleton (for testing).
 */
export function resetMaskPipeline(): void {
  if (_maskPipeline) {
    _maskPipeline.destroy()
    _maskPipeline = null
  }
}
