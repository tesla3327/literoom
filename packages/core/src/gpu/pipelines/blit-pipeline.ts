/// <reference types="@webgpu/types" />
/**
 * Blit pipeline for copying textures with format conversion.
 *
 * WebGPU's copyTextureToTexture requires matching formats, but canvas textures
 * often use BGRA8Unorm (macOS) while internal textures use RGBA8Unorm.
 * This pipeline renders a fullscreen triangle to handle the conversion.
 */

/**
 * Shader for fullscreen blit with format conversion.
 * Uses a single triangle that covers the entire screen (more efficient than a quad).
 */
const BLIT_SHADER = /* wgsl */ `
@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

// Fullscreen triangle vertices - covers entire screen with one triangle
@vertex
fn vertexMain(@builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  var output: VertexOutput;

  // Generate fullscreen triangle vertices
  // Vertex 0: (-1, -1), Vertex 1: (3, -1), Vertex 2: (-1, 3)
  let x = f32((vertexIndex & 1u) << 2u) - 1.0;
  let y = f32((vertexIndex & 2u) << 1u) - 1.0;

  output.position = vec4<f32>(x, y, 0.0, 1.0);
  // UV: flip Y for texture coordinates
  output.uv = vec2<f32>((x + 1.0) * 0.5, (1.0 - y) * 0.5);

  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  return textureSample(srcTexture, srcSampler, input.uv);
}
`

/**
 * Pipeline for blitting textures with potential format conversion.
 */
export class BlitPipeline {
  private device: GPUDevice
  private pipeline: GPURenderPipeline | null = null
  private sampler: GPUSampler
  private bindGroupLayout: GPUBindGroupLayout

  constructor(device: GPUDevice) {
    this.device = device

    // Create sampler for texture sampling
    this.sampler = device.createSampler({
      label: 'Blit Sampler',
      magFilter: 'linear',
      minFilter: 'linear',
    })

    // Create bind group layout
    this.bindGroupLayout = device.createBindGroupLayout({
      label: 'Blit Bind Group Layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: 'float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          sampler: { type: 'filtering' },
        },
      ],
    })
  }

  /**
   * Get or create the render pipeline for a specific target format.
   */
  private getPipeline(targetFormat: GPUTextureFormat): GPURenderPipeline {
    // Create pipeline if not cached or format changed
    if (!this.pipeline) {
      const shaderModule = this.device.createShaderModule({
        label: 'Blit Shader',
        code: BLIT_SHADER,
      })

      const pipelineLayout = this.device.createPipelineLayout({
        label: 'Blit Pipeline Layout',
        bindGroupLayouts: [this.bindGroupLayout],
      })

      this.pipeline = this.device.createRenderPipeline({
        label: 'Blit Render Pipeline',
        layout: pipelineLayout,
        vertex: {
          module: shaderModule,
          entryPoint: 'vertexMain',
        },
        fragment: {
          module: shaderModule,
          entryPoint: 'fragmentMain',
          targets: [{ format: targetFormat }],
        },
        primitive: {
          topology: 'triangle-list',
        },
      })
    }

    return this.pipeline
  }

  /**
   * Blit source texture to target texture using a render pass.
   *
   * This handles format conversion (e.g., RGBA8Unorm to BGRA8Unorm) that
   * copyTextureToTexture cannot handle.
   *
   * @param source - Source texture (RGBA8Unorm)
   * @param target - Target texture (any format supported by render attachments)
   * @param encoder - Command encoder to add commands to
   * @returns The encoder for chaining
   */
  blit(
    source: GPUTexture,
    target: GPUTexture,
    encoder: GPUCommandEncoder
  ): GPUCommandEncoder {
    const pipeline = this.getPipeline(target.format)

    // Create bind group for this blit operation
    const bindGroup = this.device.createBindGroup({
      label: 'Blit Bind Group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: this.sampler },
      ],
    })

    // Create render pass
    const passEncoder = encoder.beginRenderPass({
      label: 'Blit Render Pass',
      colorAttachments: [
        {
          view: target.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    })

    passEncoder.setPipeline(pipeline)
    passEncoder.setBindGroup(0, bindGroup)
    passEncoder.draw(3) // Fullscreen triangle
    passEncoder.end()

    return encoder
  }
}
