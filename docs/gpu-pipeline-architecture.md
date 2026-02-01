# GPU Pipeline Architecture Analysis

## Current High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           APPLICATION LAYER                                      │
│  useEditPreview.ts orchestrates rendering with draft/full quality state machine │
└─────────────────────────────────────────────────────────────────────┬───────────┘
                                                                      │
                        ┌─────────────────────────────────────────────┼─────────────────────────────────────┐
                        │                                             │                                     │
                        ▼                                             ▼                                     ▼
┌─────────────────────────────────┐  ┌─────────────────────────────────┐  ┌─────────────────────────────────┐
│       GPU SERVICES LAYER        │  │     ADAPTIVE PROCESSOR LAYER    │  │     UNIFIED EDIT PIPELINE       │
│  (High-level wrappers)          │  │  (GPU/WASM routing)             │  │  (Chains all operations)        │
│                                 │  │                                 │  │                                 │
│  • GPUAdjustmentsService        │  │  • Backend selection            │  │  • Single GPU upload            │
│  • GPUToneCurveService          │  │  • Error tracking + fallback    │  │  • Rotation → Adjustments →     │
│  • GPUMaskService               │  │  • Performance logging          │  │    ToneCurve → Masks            │
│  • GPUHistogramService          │  │                                 │  │  • Texture ping-pong            │
│  • GPUTransformService          │  │                                 │  │  • Single GPU readback          │
└───────────────┬─────────────────┘  └───────────────┬─────────────────┘  └───────────────┬─────────────────┘
                │                                     │                                     │
                │                                     │                                     │
                └─────────────────────────────────────┼─────────────────────────────────────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    INDIVIDUAL PIPELINES LAYER                                                │
│                                                                                                              │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐   │
│  │ AdjustmentsPipe  │ │ ToneCurvePipe    │ │   MaskPipeline   │ │ RotationPipeline │ │ HistogramPipeline│   │
│  │ (10 adjustments) │ │ (256-entry LUT)  │ │ (8L + 8R masks)  │ │ (bilinear interp)│ │ (4-channel)      │   │
│  └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘ └────────┬─────────┘   │
│           │                    │                    │                    │                    │             │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐                                             │
│  │   UberPipeline   │ │DownsamplePipeline│ │  (combines adj   │                                             │
│  │ (adj + tonecurve)│ │ (2x2 averaging)  │ │   + tonecurve)   │                                             │
│  └────────┬─────────┘ └────────┬─────────┘ └──────────────────┘                                             │
└───────────┼────────────────────┼────────────────────────────────────────────────────────────────────────────┘
            │                    │
            ▼                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                      INFRASTRUCTURE LAYER                                                    │
│                                                                                                              │
│  ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌──────────────────┐   │
│  │ GPUCapability    │ │  TexturePool     │ │  BufferPool      │ │  TimingHelper    │ │StagingBufferPool │   │
│  │ Service          │ │  (texture reuse) │ │  (buffer reuse)  │ │  (GPU timing)    │ │ (async readback) │   │
│  └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘ └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                      │
                                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         SHADER LAYER                                                         │
│                                                                                                              │
│  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐                │
│  │ adjustments.wgsl   │ │ tone-curve.wgsl    │ │ masks.wgsl         │ │ rotation.wgsl      │                │
│  └────────────────────┘ └────────────────────┘ └────────────────────┘ └────────────────────┘                │
│  ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐ ┌────────────────────┐                │
│  │ uber-adj.wgsl      │ │ uber-adj-f16.wgsl  │ │ histogram.wgsl     │ │ histogram-subgrp   │                │
│  │ (full precision)   │ │ (half precision)   │ │ (standard)         │ │ (optimized)        │                │
│  └────────────────────┘ └────────────────────┘ └────────────────────┘ └────────────────────┘                │
│  ┌────────────────────┐                                                                                      │
│  │ downsample.wgsl    │                                                                                      │
│  └────────────────────┘                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Through the Edit Pipeline

```
                                    INPUT
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  EditPipelineInput                                              │
│  { pixels: Uint8Array, width, height, format: 'rgb'|'rgba' }   │
└─────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    │ if format === 'rgb'               │
                    ▼                                   ▼
           ┌───────────────┐                  ┌───────────────┐
           │  rgbToRgba()  │                  │ (pass through)│
           │  CPU convert  │                  │               │
           └───────┬───────┘                  └───────┬───────┘
                   └─────────────────┬────────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  RGBA Uint8Array (4 bytes per pixel)                            │
└─────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  device.queue.writeTexture()  →  GPU Input Texture              │
└─────────────────────────────────────────────────────────────────┘
                                     │
                   ┌─────────────────┴─────────────────┐
                   │ if targetResolution < 1.0         │
                   ▼                                   ▼
          ┌────────────────┐                 ┌────────────────┐
          │ GPU Downsample │                 │  (skip)        │
          │ (2x2 averaging)│                 │                │
          └────────┬───────┘                 └────────┬───────┘
                   └─────────────────┬────────────────┘
                                     ▼
                   ┌─────────────────────────────────────┐
                   │      PIPELINE CHAIN (texture        │
                   │         ping-pong pattern)          │
                   └─────────────────────────────────────┘
                                     │
        ┌────────────────────────────┼────────────────────────────┐
        ▼                            ▼                            ▼
┌───────────────┐          ┌───────────────┐          ┌───────────────┐
│  STAGE 1:     │          │  STAGE 2+3:   │          │  STAGE 4:     │
│  Rotation     │    ───►  │  Uber OR      │    ───►  │  Masks        │
│  (if angle≠0) │          │  Adj+ToneCurve│          │  (if enabled) │
└───────────────┘          └───────────────┘          └───────────────┘
        │                            │                            │
        ▼                            ▼                            ▼
 (may change dims)         ┌─────────────────┐         (local adjustments)
                           │ If BOTH needed: │
                           │ → UberPipeline  │
                           │   (single pass) │
                           │                 │
                           │ If ONLY ONE:    │
                           │ → Separate pipe │
                           └─────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  readTexturePixels()  →  RGBA Uint8Array (from GPU)             │
└─────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │ if outputFormat === 'rgb'       │
                    ▼                                 ▼
           ┌───────────────┐                 ┌───────────────┐
           │  rgbaToRgb()  │                 │ (pass through)│
           │  CPU convert  │                 │               │
           └───────┬───────┘                 └───────┬───────┘
                   └─────────────────┬───────────────┘
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│  EditPipelineResult                                             │
│  { pixels, width, height, timing, format }                      │
└─────────────────────────────────────────────────────────────────┘
```

## Current Complexity Analysis

### 1. Abstraction Layer Explosion

```
┌──────────────────────────────────────────────────────────────────────────┐
│  LAYERS OF ABSTRACTION (to apply one adjustment):                        │
│                                                                          │
│  Application                                                             │
│       ↓                                                                  │
│  GPUAdjustmentsService.apply()        ← Wrapper #1                       │
│       ↓                                                                  │
│  AdaptiveProcessor.execute()          ← Wrapper #2 (routing)             │
│       ↓                                                                  │
│  AdjustmentsPipeline.apply()          ← Actual implementation            │
│       ↓                                                                  │
│  device.createTexture()               ← WebGPU                           │
│  device.queue.writeTexture()                                             │
│  device.createCommandEncoder()                                           │
│  encoder.beginComputePass()                                              │
│  pass.dispatchWorkgroups()                                               │
│  device.queue.submit()                                                   │
│  stagingBuffer.mapAsync()                                                │
│                                                                          │
│  RESULT: 4+ abstraction layers before hitting WebGPU                     │
└──────────────────────────────────────────────────────────────────────────┘
```

### 2. Code Duplication Pattern

Each pipeline follows the identical pattern with duplicated code:

```
┌───────────────────────────────────────────────────────────────────────────┐
│  REPEATED IN EVERY PIPELINE (~150 lines each):                            │
│                                                                           │
│  • Constructor with device storage                                        │
│  • initialize() with shader creation, bind group layout, uniform buffers  │
│  • apply() with:                                                          │
│      - Create input texture                                               │
│      - Upload pixels                                                      │
│      - Create output texture                                              │
│      - Update uniform buffers                                             │
│      - Create bind group                                                  │
│      - Create command encoder                                             │
│      - Begin compute pass                                                 │
│      - Dispatch workgroups                                                │
│      - Create staging buffer                                              │
│      - Copy texture to buffer                                             │
│      - Submit commands                                                    │
│      - Map and read back                                                  │
│      - Cleanup                                                            │
│  • applyToTextures() (subset for chaining)                               │
│  • destroy()                                                              │
│  • Singleton getter + reset                                               │
│                                                                           │
│  FILES: adjustments-pipeline.ts, tone-curve-pipeline.ts,                  │
│         mask-pipeline.ts, uber-pipeline.ts, rotation-pipeline.ts,         │
│         histogram-pipeline.ts, downsample-pipeline.ts                     │
│                                                                           │
│  DUPLICATION: ~1000+ lines of nearly identical boilerplate               │
└───────────────────────────────────────────────────────────────────────────┘
```

### 3. Service Layer Redundancy

```
┌──────────────────────────────────────────────────────────────────────────┐
│  GPU SERVICES (each ~100-200 lines):                                     │
│                                                                          │
│  gpu-adjustments-service.ts    │  Just wraps AdjustmentsPipeline         │
│  gpu-tone-curve-service.ts     │  Just wraps ToneCurvePipeline           │
│  gpu-mask-service.ts           │  Just wraps MaskPipeline                │
│  gpu-histogram-service.ts      │  Just wraps HistogramPipeline           │
│  gpu-transform-service.ts      │  Just wraps RotationPipeline            │
│                                                                          │
│  Each service:                                                           │
│  • Gets the singleton pipeline                                           │
│  • Calls pipeline.apply()                                                │
│  • Converts between RGB/RGBA                                             │
│  • Returns result                                                        │
│                                                                          │
│  REDUNDANCY: ~600 lines of thin wrappers                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Simplification Recommendations

### Proposal 1: Unified Pipeline Base Class

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         PROPOSED: GPUPipelineBase                               │
│                                                                                 │
│  class GPUPipelineBase<TParams, TResult = Uint8Array> {                        │
│    protected device: GPUDevice                                                  │
│    protected pipeline: GPUComputePipeline                                       │
│    protected bindGroupLayout: GPUBindGroupLayout                                │
│    protected texturePool: TexturePool                                          │
│                                                                                 │
│    // SHARED METHODS (eliminates duplication):                                  │
│    protected createInputTexture(pixels, width, height)                         │
│    protected createOutputTexture(width, height)                                 │
│    protected createBindGroup(entries)                                          │
│    protected dispatchAndReadback(encoder, outputTexture, width, height)        │
│                                                                                 │
│    // ABSTRACT (each pipeline implements):                                      │
│    abstract getShaderSource(): string                                          │
│    abstract getBindGroupLayoutEntries(): GPUBindGroupLayoutEntry[]             │
│    abstract createBindGroupEntries(input, output, params): GPUBindGroupEntry[] │
│    abstract getWorkgroupSize(): number                                         │
│  }                                                                              │
│                                                                                 │
│  BENEFIT: ~800 lines of boilerplate → ~200 lines in base class                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Proposal 2: Eliminate Service Layer

```
BEFORE:                                    AFTER:
────────────────────────                   ────────────────────────
App                                        App
  ↓                                          ↓
GPUAdjustmentsService                      GPUEditPipeline.process()
  ↓                                          (unified entry point)
AdaptiveProcessor
  ↓
AdjustmentsPipeline

5 service files (~600 lines)     →         0 service files
```

**Rationale**: The `GPUEditPipeline` already chains all operations efficiently. The individual services are only used for standalone operations that could be methods on `GPUEditPipeline`.

### Proposal 3: Merge UberPipeline Into Adjustments

```
CURRENT:                                   PROPOSED:
─────────────────────────────              ─────────────────────────────
AdjustmentsPipeline (414 lines)            AdjustmentsPipeline (expanded)
ToneCurvePipeline (~300 lines)               • Has tone curve LUT support built-in
UberPipeline (561 lines)                     • Uses override constants like uber
                                             • Single shader with feature flags
~1275 lines total
                                           ~500 lines total

SHADER APPROACH:
override const ENABLE_TONE_CURVE: u32 = 0;

@compute @workgroup_size(16, 16)
fn main(...) {
    var color = applyAdjustments(inputColor, adjustments);

    if (ENABLE_TONE_CURVE != 0u) {
        color = applyToneCurve(color, lutTexture);
    }

    output[pos] = color;
}
```

### Proposal 4: Simplified Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          PROPOSED SIMPLIFIED ARCHITECTURE                        │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                         APPLICATION LAYER                                   │ │
│  │  useEditPreview.ts                                                         │ │
│  └────────────────────────────────────────────────────────────┬───────────────┘ │
│                                                               │                  │
│                                                               ▼                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                      GPUEditPipeline (SINGLE ENTRY POINT)                   │ │
│  │                                                                             │ │
│  │  • process(input, params) → EditPipelineResult                             │ │
│  │  • Handles RGB↔RGBA conversion internally                                   │ │
│  │  • Chains operations with texture ping-pong                                 │ │
│  │  • Manages texture pool                                                     │ │
│  │  • GPU/WASM fallback built-in (no separate AdaptiveProcessor)              │ │
│  └────────────────────────────────────────────────────────────┬───────────────┘ │
│                                                               │                  │
│                                                               ▼                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                         GPU OPERATIONS (Lightweight)                        │ │
│  │                                                                             │ │
│  │  Each operation is a small module with:                                    │ │
│  │  • Shader source                                                           │ │
│  │  • applyToTextures(in, out, params, encoder) → encoder                     │ │
│  │                                                                             │ │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐           │ │
│  │  │ adjustments │ │   masks     │ │  rotation   │ │  histogram  │           │ │
│  │  │ + tonecurve │ │             │ │             │ │             │           │ │
│  │  │ (merged)    │ │             │ │             │ │             │           │ │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘           │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────┐ │
│  │                         INFRASTRUCTURE (Shared)                             │ │
│  │  TexturePool │ GPUCapabilityService │ TimingHelper                         │ │
│  └────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────┘

ELIMINATED:
• 5 GPU service files (~600 lines)
• AdaptiveProcessor (~400 lines) - merged into GPUEditPipeline
• Separate ToneCurvePipeline (~300 lines) - merged into adjustments
• UberPipeline (~550 lines) - merged into adjustments
• Redundant singleton boilerplate (~200 lines)

TOTAL REDUCTION: ~2000+ lines (~25% of GPU module)
```

### Proposal 5: Single Uber-Shader Strategy

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│  CURRENT: 10 shader files with variants                                         │
│                                                                                  │
│  adjustments.wgsl          histogram.wgsl                                       │
│  tone-curve.wgsl           histogram-subgroup.wgsl                              │
│  masks.wgsl                rotation.wgsl                                        │
│  uber-adjustments.wgsl     downsample.wgsl                                      │
│  uber-adjustments-f16.wgsl                                                      │
├─────────────────────────────────────────────────────────────────────────────────┤
│  PROPOSED: 4 shader files (consolidate related functionality)                   │
│                                                                                  │
│  edit-operations.wgsl      // Adjustments + ToneCurve (with override constants) │
│  masks.wgsl                // Unchanged                                         │
│  transforms.wgsl           // Rotation + Downsample                             │
│  histogram.wgsl            // With optional subgroup path via override constant │
│                                                                                  │
│  SHADER SPECIALIZATION VIA OVERRIDE CONSTANTS:                                  │
│  override const USE_TONE_CURVE: u32 = 0;                                       │
│  override const USE_F16: u32 = 0;                                              │
│  override const USE_SUBGROUPS: u32 = 0;                                        │
│                                                                                  │
│  // GPU driver optimizes away disabled branches at compile time                 │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Proposal 6: Functional Pipeline Composition

Instead of class-based singletons, use functional composition:

```typescript
// PROPOSED: Functional approach
type GPUOperation = (
  input: GPUTexture,
  output: GPUTexture,
  params: unknown,
  encoder: GPUCommandEncoder
) => GPUCommandEncoder

const createAdjustmentsOp = (device: GPUDevice): GPUOperation => {
  // Initialize once, return closure
  const pipeline = device.createComputePipeline(...)
  const uniformBuffer = device.createBuffer(...)

  return (input, output, params, encoder) => {
    // Minimal per-frame work
    device.queue.writeBuffer(uniformBuffer, 0, packParams(params))
    const pass = encoder.beginComputePass()
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, createBindGroup(input, output, uniformBuffer))
    pass.dispatchWorkgroups(...)
    pass.end()
    return encoder
  }
}

// Usage: compose operations
const processImage = pipe(
  rotationOp,
  adjustmentsOp,
  masksOp
)
```

---

## Summary: Lines of Code Impact

| Component | Current | Proposed | Savings |
|-----------|---------|----------|---------|
| Pipeline classes (7) | ~2500 | ~800 | ~1700 |
| Service wrappers (5) | ~600 | 0 | ~600 |
| AdaptiveProcessor | ~400 | 0 | ~400 |
| Shader files | 10 | 4 | 6 files |
| Singleton boilerplate | ~300 | ~50 | ~250 |
| **Total** | **~3800** | **~850** | **~2950 (77%)** |

## Key Principles for Simplification

1. **Single Entry Point**: `GPUEditPipeline.process()` handles everything
2. **Eliminate Wrappers**: No services, no adaptive processor as separate entity
3. **Merge Related Operations**: Adjustments + ToneCurve become one
4. **Functional Over Class-Based**: Closures capture initialized state
5. **Override Constants**: One shader with feature flags beats multiple shaders
6. **Inline Fallback Logic**: GPU/WASM decision in the pipeline, not separate layer

---

## Implementation Priority

### Phase 1: Quick Wins (Low Risk)
- Delete unused service wrappers if not referenced
- Consolidate shader variants using override constants

### Phase 2: Refactor Pipelines (Medium Risk)
- Create `GPUPipelineBase` class
- Migrate existing pipelines to extend base

### Phase 3: Architectural Cleanup (Higher Risk)
- Merge UberPipeline into AdjustmentsPipeline
- Inline AdaptiveProcessor logic into GPUEditPipeline
- Remove separate ToneCurvePipeline
