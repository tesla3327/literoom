# Research: debouncedFullRender.cancel is not a function Bug

**Date**: 2026-01-31
**Status**: Bug may no longer exist - requires verification

## Bug Description

From `docs/issues.md`:
- Console error: `debouncedFullRender.cancel is not a function`
- Occurs during slider adjustments in edit view
- Reported 37+ times during a single adjustment session
- Found: 2026-01-26

## Research Findings

### 1. Debounce Implementation Analysis

The `debouncedFullRender` function is created in `apps/web/app/composables/useEditPreview.ts` (lines 1376-1386) using a custom `debounce()` utility function.

**Custom Debounce Function (lines 205-232):**
```typescript
function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
): T & { cancel: () => void } {
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Parameters<T>) => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      timeoutId = null
      fn(...args)
    }, delay)
  }

  debounced.cancel = () => {
    if (timeoutId !== null) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
  }

  return debounced as T & { cancel: () => void }
}
```

The implementation correctly:
1. Creates a wrapper function with proper closure
2. Adds a `.cancel()` method to the wrapper
3. Returns the wrapper with correct typing

### 2. Where .cancel() is Called

`.cancel()` is only called in **2 places**:

1. **Asset ID watcher (line 1478):**
   ```typescript
   watch(
     assetId,
     async (id) => {
       throttledRender.cancel()
       debouncedFullRender.cancel()
       // ...
     }
   )
   ```
   - Only runs when navigating between photos
   - Should NOT run 37+ times during slider adjustments

2. **Component unmount (line 1736):**
   ```typescript
   onUnmounted(() => {
     throttledRender.cancel()
     debouncedFullRender.cancel()
     // ...
   })
   ```
   - Only runs once when component unmounts
   - Should NOT run 37+ times during slider adjustments

### 3. Code Changes Since Bug Report

Since the bug was reported (2026-01-26), these changes were made to `useEditPreview.ts`:
- `ae183c4` - Replace JPEG encoding with ImageBitmap for preview display
- `7238454` - Keep RGBA throughout pipeline to eliminate conversion overhead
- `fde6f1b` - Implement Phase 3 WebGPU direct canvas rendering
- `d139b53` - Test Section 19.3 Safari browser compatibility

The debounce/throttle implementations have remained unchanged - they were correctly implemented from the start.

### 4. Test Coverage

The progressive-refinement tests (`apps/web/test/progressive-refinement.test.ts`) include tests for the debounce function and its cancel behavior. **All 48 tests pass.**

### 5. Inconsistencies in Bug Report

The bug report states:
- Error occurs "during slider adjustments"
- Error appears "37+ times"
- Impact: "Does not crash the application, adjustments and preview updates still work"

However:
- `.cancel()` is not called during slider adjustments
- `.cancel()` would only be called when asset changes (navigation)
- There's no mechanism for it to be called 37 times unless:
  1. The composable is being recreated repeatedly (unlikely)
  2. Hot module replacement is triggering recreations (development only)
  3. The error report may be inaccurate

## Possible Explanations

### Hypothesis 1: Bug was Fixed During Performance Refactoring
The performance optimizations (ImageBitmap, WebGPU rendering) may have inadvertently fixed timing issues that could have caused the error.

### Hypothesis 2: Hot Module Replacement Artifact
The error may have occurred only during development with HMR active, causing component recreation.

### Hypothesis 3: Documentation Error
The error message may have been incorrectly recorded. The similar bug `previewUrl.value.startsWith is not a function` is documented, and there may have been confusion.

## Recommendations

1. **Manual Verification Required**: Test the current codebase manually to verify if the error still occurs
2. **If Bug Exists**: Add try-catch guards around `.cancel()` calls:
   ```typescript
   if (typeof debouncedFullRender?.cancel === 'function') {
     debouncedFullRender.cancel()
   }
   ```
3. **If Bug Doesn't Exist**: Mark the issue as "Cannot Reproduce" or "Possibly Fixed"

## Files Analyzed

- `apps/web/app/composables/useEditPreview.ts` - Main file containing debouncedFullRender
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - Component using useEditPreview
- `apps/web/test/progressive-refinement.test.ts` - Tests for debounce behavior
- `apps/web/app/composables/useHistogramDisplay.ts` - Similar debounce patterns
- `apps/web/app/composables/useHistogramDisplaySVG.ts` - Similar throttle patterns

## Conclusion

The code implementation appears correct. The bug either:
1. Was fixed during recent refactoring
2. Was a development-only issue (HMR-related)
3. Was documented incorrectly

**Recommended Action**: Attempt manual reproduction, then either fix if confirmed or close as "Cannot Reproduce".
