# previewUrl.value.startsWith Bug - Research Synthesis

**Date**: 2026-01-31
**Task**: Fix console error "previewUrl.value.startsWith is not a function" during navigation

## Executive Summary

The bug occurs at **line 1766** in `useEditPreview.ts` during the `onUnmounted` hook when navigating between photos in edit view. The guard `previewUrl.value &&` checks for truthiness but doesn't verify the value is a string. In race conditions between async renders and unmount, `previewUrl.value` could be a non-string truthy value.

## Error Details

**Error Message**: `TypeError: previewUrl.value.startsWith is not a function`
**Location**: `apps/web/app/composables/useEditPreview.ts:1766`
**Trigger**: Navigating between photos in edit view

## Code Analysis

### Type Definition

```typescript
const previewUrl = ref<string | null>(null)  // Line 631
```

The TypeScript type is `Ref<string | null>`, meaning `.value` should only be `string` or `null`.

### Problem Code (Line 1766)

```typescript
onUnmounted(() => {
  throttledRender.cancel()
  debouncedFullRender.cancel()
  // Only revoke blob URL if we created it (owned), not if it's borrowed from the store
  if (previewUrl.value && previewUrl.value.startsWith('blob:') && isPreviewUrlOwned.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  // ...
})
```

### Why the Guard Fails

The check `previewUrl.value &&` ensures truthiness, but doesn't guarantee string type:
- `null` → falsy → check fails (safe)
- `undefined` → falsy → check fails (safe)
- `{}` → truthy → check passes → `.startsWith()` fails ❌
- `ImageBitmap` → truthy → check passes → `.startsWith()` fails ❌

### All `.startsWith()` Call Sites

| Line | Risk | Context |
|------|------|---------|
| 1322 | Medium | In async `renderPreview()`, could race with cleanup |
| 1351 | Medium | In async `renderPreview()`, could race with cleanup |
| **1766** | **High** | In `onUnmounted` hook |

## Race Condition Scenario

1. User is viewing photo N in edit view
2. Async `renderPreview()` is running
3. User navigates to photo N+1 (or exits edit view)
4. Component starts unmounting
5. `onUnmounted` hook fires
6. Between the truthiness check and `.startsWith()` call, a late async callback sets `previewUrl.value` to a non-string
7. Error thrown

## Recommended Fix

**Add type guard using `typeof`:**

```typescript
onUnmounted(() => {
  throttledRender.cancel()
  debouncedFullRender.cancel()
  // Only revoke blob URL if we created it (owned), not if it's borrowed from the store
  if (typeof previewUrl.value === 'string' && previewUrl.value.startsWith('blob:') && isPreviewUrlOwned.value) {
    URL.revokeObjectURL(previewUrl.value)
  }
  // ...
})
```

**Apply same fix to other call sites (lines 1322, 1351).**

## Files to Modify

- `apps/web/app/composables/useEditPreview.ts` - Add type guards at lines 1322, 1351, 1766

## Test Strategy

1. Verify existing tests pass
2. Add unit test that simulates unmount with non-string previewUrl value
3. Verify no console errors during rapid navigation in demo mode
