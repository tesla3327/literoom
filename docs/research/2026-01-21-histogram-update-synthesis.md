# Histogram Not Updating When Edits Are Made - Research Synthesis

## Overview

This document synthesizes research findings on the issue where the histogram does not update when adjustments are made to the image.

## Problem Statement

**Severity**: High | **Status**: Open | **Discovered**: 2026-01-21

The histogram does not update when adjustments (exposure, contrast, etc.) are made. The histogram should reflect the current state of the edited image in real-time.

## Root Cause

The histogram is computed from **source (thumbnail) pixels**, not from **adjusted pixels**. This is an intentional MVP design decision, documented in the code:

```typescript
// useHistogramDisplay.ts, lines 545-548
/**
 * Note: For a more accurate histogram, we should compute from adjusted pixels,
 * but for now we compute from source pixels (faster, good enough for MVP).
 */
```

## Current Data Flow

### Preview Update (WORKS):
```
Slider changed
  ↓
editStore.setAdjustment()
  ↓
adjustments.value updated
  ↓
useEditPreview watcher triggers
  ↓
renderPreview() called
  ↓
$decodeService.applyAdjustments(sourcePixels, adjustments) → ADJUSTED pixels
  ↓
detectClippedPixels(adjustedPixels)
  ↓
pixelsToUrl(adjustedPixels)
  ↓
previewUrl.value = newBlobUrl
  ↓
Preview image visually updates ✓
```

### Histogram Update (BROKEN):
```
Slider changed
  ↓
editStore.setAdjustment()
  ↓
adjustments.value updated
  ↓
useHistogramDisplay watcher triggers
  ↓
debouncedCompute() called (500ms delay)
  ↓
$decodeService.computeHistogram(SOURCE pixels) ← NO ADJUSTMENTS APPLIED
  ↓
histogram.value = result (same as before)
  ↓
renderHistogram() called
  ↓
Canvas re-renders, but histogram data is IDENTICAL ✗
```

## Key Findings

### 1. Watchers Are Working Correctly

Both `useHistogramDisplay.ts` and `useEditPreview.ts` have deep watchers on `editStore.adjustments`:

**useEditPreview.ts (lines 543-551):**
```typescript
watch(
  () => editStore.adjustments,
  () => {
    debouncedRender()  // 300ms debounce
  },
  { deep: true },
)
```

**useHistogramDisplay.ts (lines 549-557):**
```typescript
watch(
  () => editStore.adjustments,
  () => {
    if (sourceCache.value) {
      debouncedCompute()  // 500ms debounce
    }
  },
  { deep: true },
)
```

### 2. The Difference: Adjustment Application

- **Preview pipeline** calls `$decodeService.applyAdjustments()` to transform pixels BEFORE display
- **Histogram pipeline** skips adjustment application and computes from original source pixels

### 3. useEditPreview Has What We Need

The `useEditPreview` composable already:
- Computes adjusted pixels
- Detects clipping from adjusted pixels
- Has a `clippingMap` that correctly reflects adjusted state

## Solution Options

### Option A: Share Adjusted Pixels from Preview (Recommended)

**Approach:** Have histogram use the adjusted pixels that preview already computes.

**Pros:**
- No duplicate adjustment computation
- Preview and histogram always in sync
- Minimal code changes

**Cons:**
- Coupling between preview and histogram pipelines
- Histogram depends on preview being rendered first

**Implementation:**
1. Export `adjustedPixels` from `useEditPreview`
2. Have `useHistogramDisplay` watch `adjustedPixels` instead of computing independently
3. When `adjustedPixels` changes, compute histogram from them

### Option B: Independent Adjustment Pipeline in Histogram

**Approach:** Apply adjustments in the histogram pipeline before computing.

**Pros:**
- Independent pipelines
- Could work even if preview isn't rendered

**Cons:**
- Duplicate computation (adjustments applied twice)
- More complex code
- Higher CPU usage

**Implementation:**
1. Add adjustment application to `useHistogramDisplay.computeHistogram()`
2. Call `$decodeService.applyAdjustments()` before `$decodeService.computeHistogram()`

### Option C: Compute Histogram from Preview Canvas (Hybrid)

**Approach:** Extract pixels from the rendered preview canvas and compute histogram from those.

**Pros:**
- Uses exactly what user sees
- No separate adjustment computation

**Cons:**
- Depends on preview canvas being rendered
- May have quality/resolution differences
- More complex extraction logic

## Recommended Solution: Option A

Share the adjusted pixels from `useEditPreview` to `useHistogramDisplay`.

**Rationale:**
1. Preview already does all the work (rotation, crop, adjustments, tone curve)
2. No duplicate computation
3. Histogram will always match what user sees
4. Minimal code changes needed

**Implementation Plan:**

### Phase 1: Export Adjusted Pixels from useEditPreview

Add to `useEditPreview.ts` return values:
- `adjustedPixels: Ref<Uint8Array | null>`
- `adjustedDimensions: Ref<{ width: number; height: number } | null>`

Store the final adjusted pixels before converting to blob URL.

### Phase 2: Update useHistogramDisplay

1. Accept optional `adjustedPixels` parameter or get from useEditPreview
2. Watch `adjustedPixels` instead of / in addition to source pixels
3. When `adjustedPixels` changes, compute histogram from them
4. Keep source-based computation as fallback for initial load

### Phase 3: Update Components

1. In `pages/edit/[id].vue`, connect preview and histogram pipelines
2. Pass adjusted pixels from preview to histogram (or have histogram access preview composable)

## Performance Considerations

- **Debouncing:** Keep 500ms debounce for histogram (preview uses 300ms)
- **Thumbnail Resolution:** Histogram from thumbnail-sized pixels is already fast
- **Memory:** Adjusted pixels already exist in preview pipeline, no extra allocation

## Files to Modify

1. `apps/web/app/composables/useEditPreview.ts` - Export adjusted pixels
2. `apps/web/app/composables/useHistogramDisplay.ts` - Use adjusted pixels
3. `apps/web/app/composables/useHistogramDisplaySVG.ts` - Same changes
4. `apps/web/app/pages/edit/[id].vue` - Wire up the connection (if needed)

## Success Criteria

1. Histogram updates when adjustments change
2. Histogram reflects the actual tonal distribution of the edited image
3. Clipping indicators in histogram match clipping overlay on preview
4. Performance remains acceptable (no jank during slider drag)
5. Both canvas and SVG histogram implementations work correctly

## Alternative: Minimal Fix

If a faster fix is needed, we could simply remove the comment and acknowledge the MVP behavior:

```typescript
// This watcher triggers recomputation but uses source pixels (not adjusted)
// See docs/issues.md for planned enhancement to use adjusted pixels
```

This documents the intentional behavior without fixing it, buying time for a proper solution.
