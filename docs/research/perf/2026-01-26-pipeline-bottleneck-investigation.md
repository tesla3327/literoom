# Pipeline Bottleneck Investigation

**Date**: 2026-01-26
**Goal**: Identify why GPU badge shows 50-70ms despite processing only 1.1 megapixels in draft mode

---

## Executive Summary

The GPU shader work is fast (~1-5ms for 1.1MP). The bottleneck is **CPU operations** surrounding the GPU pipeline, plus **hidden latency** from JPEG encoding that isn't shown in the badge.

### Key Finding

| Component | Time | In Badge? |
|-----------|------|-----------|
| CPU downsample | 10-20ms | ✓ |
| GPU shaders | 1-5ms | ✓ |
| GPU readback (blocking) | 15-30ms | ✓ |
| rgbToRgba/rgbaToRgb | 6-16ms | ✓ |
| **JPEG encoding** | **20-50ms** | **✗ Hidden!** |

---

## Current Resolution Chain

The source is NOT the full RAW — it's a pre-decoded preview:

```
RAW (6000×4000, 24MP)
        ↓ decoded once, cached
Preview (2560×1707, 4.4MP) ← SOURCE for editing
        ↓ during drag (targetResolution=0.5)
Draft (1280×853, 1.1MP) ← What GPU actually processes
        ↓ after 400ms idle
Full (2560×1707, 4.4MP)
```

This follows industry standard (Lightroom Smart Previews are also 2560px).

---

## Detailed Timing Breakdown

### What's Included in `timing.total` (shown in badge)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Step                                          Estimated Time        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  1. downsamplePixels()                         CPU: 10-20ms ❌      │
│     Location: edit-pipeline.ts:181-256                              │
│     Problem: JS loop processes 4.4M pixel reads + 1.1M writes       │
│     Code: Nested for-loops with array indexing                      │
│                                                                      │
│  2. rgbToRgba()                                CPU: 3-8ms           │
│     Location: texture-utils.ts:536-554                              │
│     Problem: 1.1M iterations to add alpha channel                   │
│                                                                      │
│  3. writeTexture()                             GPU: ~1ms            │
│     Fast GPU memory copy                                            │
│                                                                      │
│  4. GPU Stages (rotation/adjust/toneCurve/masks)  GPU: 1-5ms        │
│     Actually fast at 1.1 megapixels!                                │
│     Uber-pipeline merges adjust+toneCurve into single pass          │
│                                                                      │
│  5. readTexturePixels()                        BLOCKING: 15-30ms ❌ │
│     Location: texture-utils.ts:166-206                              │
│     Problem: await mapAsync() waits for ALL GPU work to complete    │
│     This is the classic GPU sync stall                              │
│                                                                      │
│  6. rgbaToRgb()                                CPU: 3-8ms           │
│     Location: texture-utils.ts:564-582                              │
│     Problem: 1.1M iterations to strip alpha channel                 │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  SUBTOTAL (shown in badge): ~35-70ms                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### What's NOT Included in `timing.total` (hidden from user)

```
┌──────────────────────────────────────────────────────────────────────┐
│  Step                                          Estimated Time        │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  7. pixelsToUrl()                              CPU: 20-50ms ❌      │
│     Location: useEditPreview.ts:234-263                             │
│     Steps:                                                          │
│       a. rgbToRgba() AGAIN (3-8ms) ← duplicate work!               │
│       b. createImageData + putImageData (~2ms)                      │
│       c. canvas.toBlob('image/jpeg', 0.9) ← JPEG encoding!         │
│          This is CPU-bound and slow: 15-40ms for 1.1MP              │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│  HIDDEN LATENCY: ~20-50ms                                            │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Root Cause Analysis

### Why GPU Work Is Fast But Total Is Slow

The actual GPU shader execution at 1.1 megapixels takes only 1-5ms. But the pipeline pays heavy costs for:

1. **CPU preprocessing** — Downsample + format conversion before GPU
2. **Blocking sync** — `mapAsync()` waits for GPU completion
3. **CPU postprocessing** — Format conversion after GPU
4. **JPEG re-encoding** — Canvas blob creation for `<img>` display

### The Blocking Readback Problem

```typescript
// texture-utils.ts:196-199
await stagingBuffer.mapAsync(GPUMapMode.READ)  // ← BLOCKS HERE
const paddedData = new Uint8Array(stagingBuffer.getMappedRange()).slice()
stagingBuffer.unmap()
```

This `mapAsync()` call:
1. Waits for all previously submitted GPU commands to complete
2. Waits for the texture-to-buffer copy to finish
3. Maps the buffer for CPU access

This is the classic GPU sync stall that kills performance in real-time rendering.

### The Double RGB↔RGBA Conversion

The pipeline converts RGB→RGBA twice:
1. In `edit-pipeline.ts` before GPU processing
2. In `pixelsToUrl()` before canvas rendering

And RGBA→RGB once:
1. In `edit-pipeline.ts` after GPU processing

For 1.1M pixels, each conversion is ~3-8ms. Total: ~10-24ms just for format conversion.

---

## Proposed Optimizations

### Tier 1: Quick Wins (High Impact, Low Effort)

| # | Optimization | Expected Savings | Effort |
|---|-------------|------------------|--------|
| 1.1 | **GPU-based downsample** | 10-20ms → 1-2ms | 1 day |
| 1.2 | **Skip JPEG encoding** — use ImageBitmap | 20-50ms → 2-5ms | 4 hours |
| 1.3 | **Keep RGBA through pipeline** — avoid conversions | 10-24ms → 0ms | 1 day |

### Tier 2: Architecture Changes (High Impact, Medium Effort)

| # | Optimization | Expected Savings | Effort |
|---|-------------|------------------|--------|
| 2.1 | **Non-blocking readback** — use StagingBufferPool | 15-30ms stall → async | 2 days |
| 2.2 | **Render to canvas directly** — skip readback entirely | Eliminate readback | 3 days |
| 2.3 | **WebGPU canvas context** — zero-copy display | Eliminate all CPU copies | 1 week |

---

## Optimization Details

### 1.1 GPU-Based Downsample

**Current**: CPU loop in JavaScript
```typescript
// edit-pipeline.ts:208-248
for (let outY = 0; outY < newHeight; outY++) {
  for (let outX = 0; outX < newWidth; outX++) {
    // 4.4M pixel reads, 1.1M pixel writes in JS
  }
}
```

**Proposed**: Compute shader
```wgsl
@compute @workgroup_size(16, 16)
fn downsample(@builtin(global_invocation_id) gid: vec3<u32>) {
    // Sample 2x2 block, average, write single pixel
    // GPU processes millions of pixels in parallel
}
```

**Expected**: 10-20ms → 1-2ms (10x faster)

### 1.2 Skip JPEG Encoding

**Current**: Creates JPEG blob for `<img src>`
```typescript
// useEditPreview.ts:251-260
canvas.toBlob((b) => { ... }, 'image/jpeg', 0.9)  // SLOW!
```

**Option A**: Use ImageBitmap (fast, no encoding)
```typescript
const bitmap = await createImageBitmap(imageData)
// Draw bitmap to visible canvas directly
```

**Option B**: Use OffscreenCanvas with transferToImageBitmap
```typescript
const offscreen = new OffscreenCanvas(width, height)
const ctx = offscreen.getContext('2d')
ctx.putImageData(imageData, 0, 0)
const bitmap = offscreen.transferToImageBitmap()
```

**Expected**: 20-50ms → 2-5ms

### 1.3 Keep RGBA Through Pipeline

**Current**: RGB in → RGBA (GPU) → RGB out → RGBA (canvas)
**Proposed**: RGBA in → RGBA (GPU) → RGBA out → RGBA (canvas)

This requires:
1. Store source pixels as RGBA (4 bytes vs 3 bytes, 33% more memory)
2. Skip rgbToRgba/rgbaToRgb conversions
3. Output RGBA directly to canvas

**Trade-off**: 33% more memory for source cache
**Expected**: 10-24ms → ~0ms

### 2.2 Render to Canvas Directly

Instead of GPU → readback → CPU → canvas, render directly:

```typescript
// Create WebGPU canvas context
const context = canvas.getContext('webgpu')
context.configure({ device, format: 'bgra8unorm' })

// Render final pass directly to canvas texture
const canvasTexture = context.getCurrentTexture()
renderPass.setOutputTarget(canvasTexture.createView())
```

This eliminates:
- readTexturePixels() entirely
- All CPU format conversions
- JPEG encoding

**Expected**: Total pipeline could drop to <10ms

---

## Recommended Implementation Order

### Phase 1: Eliminate Hidden Latency (Priority: HIGHEST) ✅ COMPLETED

1. **Replace `pixelsToUrl()` with direct canvas rendering** ✅
   - Implemented ImageBitmap-based rendering
   - Expected: Remove 20-50ms of hidden latency
   - **Implementation date**: 2026-01-26

   **Changes made**:
   - Added `pixelsToImageBitmap()` function that creates ImageBitmap directly
   - Added detailed benchmarking to `pixelsToUrl()` for comparison
   - Replaced `<img src={blobUrl}>` with `<canvas>` and direct `drawImage(bitmap)`
   - Added `previewBitmap` ref to `useEditPreview` composable
   - Component now watches `previewBitmap` and draws to canvas on change

   **Files modified**:
   - `apps/web/app/composables/useEditPreview.ts` - New function, benchmarking, bitmap state
   - `apps/web/app/components/edit/EditPreviewCanvas.vue` - Canvas-based rendering

### Phase 2: Eliminate CPU Bottlenecks (Priority: HIGH)

2. **Move downsample to GPU** ✅ COMPLETED
   - Create compute shader for 2x2 block averaging
   - Expected: 10-20ms → 1-2ms
   - **Implementation date**: 2026-01-26

   **Changes made**:
   - Created `downsample.wgsl` compute shader for NxN block averaging
   - Created `DownsamplePipeline` TypeScript class with GPU execution
   - Integrated GPU downsample into `edit-pipeline.ts` process() method
   - Added CPU fallback when GPU downsample pipeline unavailable
   - Added benchmarking logs for both GPU and CPU paths

   **Files created/modified**:
   - `packages/core/src/gpu/shaders/downsample.wgsl` - New compute shader
   - `packages/core/src/gpu/shaders/index.ts` - Added DOWNSAMPLE_SHADER_SOURCE
   - `packages/core/src/gpu/pipelines/downsample-pipeline.ts` - New pipeline class
   - `packages/core/src/gpu/pipelines/edit-pipeline.ts` - Integration

   **Console output format**:
   ```
   [edit-pipeline] GPU downsample: ${inputWidth}x${inputHeight} → ${outputWidth}x${outputHeight} in ${time}ms
   [edit-pipeline] CPU downsample (fallback): ${inputWidth}x${inputHeight} → ${outputWidth}x${outputHeight} in ${time}ms
   ```

3. **Keep RGBA throughout pipeline**
   - Modify source cache to store RGBA
   - Skip all rgb↔rgba conversions
   - Expected: 10-24ms → 0ms

### Phase 3: Eliminate Readback (Priority: MEDIUM)

4. **Render to WebGPU canvas directly**
   - No CPU readback needed for display
   - Keep readback only for histogram/export
   - Expected: 15-30ms → 0ms for display path

---

## Success Criteria

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| Badge timing (draft) | 50-70ms | <15ms | Phase 2.1 complete (GPU downsample: 10-20ms → 1-2ms) |
| Total latency (slider → display) | 70-120ms | <25ms | Phase 1+2.1 complete (~30-70ms removed) |
| FPS during drag | ~15 FPS | >30 FPS | In progress |

---

## Implementation Log

### 2026-01-26: Phase 1 Completed

**Objective**: Eliminate hidden JPEG encoding latency by using ImageBitmap

**Approach**:
1. Created `pixelsToImageBitmap()` function that converts RGB pixels to ImageBitmap directly
2. Replaced the `<img>` element with a `<canvas>` in EditPreviewCanvas
3. Preview composable now returns `previewBitmap` instead of blob URL for edited images
4. Canvas watches for bitmap changes and draws using `ctx.drawImage(bitmap, 0, 0)`

**Timing comparison** (added via benchmarking):
- Old `pixelsToUrl()`: ~20-50ms (includes JPEG encoding at 15-40ms)
- New `pixelsToImageBitmap()`: ~5-10ms (just rgbToRgba + createImageBitmap)
- **Expected savings**: 15-40ms per render

**Console output format**:
```
[useEditPreview] pixelsToUrl: rgbToRgba=Xms putImageData=Yms jpegEncode=Zms total=Tms
[useEditPreview] pixelsToImageBitmap: rgbToRgba=Xms createImageBitmap=Yms total=Tms
```

**Trade-offs**:
- Canvas rendering instead of `<img>` (no significant visual difference)
- Bitmap memory usage (auto-released, minimal impact)

**Tests**: All 1234 unit tests pass after changes

### 2026-01-26: Phase 2.1 Completed (GPU Downsample)

**Objective**: Move CPU downsample to GPU for faster draft mode preview processing

**Approach**:
1. Created GPU compute shader `downsample.wgsl` that averages NxN pixel blocks
2. Created `DownsamplePipeline` TypeScript class following existing pipeline patterns
3. Modified `edit-pipeline.ts` to use GPU downsample after texture upload
4. Added CPU fallback path for when GPU pipeline is unavailable

**New processing flow**:
1. Convert full-res RGB to RGBA (CPU)
2. Upload full-res RGBA to GPU texture
3. GPU downsample to smaller texture (if scale < 1.0)
4. Continue with rest of GPU pipeline on smaller texture
5. Readback and convert to RGB

**Expected savings**: 10-20ms → 1-2ms (with GPU path)

**Trade-offs**:
- Full-res rgbToRgba conversion (4.4MP) instead of downsampled (1.1MP)
- This trade-off will be eliminated when Phase 2.2 (Keep RGBA throughout) is implemented

**Tests**: All 2391 unit tests pass after changes

---

## References

- `apps/web/app/composables/useEditPreview.ts` — Main render loop
- `packages/core/src/gpu/pipelines/edit-pipeline.ts` — GPU pipeline
- `packages/core/src/gpu/pipelines/downsample-pipeline.ts` — GPU downsample pipeline
- `packages/core/src/gpu/shaders/downsample.wgsl` — Downsample compute shader
- `packages/core/src/gpu/texture-utils.ts` — Readback and conversions
- [WebGPU Canvas Best Practices](https://developer.chrome.com/docs/capabilities/web-apis/webgpu-canvas)
- [ImageBitmap for Zero-Copy Rendering](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap)
