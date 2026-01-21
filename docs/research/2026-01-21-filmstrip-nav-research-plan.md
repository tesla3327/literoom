# Research Plan: Filmstrip Navigation Stuck Loading State

**Date**: 2026-01-21
**Status**: In Progress
**Issue Severity**: Critical

---

## Problem Statement

Rapidly clicking between thumbnails in the edit view filmstrip can cause both the preview and histogram to get stuck in a "Loading..." state. In severe cases, the entire edit view becomes broken with empty filmstrip and "0 / 0" position indicator.

## Known Symptoms

1. Preview shows "Loading preview..." indefinitely
2. Histogram shows "Loading..." indefinitely
3. In severe cases:
   - Header shows "0 / 0" instead of asset position
   - Filmstrip becomes completely empty
   - No filename, format, or size displayed
4. Only recovery is navigating back to catalog (G key) and re-entering edit view

## Known Console Errors

```
[Vue warn] Set operation on key "value" failed: target is readonly. RefImpl
[Vue warn]: Unhandled error during execution of watcher callback
[Vue warn]: Unhandled error during execution of component update
```

Also noted (HMR-related, possibly transient):
- `createGaussianKernel is not defined`
- `SMOOTHING_KERNEL is not defined`

## Research Areas

### Area 1: Readonly Ref Mutations
**Question**: Where does the code try to mutate a readonly ref?
**Files to examine**:
- `apps/web/app/composables/useEditPreview.ts` - Uses `toRef(props, 'assetId')`
- `apps/web/app/composables/useHistogramDisplay.ts` - May have similar patterns
- `apps/web/app/components/edit/EditPreviewCanvas.vue` - Uses `toRef(props, 'assetId')`
- `apps/web/app/components/edit/EditHistogramDisplay.vue` - Uses `toRef(props, 'assetId')`

**Investigate**: All uses of `toRef` and potential mutation patterns

### Area 2: Race Conditions in Async Operations
**Question**: How do multiple async operations interact during rapid navigation?
**Files to examine**:
- `apps/web/app/composables/useEditPreview.ts` - Preview loading logic
- `apps/web/app/composables/useHistogramDisplay.ts` - Histogram computation
- `packages/core/src/decode/decode-service.ts` - Request correlation

**Investigate**:
- How are pending requests tracked?
- Is there cancellation when asset changes?
- What happens when responses arrive for stale requests?

### Area 3: Watcher Callback Errors
**Question**: Which watchers are throwing uncaught exceptions?
**Files to examine**:
- `apps/web/app/composables/useEditPreview.ts`
- `apps/web/app/composables/useHistogramDisplay.ts`
- `apps/web/app/pages/edit/[id].vue`

**Investigate**: All `watch()` calls and their error handling

### Area 4: ShallowRef Reactivity
**Question**: Is shallowRef causing missed updates?
**Files to examine**:
- `apps/web/app/stores/catalog.ts` - Uses `shallowRef` for assets Map
- Related computed properties that depend on asset changes

**Investigate**: How computed properties react when individual asset properties change

### Area 5: Filmstrip Component Implementation
**Question**: How does filmstrip navigation trigger asset changes?
**Files to examine**:
- `apps/web/app/components/edit/EditFilmstrip.vue`
- `apps/web/app/stores/selection.ts`

**Investigate**: Event flow from click to asset change

### Area 6: Missing Constants in Histogram
**Question**: Are SMOOTHING_KERNEL and createGaussianKernel actually missing?
**Files to examine**:
- `apps/web/app/composables/useHistogramDisplay.ts`

**Investigate**: Whether these are runtime errors or just HMR artifacts

## Research Assignment

| Area | Agent Focus |
|------|-------------|
| Area 1 | Readonly ref mutation patterns |
| Area 2 | Async race condition analysis |
| Area 3 | Watcher error handling |
| Area 4 | ShallowRef reactivity issues |
| Area 5 | Filmstrip navigation flow |
| Area 6 | Histogram constants |

## Expected Outputs

1. Root cause identification
2. List of specific code locations needing fixes
3. Recommended fix approach for each issue
