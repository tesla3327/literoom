# Draft Mode Implementation Research

**Date**: 2026-01-25
**Research Area**: Research Area 1 from Implementation Plan
**Goal**: Answer all questions and define implementation approach for draft mode

---

## Executive Summary

Draft mode is the highest-impact, lowest-effort optimization identified. This research provides complete implementation details based on codebase analysis and industry best practices.

### Key Findings

| Question | Answer |
|----------|--------|
| Where to trigger draft mode? | `useEditPreview.ts` line 975-977 (throttledRender already sets 'draft') |
| Optimal downsampling factor? | **1/2 resolution** (industry standard, 75% performance gain) |
| Progressive refinement timing? | **300-500ms debounce** after interaction ends |
| GPU vs WASM draft mode? | Both - GPU pipeline gets resolution reduction, WASM gets skip flags |

---

## 1. Current Render Flow Analysis

### Entry Point: useEditPreview.ts

**File**: `/apps/web/app/composables/useEditPreview.ts`

**Current Throttle Implementation** (lines 115-160):
- Custom throttle with leading + trailing edge execution
- **150ms delay** currently configured
- First call executes immediately (responsive feedback)
- Last call guaranteed to execute (captures final value)

**Quality Parameter Status** (lines 477-478, 590-611):
```typescript
const renderQuality = ref<'draft' | 'full'>('full')
```

**Current Reality**: The `renderQuality` is **UI-only** - it shows a "Draft" indicator but doesn't affect actual rendering. This is the key gap to fill.

### Data Flow

```
Slider Input → editStore.setAdjustment() → Deep Watcher → throttledRender()
                                                              ↓
                                                    renderPreview('draft')
                                                              ↓
                                                    GPUEditPipeline.process()
```

---

## 2. Operations That Can Be Skipped in Draft Mode

### High-Impact Skips

| Operation | Current Cost | Skip Savings | Implementation |
|-----------|--------------|--------------|----------------|
| Histogram computation | 5-50ms | 100% in draft | `enabledOperations.histogram: false` |
| Clipping detection | 2-5ms readback stall | 100% in draft | `enabledOperations.clipping: false` |
| Resolution (full → 1/2) | Baseline | 75% pixels processed | Downsample before GPU pipeline |

### Medium-Impact Optimizations

| Operation | Optimization | Savings |
|-----------|--------------|---------|
| Tone curve LUT | Use 64-entry LUT vs 256 | ~10% shader time |
| Bilinear interpolation | Use nearest-neighbor for rotation | ~15% rotation time |
| Mask feathering | Reduce smootherstep precision | ~5% mask time |

### What Must Stay Enabled

- **Basic adjustments** (exposure, contrast, etc.) - Core feedback loop
- **Tone curve application** - Visual accuracy required
- **Mask overlay** - User needs to see mask placement
- **Rotation** - Crop/rotate is interactive

---

## 3. Optimal Debounce/Throttle Timing

### Research-Backed Recommendations

**Slider Interaction (Throttle)**:
- **Optimal**: 16-33ms (60-30fps)
- **Current**: 150ms (too slow for responsive feel)
- **Recommendation**: Reduce to **33ms** for draft renders

**Full-Quality Render (Debounce)**:
- **Optimal**: 300-500ms after interaction stops
- **Current**: None (full quality attempted immediately after throttle)
- **Recommendation**: Add **400ms debounce** for full-quality render

**Touch vs Mouse**:
- Touch requires <25ms latency (more sensitive)
- Mouse tolerates up to 60ms
- Use 16ms throttle for touch, 33ms for mouse

### Proposed Timing Architecture

```
User drags slider
    ↓
[Every 33ms] → renderPreview('draft', { resolution: 0.5, skipHistogram: true })
    ↓
User releases slider
    ↓
[After 400ms idle] → renderPreview('full', { resolution: 1.0, skipHistogram: false })
    ↓
Full quality displayed + histogram updated
```

---

## 4. Progressive Refinement State Machine

### States

```typescript
type RenderState =
  | 'idle'           // No render pending
  | 'interacting'    // User actively dragging
  | 'refining'       // Post-interaction refinement
  | 'complete'       // Full quality rendered
```

### Transitions

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  idle ──[user input]──► interacting                     │
│    ▲                         │                          │
│    │                         │[33ms throttle]           │
│    │                         ▼                          │
│    │                    draft render                    │
│    │                         │                          │
│    │                         │[no input for 400ms]      │
│    │                         ▼                          │
│    │                    refining                        │
│    │                         │                          │
│    │                         │[full render complete]    │
│    │                         ▼                          │
│    └────────────────── complete                         │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Implementation

```typescript
interface DraftModeOptions {
  resolution: 0.25 | 0.5 | 1.0
  skipHistogram: boolean
  skipClipping: boolean
  useNearestNeighbor: boolean
}

const DRAFT_OPTIONS: DraftModeOptions = {
  resolution: 0.5,
  skipHistogram: true,
  skipClipping: true,
  useNearestNeighbor: false  // Keep bilinear for quality
}

const FULL_OPTIONS: DraftModeOptions = {
  resolution: 1.0,
  skipHistogram: false,
  skipClipping: false,
  useNearestNeighbor: false
}
```

---

## 5. GPU Pipeline Integration

### Current Pipeline Structure

**File**: `/packages/core/src/gpu/pipelines/edit-pipeline.ts`

```
process(input, params)
    ↓
Upload pixels → inputTexture
    ↓
[If rotation] → Rotation pass → outputTexture
    ↓
[If adjustments] → Adjustments pass → outputTexture
    ↓
[If tone curve] → Tone curve pass → outputTexture
    ↓
[If masks] → Mask pass → outputTexture
    ↓
Readback → output pixels
```

### Draft Mode Changes Needed

1. **Add resolution parameter to process()**
```typescript
interface ProcessParams {
  // ... existing params
  quality?: 'draft' | 'full'
  targetResolution?: number  // 0.5 for draft
}
```

2. **Downsample input before processing**
```typescript
if (params.targetResolution && params.targetResolution < 1.0) {
  const scale = params.targetResolution
  const scaledWidth = Math.round(input.width * scale)
  const scaledHeight = Math.round(input.height * scale)
  input = downsample(input, scaledWidth, scaledHeight)
}
```

3. **Use TexturePool for efficiency**
```typescript
// Instead of creating new textures:
const inputTexture = this.texturePool.acquire(
  scaledWidth, scaledHeight, TextureUsage.PINGPONG
)

// After render:
this.texturePool.release(inputTexture, scaledWidth, scaledHeight, TextureUsage.PINGPONG)
```

---

## 6. WASM Fallback Integration

### AdaptiveProcessor Configuration

**File**: `/packages/core/src/gpu/adaptive-processor.ts`

The `enabledOperations` config already supports disabling operations:

```typescript
enabledOperations: {
  adjustments: true,
  toneCurve: true,
  linearMask: true,
  radialMask: true,
  histogram: true,     // ← Set to false in draft mode
  resize: true,
  rotation: true,
  clipping: true,      // ← Set to false in draft mode
}
```

### Draft Mode Configuration

```typescript
const draftConfig = {
  enabledOperations: {
    ...defaultConfig.enabledOperations,
    histogram: false,
    clipping: false,
  }
}

const fullConfig = {
  enabledOperations: {
    ...defaultConfig.enabledOperations,
    histogram: true,
    clipping: true,
  }
}
```

---

## 7. Expected Performance Gains

### Current Timing (Full Quality Every Render)

| Operation | Time |
|-----------|------|
| Upload | 1-2ms |
| Rotation | 5-15ms |
| Adjustments | 10-30ms |
| Tone Curve | 5-10ms |
| Masks | 10-30ms |
| Histogram | 5-50ms |
| Clipping | 2-5ms |
| Readback | 2-5ms |
| **Total** | **40-147ms** |

### Draft Mode Timing (1/2 Resolution + Skips)

| Operation | Time | Savings |
|-----------|------|---------|
| Upload (1/4 pixels) | 0.25-0.5ms | 75% |
| Rotation (1/4 pixels) | 1.25-3.75ms | 75% |
| Adjustments (1/4 pixels) | 2.5-7.5ms | 75% |
| Tone Curve (1/4 pixels) | 1.25-2.5ms | 75% |
| Masks (1/4 pixels) | 2.5-7.5ms | 75% |
| Histogram | SKIPPED | 100% |
| Clipping | SKIPPED | 100% |
| Readback (1/4 pixels) | 0.5-1.25ms | 75% |
| **Total** | **8-23ms** | **~85%** |

### Target Achieved

- **Draft render**: 8-23ms → **~43-60 FPS possible**
- **Full render**: 40-147ms (unchanged, triggered after 400ms idle)

---

## 8. Implementation Plan

### Phase 1: Core Draft Mode (Priority: HIGH)

1. **Modify `useEditPreview.ts`**:
   - Add `draftModeOptions` ref
   - Reduce throttle from 150ms to 33ms
   - Add 400ms debounce for full quality render
   - Pass resolution option to GPU pipeline

2. **Modify `edit-pipeline.ts`**:
   - Add `quality` parameter to `process()`
   - Implement input downsampling
   - Integrate TexturePool

3. **Modify `useHistogramDisplaySVG.ts`**:
   - Skip histogram computation during draft mode
   - Show cached/stale histogram with "updating" indicator

### Phase 2: Progressive Refinement (Priority: MEDIUM)

1. Add `requestIdleCallback` for refinement passes
2. Implement smooth transition from draft to full quality
3. Add quality level indicator in UI

### Phase 3: Advanced Optimizations (Priority: LOW)

1. Mipmap-based rendering for zoom interactions
2. Touch-optimized timing (16ms vs 33ms)
3. Device-specific quality profiles

---

## 9. Success Criteria

| Metric | Current | Target | Validation |
|--------|---------|--------|------------|
| Draft render time | ~65-165ms | <25ms | GPU timestamp queries |
| Slider responsiveness | 150ms | <50ms | User perception testing |
| Full render time | ~65-165ms | <100ms | Unchanged, but deferred |
| Memory usage | Per-frame alloc | Pooled | Memory profiling |
| FPS during drag | ~6-15 | ~30-60 | Chrome DevTools |

---

## 10. Code Locations Summary

| File | Lines | Changes Needed |
|------|-------|----------------|
| `apps/web/app/composables/useEditPreview.ts` | 975-977, 115-160 | Add draft options, reduce throttle |
| `packages/core/src/gpu/pipelines/edit-pipeline.ts` | 152-327 | Add quality param, downsampling |
| `packages/core/src/gpu/texture-utils.ts` | 214-308 | Integrate TexturePool |
| `packages/core/src/gpu/adaptive-processor.ts` | 46 | Draft mode config |
| `apps/web/app/composables/useHistogramDisplaySVG.ts` | 39 | Skip during draft |

---

## References

- [CSS-Tricks: Debouncing and Throttling](https://css-tricks.com/debouncing-throttling-explained-examples/)
- [Fast GPU Friendly Antialiasing Downsampling Filter](https://bartwronski.com/2022/03/07/fast-gpu-friendly-antialiasing-downsampling-filter/)
- [requestIdleCallback Best Practices](https://developer.chrome.com/blog/using-requestidlecallback)
- [User Perception of Touch Screen Latency](https://www.researchgate.net/publication/221100500_User_Perception_of_Touch_Screen_Latency)
- [How Much Faster is Fast Enough?](https://www.tactuallabs.com/papers/howMuchFasterIsFastEnoughCHI15.pdf)
