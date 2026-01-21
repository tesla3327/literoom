# Research Synthesis: Filmstrip Navigation Stuck Loading State

**Date**: 2026-01-21
**Status**: Complete
**Issue Severity**: Critical

---

## Executive Summary

The filmstrip navigation bug causing "Loading..." stuck states stems from **multiple interconnected issues**:

1. **Race conditions** in async operations without proper cancellation
2. **Missing error handling** in async watchers
3. **ShallowRef reactivity limitations** causing missed updates
4. **HMR-related constant initialization** issues in histogram code

The primary fix requires adding **render generation counters** to prevent stale updates and **proper error handling** in all async watchers.

---

## Root Causes Identified

### 1. Async Race Conditions (CRITICAL)

**Problem**: When rapidly navigating between assets, multiple async operations run in parallel without proper cancellation. Responses can arrive out of order and update state for the wrong asset.

**Locations**:
- `useEditPreview.ts`: Preview rendering pipeline (lines 257-398)
- `useHistogramDisplay.ts`: Histogram computation (lines 383-420)

**Key Issues**:
- `debouncedRender.cancel()` only cancels the debounce timeout, NOT pending worker operations
- Staleness checks only compare assetId, not request IDs
- If user navigates A→B→A rapidly, stale responses for "A" can overwrite new responses

**Fix**: Add render generation counter to track and discard stale responses.

### 2. Missing Error Handling in Async Watchers (CRITICAL)

**Problem**: Async watchers make WASM calls that can fail, but no try/catch wraps these operations. When an error occurs, `isRendering` stays `true` and the UI is stuck.

**Locations with unhandled async**:
| File | Lines | Risk |
|------|-------|------|
| useEditPreview.ts | 443-470 | HIGH |
| useEditPreview.ts | 476-487 | HIGH |
| useHistogramDisplay.ts | 464-483 | HIGH |
| useHistogramDisplay.ts | 489-496 | HIGH |
| edit/[id].vue | 120-124 | MEDIUM |

**Fix**: Wrap all async watcher callbacks in try/catch and reset loading states on error.

### 3. ShallowRef Reactivity (MEDIUM)

**Problem**: The catalog store uses `shallowRef` for the assets Map. While updates to the Map trigger reactivity, computed properties that access individual asset properties (`thumbnailUrl`) may not reliably re-evaluate.

**Affected Computeds**:
- `useEditPreview.ts`: `sourceUrl` (lines 212-216)
- `useHistogramDisplay.ts`: `sourceUrl` (lines 456-459)
- `catalogUI.ts`: `filteredAssetIds` (lines 56-80)

**Fix**: Ensure computeds explicitly depend on trackable state changes.

### 4. HMR Module Initialization (LOW)

**Problem**: `SMOOTHING_KERNEL` constant is initialized at module level using a function call. During HMR, this can fail if `createGaussianKernel` isn't yet defined.

**Location**: `useHistogramDisplay.ts` line 114

**Fix**: Use lazy initialization pattern.

### 5. Template Mutation of Readonly Refs (LOW)

**Problem**: Direct template mutations like `showShadowClipping = !showShadowClipping` can fail during rapid updates when Vue treats the ref as readonly.

**Locations**:
- `EditHistogramDisplay.vue`: lines 106, 119
- `EditHistogramDisplaySVG.vue`: lines 161, 174

**Fix**: Use explicit toggle methods instead of direct template mutations.

---

## Recommended Fix Approach

### Priority 1: Render Generation Counter (Prevents Race Conditions)

Add a generation counter to `useEditPreview`:

```typescript
const renderGeneration = ref(0)

watch(assetId, () => {
  renderGeneration.value++  // Increment on asset change
  // ... rest of watcher
})

async function renderPreview(quality) {
  const gen = renderGeneration.value
  // ... rendering operations ...

  // Before updating state, verify generation matches
  if (gen !== renderGeneration.value) {
    return  // Stale render, discard
  }
  previewUrl.value = resultUrl
}
```

Same pattern for `useHistogramDisplay`.

### Priority 2: Error Handling in Async Watchers

Wrap all async watchers:

```typescript
watch(assetId, async (id) => {
  try {
    await loadSource(id)
    if (sourceCache.value && editStore.isDirty) {
      await renderPreview('full')
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load asset'
    isRendering.value = false  // Reset loading state
    console.error('[useEditPreview] Error:', err)
  }
}, { immediate: true })
```

### Priority 3: Lazy Kernel Initialization

Replace module-level constant with lazy initialization:

```typescript
let _smoothingKernel: number[] | null = null

function getSmoothingKernel(): number[] {
  if (!_smoothingKernel) {
    _smoothingKernel = createGaussianKernel(SMOOTHING_KERNEL_SIZE)
  }
  return _smoothingKernel
}
```

### Priority 4: Explicit Toggle Methods

Replace direct mutations with methods:

```typescript
// In composable:
function toggleShadowClipping(): void {
  showShadowClipping.value = !showShadowClipping.value
}

// In template:
@click="toggleShadowClipping"
```

---

## Files Requiring Changes

| File | Changes | Priority |
|------|---------|----------|
| `apps/web/app/composables/useEditPreview.ts` | Add generation counter, error handling | P1 |
| `apps/web/app/composables/useHistogramDisplay.ts` | Add generation counter, error handling, lazy kernel | P1 |
| `apps/web/app/composables/useHistogramDisplaySVG.ts` | Add error handling | P2 |
| `apps/web/app/pages/edit/[id].vue` | Add error handling in watcher | P2 |
| `apps/web/app/components/edit/EditHistogramDisplay.vue` | Use toggle methods | P3 |
| `apps/web/app/components/edit/EditHistogramDisplaySVG.vue` | Use toggle methods | P3 |

---

## Testing Strategy

1. **Manual Testing**:
   - Rapidly click through filmstrip thumbnails (10+ clicks in 2 seconds)
   - Verify preview never gets stuck in "Loading..."
   - Verify histogram updates correctly

2. **Unit Tests**:
   - Test generation counter prevents stale updates
   - Test error handling resets loading states

3. **E2E Tests**:
   - Filmstrip rapid navigation smoke test
   - Edit view error recovery test
