# GPU Pipeline Integration Implementation Plan

**Date**: 2026-01-23
**Based on**: `docs/research/2026-01-23-gpu-pipeline-integration-synthesis.md`
**Phase**: GPU Acceleration Phase 7

## Overview

Create a unified GPU edit pipeline that chains all operations for 60fps preview updates. This plan takes an incremental approach, first enabling existing GPU services, then building a unified coordinator.

## Goals

1. Enable GPU adjustments and tone curve in preview pipeline
2. Reduce GPU↔CPU transfers from 4 to 1 round-trip
3. Achieve <16ms full pipeline for 60fps preview
4. Maintain seamless WASM fallback

## Current State

The preview pipeline in useEditPreview.ts currently:
- Uses GPU adaptive for rotation and masks
- Uses WASM for crop, adjustments, and tone curve
- Does 2 GPU round-trips (rotation + masks)
- Total render time ~500ms

## Implementation Phases

### Phase 7.1: Enable GPU Adjustments (Quick Win)

**Objective**: Replace WASM adjustments with GPU adaptive

**Modify**: `apps/web/app/composables/useEditPreview.ts`

Replace lines 570-581:
```typescript
// Current (WASM):
if (hasAdjustments) {
  const adjusted = await $decodeService.applyAdjustments(
    currentPixels, currentWidth, currentHeight, adjustments
  )
  currentPixels = adjusted.pixels
}

// New (GPU adaptive):
import { applyAdjustmentsAdaptive } from '@literoom/core/gpu'

if (hasAdjustments) {
  const { result, backend, timing } = await applyAdjustmentsAdaptive(
    currentPixels,
    currentWidth,
    currentHeight,
    adjustments,
    () => $decodeService.applyAdjustments(
      currentPixels, currentWidth, currentHeight, adjustments
    )
  )
  console.log(`[useEditPreview] Adjustments via ${backend} in ${timing.toFixed(1)}ms`)
  currentPixels = result.pixels
}
```

**Acceptance Criteria**:
- [ ] GPU adjustments enabled in preview
- [ ] Console shows "webgpu" backend
- [ ] Visual output matches WASM
- [ ] Fallback works when GPU unavailable

### Phase 7.2: Enable GPU Tone Curve

**Objective**: Replace WASM tone curve with GPU adaptive

**Modify**: `apps/web/app/composables/useEditPreview.ts`

Replace lines 583-594:
```typescript
// Current (WASM):
if (!isLinearCurve(adjustments.toneCurve.points)) {
  const curved = await $decodeService.applyToneCurve(
    currentPixels, currentWidth, currentHeight, adjustments.toneCurve.points
  )
  currentPixels = curved.pixels
}

// New (GPU adaptive):
import { applyToneCurveAdaptive } from '@literoom/core/gpu'

if (!isLinearCurve(adjustments.toneCurve.points)) {
  const { result, backend, timing } = await applyToneCurveAdaptive(
    currentPixels,
    currentWidth,
    currentHeight,
    adjustments.toneCurve.points,
    () => $decodeService.applyToneCurve(
      currentPixels, currentWidth, currentHeight, adjustments.toneCurve.points
    )
  )
  console.log(`[useEditPreview] ToneCurve via ${backend} in ${timing.toFixed(1)}ms`)
  currentPixels = result.pixels
}
```

**Acceptance Criteria**:
- [ ] GPU tone curve enabled in preview
- [ ] Console shows "webgpu" backend
- [ ] Visual output matches WASM
- [ ] Identity curve fast path works

### Phase 7.3: Create GPUEditPipeline Coordinator

**Objective**: Chain all GPU operations with single upload/readback

**Create**: `packages/core/src/gpu/pipelines/edit-pipeline.ts`

```typescript
import type { BasicAdjustments } from '../../decode/types'
import type { ToneCurvePoint } from '../../decode/types'
import type { MaskStackInput } from './mask-pipeline'
import { getAdjustmentsPipeline } from './adjustments-pipeline'
import { getToneCurvePipeline } from './tone-curve-pipeline'
import { getMaskPipeline } from './mask-pipeline'
import { getRotationPipeline, RotationPipeline } from './rotation-pipeline'
import { getGPUCapabilityService } from '../capabilities'
import { createTextureFromPixels, readTexturePixels, TextureUsage } from '../texture-utils'

export interface EditPipelineInput {
  pixels: Uint8Array  // RGB
  width: number
  height: number
}

export interface EditPipelineParams {
  rotation?: number  // degrees
  adjustments?: BasicAdjustments
  toneCurve?: ToneCurvePoint[]
  masks?: MaskStackInput
}

export interface EditPipelineResult {
  pixels: Uint8Array  // RGB
  width: number
  height: number
  timing: {
    total: number
    upload: number
    rotation: number
    adjustments: number
    toneCurve: number
    masks: number
    readback: number
  }
}

export class GPUEditPipeline {
  private device: GPUDevice | null = null
  private _initialized = false

  get isReady(): boolean {
    return this._initialized && this.device !== null
  }

  async initialize(): Promise<boolean> {
    if (this._initialized) return this.isReady

    const gpuService = getGPUCapabilityService()
    await gpuService.initialize()

    if (!gpuService.isAvailable) {
      this._initialized = true
      return false
    }

    this.device = gpuService.device
    this._initialized = true
    return this.device !== null
  }

  async process(
    input: EditPipelineInput,
    params: EditPipelineParams
  ): Promise<EditPipelineResult> {
    if (!this.device) {
      throw new Error('GPUEditPipeline not initialized')
    }

    const timing = {
      total: 0,
      upload: 0,
      rotation: 0,
      adjustments: 0,
      toneCurve: 0,
      masks: 0,
      readback: 0,
    }

    const totalStart = performance.now()

    // Get all pipelines
    const [rotationPipeline, adjustmentsPipeline, toneCurvePipeline, maskPipeline] =
      await Promise.all([
        params.rotation ? getRotationPipeline() : null,
        params.adjustments ? getAdjustmentsPipeline() : null,
        params.toneCurve ? getToneCurvePipeline() : null,
        params.masks ? getMaskPipeline() : null,
      ])

    // Convert RGB to RGBA
    const rgba = rgbToRgba(input.pixels, input.width, input.height)

    // Upload to GPU
    const uploadStart = performance.now()
    let currentWidth = input.width
    let currentHeight = input.height
    let inputTexture = createTextureFromPixels(
      this.device,
      rgba,
      currentWidth,
      currentHeight,
      TextureUsage.INPUT
    )
    timing.upload = performance.now() - uploadStart

    // Create command encoder for chaining
    let encoder = this.device.createCommandEncoder()

    // Output texture (will be swapped as ping-pong)
    let outputTexture: GPUTexture

    // Stage 1: Rotation (changes dimensions)
    if (params.rotation && rotationPipeline && Math.abs(params.rotation) > 0.001) {
      const rotStart = performance.now()
      const rotDims = RotationPipeline.computeRotatedDimensions(
        currentWidth, currentHeight, params.rotation
      )
      outputTexture = this.device.createTexture({
        size: { width: rotDims.width, height: rotDims.height },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
      })
      encoder = rotationPipeline.applyToTextures(
        inputTexture, outputTexture,
        currentWidth, currentHeight,
        rotDims.width, rotDims.height,
        params.rotation, encoder
      )
      inputTexture.destroy()
      inputTexture = outputTexture
      currentWidth = rotDims.width
      currentHeight = rotDims.height
      timing.rotation = performance.now() - rotStart
    }

    // Stage 2: Adjustments (fixed dimensions)
    if (params.adjustments && adjustmentsPipeline) {
      const adjStart = performance.now()
      outputTexture = this.device.createTexture({
        size: { width: currentWidth, height: currentHeight },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
      })
      encoder = adjustmentsPipeline.applyToTextures(
        inputTexture, outputTexture,
        currentWidth, currentHeight,
        params.adjustments, encoder
      )
      inputTexture.destroy()
      inputTexture = outputTexture
      timing.adjustments = performance.now() - adjStart
    }

    // Stage 3: Tone Curve (fixed dimensions)
    if (params.toneCurve && toneCurvePipeline) {
      const curveStart = performance.now()
      const lut = toneCurvePipeline.generateLut(params.toneCurve)
      outputTexture = this.device.createTexture({
        size: { width: currentWidth, height: currentHeight },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
      })
      encoder = toneCurvePipeline.applyToTextures(
        inputTexture, outputTexture,
        currentWidth, currentHeight,
        lut, encoder
      )
      inputTexture.destroy()
      inputTexture = outputTexture
      timing.toneCurve = performance.now() - curveStart
    }

    // Stage 4: Masks (fixed dimensions)
    if (params.masks && maskPipeline) {
      const maskStart = performance.now()
      outputTexture = this.device.createTexture({
        size: { width: currentWidth, height: currentHeight },
        format: 'rgba8unorm',
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING,
      })
      encoder = maskPipeline.applyToTextures(
        inputTexture, outputTexture,
        currentWidth, currentHeight,
        params.masks, encoder
      )
      inputTexture.destroy()
      inputTexture = outputTexture
      timing.masks = performance.now() - maskStart
    }

    // Submit all operations
    this.device.queue.submit([encoder.finish()])

    // Readback
    const readStart = performance.now()
    const resultRgba = await readTexturePixels(
      this.device, inputTexture, currentWidth, currentHeight
    )
    timing.readback = performance.now() - readStart

    // Cleanup
    inputTexture.destroy()

    // Convert RGBA to RGB
    const resultRgb = rgbaToRgb(resultRgba, currentWidth, currentHeight)

    timing.total = performance.now() - totalStart

    return {
      pixels: resultRgb,
      width: currentWidth,
      height: currentHeight,
      timing,
    }
  }

  destroy(): void {
    this.device = null
    this._initialized = false
  }
}

// RGB <-> RGBA helpers
function rgbToRgba(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const pixelCount = width * height
  const rgba = new Uint8Array(pixelCount * 4)
  for (let i = 0; i < pixelCount; i++) {
    const rgbIdx = i * 3
    const rgbaIdx = i * 4
    rgba[rgbaIdx] = rgb[rgbIdx]!
    rgba[rgbaIdx + 1] = rgb[rgbIdx + 1]!
    rgba[rgbaIdx + 2] = rgb[rgbIdx + 2]!
    rgba[rgbaIdx + 3] = 255
  }
  return rgba
}

function rgbaToRgb(rgba: Uint8Array, width: number, height: number): Uint8Array {
  const pixelCount = width * height
  const rgb = new Uint8Array(pixelCount * 3)
  for (let i = 0; i < pixelCount; i++) {
    const rgbaIdx = i * 4
    const rgbIdx = i * 3
    rgb[rgbIdx] = rgba[rgbaIdx]!
    rgb[rgbIdx + 1] = rgba[rgbaIdx + 1]!
    rgb[rgbIdx + 2] = rgba[rgbaIdx + 2]!
  }
  return rgb
}

// Singleton
let _gpuEditPipeline: GPUEditPipeline | null = null

export function getGPUEditPipeline(): GPUEditPipeline {
  if (!_gpuEditPipeline) {
    _gpuEditPipeline = new GPUEditPipeline()
  }
  return _gpuEditPipeline
}

export function resetGPUEditPipeline(): void {
  if (_gpuEditPipeline) {
    _gpuEditPipeline.destroy()
    _gpuEditPipeline = null
  }
}
```

**Update**: `packages/core/src/gpu/pipelines/index.ts` - Export pipeline
**Update**: `packages/core/src/gpu/index.ts` - Export pipeline

**Acceptance Criteria**:
- [ ] Pipeline chains all operations
- [ ] Single upload/readback per render
- [ ] Timing breakdown available
- [ ] Works with any combination of operations

### Phase 7.4: Integrate GPUEditPipeline into useEditPreview

**Objective**: Replace individual GPU calls with unified pipeline

**Modify**: `apps/web/app/composables/useEditPreview.ts`

Add unified pipeline mode:
```typescript
import { getGPUEditPipeline, type EditPipelineParams } from '@literoom/core/gpu'

// In processPreview(), after loading source:
const gpuPipeline = getGPUEditPipeline()
await gpuPipeline.initialize()

if (gpuPipeline.isReady) {
  // Unified GPU path
  const params: EditPipelineParams = {
    rotation: Math.abs(totalRotation) > 0.001 ? totalRotation : undefined,
    adjustments: hasAdjustments ? adjustments : undefined,
    toneCurve: !isLinearCurve(adjustments.toneCurve.points)
      ? adjustments.toneCurve.points : undefined,
    masks: hasMasks ? convertMasksToGPUFormat(masks) : undefined,
  }

  try {
    const result = await gpuPipeline.process(
      { pixels: sourcePixels, width: sourceWidth, height: sourceHeight },
      params
    )
    console.log(`[useEditPreview] GPU pipeline: ${JSON.stringify(result.timing)}`)
    currentPixels = result.pixels
    currentWidth = result.width
    currentHeight = result.height
  } catch (error) {
    console.warn('[useEditPreview] GPU pipeline failed, falling back to sequential', error)
    // Fall through to existing sequential processing
  }
} else {
  // Existing sequential processing (WASM + individual GPU adaptive)
  // ... keep existing code as fallback
}
```

**Acceptance Criteria**:
- [ ] Unified pipeline used when GPU available
- [ ] Console shows timing breakdown
- [ ] Fallback to sequential on failure
- [ ] Visual output matches sequential path

### Phase 7.5: Add Texture Pooling (Optional Enhancement)

**Objective**: Reuse textures between renders to reduce allocation overhead

**Modify**: `packages/core/src/gpu/pipelines/edit-pipeline.ts`

Add texture pool integration:
```typescript
import { TexturePool } from '../texture-utils'

class GPUEditPipeline {
  private texturePool: TexturePool | null = null

  async initialize(): Promise<boolean> {
    // ... existing code ...
    if (this.device) {
      this.texturePool = new TexturePool(this.device, 4)
    }
    // ...
  }

  // In process(), use pool for texture allocation:
  // const texture = this.texturePool.acquire(width, height, usage)
  // ... use texture ...
  // this.texturePool.release(texture, width, height, usage)
}
```

**Acceptance Criteria**:
- [ ] Textures reused between renders
- [ ] Memory usage stable over time
- [ ] No performance regression

## Implementation Order

1. **Phase 7.1**: Enable GPU adjustments (1 task, quick win)
2. **Phase 7.2**: Enable GPU tone curve (1 task, quick win)
3. **Phase 7.3**: Create GPUEditPipeline (1 task, core work)
4. **Phase 7.4**: Integrate unified pipeline (1 task)
5. **Phase 7.5**: Add texture pooling (optional, 1 task)

## Files to Create

1. `packages/core/src/gpu/pipelines/edit-pipeline.ts`

## Files to Modify

1. `apps/web/app/composables/useEditPreview.ts` - Enable GPU ops, then unified pipeline
2. `packages/core/src/gpu/pipelines/index.ts` - Export new pipeline
3. `packages/core/src/gpu/index.ts` - Export new pipeline

## Testing Strategy

1. **Visual comparison**: Compare GPU output to WASM output pixel-by-pixel
2. **Performance benchmarking**: Measure total render time with various operation combinations
3. **Fallback testing**: Disable GPU and verify WASM fallback works
4. **Edge cases**: Test with rotation + masks, only adjustments, etc.

## Performance Expectations

| Phase | GPU Transfers | Expected Latency |
|-------|--------------|------------------|
| Current | 4 round-trips | ~500ms |
| After 7.1-7.2 | 4 round-trips | ~250ms (GPU ops faster) |
| After 7.3-7.4 | 1 round-trip | <50ms |
| After 7.5 | 1 round-trip | <20ms |

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Pipeline fails silently | Add detailed error logging |
| Visual differences | A/B comparison tests |
| Memory leaks | Use texture pooling, add cleanup |
| Dimension mismatch | Validate at each stage |

## Estimated Effort

- Phase 7.1: 1 task (30 min)
- Phase 7.2: 1 task (30 min)
- Phase 7.3: 2-3 tasks (2-3 hours)
- Phase 7.4: 1 task (1 hour)
- Phase 7.5: 1 task (1 hour)

Total: ~5-6 hours across 1-2 iterations
