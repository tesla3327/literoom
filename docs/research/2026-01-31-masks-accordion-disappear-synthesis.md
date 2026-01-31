# Research Synthesis: Masks Disappear After Panel Collapse/Expand

**Date**: 2026-01-31
**Issue**: Masks disappear after the Masks accordion panel is collapsed and re-expanded

## Executive Summary

The masks disappear when the accordion collapses and re-expands due to the **default `unmountOnHide={true}` behavior in Nuxt UI's UAccordion component**. This causes child components (EditMaskPanel, EditMaskAdjustments) to be completely unmounted from the DOM when collapsed.

## Root Causes Identified

### Primary Root Cause: UAccordion unmountOnHide Default

**Location**: `apps/web/app/components/edit/EditControlsPanel.vue`, line 229

```vue
<UAccordion
  v-model="expandedSections"
  type="multiple"
  :items="accordionItems"
>
```

**Problem**: The `unmountOnHide` prop is NOT explicitly set, so it defaults to `true`.

**Evidence from Nuxt UI source** (`@nuxt/ui/dist/runtime/components/Accordion.vue`, line 27):
```javascript
unmountOnHide: { type: Boolean, required: false, default: true }
```

**Evidence from reka-ui** (`reka-ui/dist/Collapsible/CollapsibleContent.js`, lines 79-81):
```javascript
default: withCtx(() => [(unref(rootContext).unmountOnHide.value ? present : true)
  ? renderSlot(_ctx.$slots, "default", { key: 0 })
  : createCommentVNode("v-if", true)])
```

When `unmountOnHide = true` and the accordion item is not expanded, the entire slot content is replaced with a comment node (v-if style unmounting), destroying all child component state.

### Impact on Component Lifecycle

When masks accordion collapses:
1. The entire `masks-body` template is unmounted
2. `EditMaskPanel` and `EditMaskAdjustments` components are destroyed
3. The mask overlay canvas is removed from DOM
4. Event listeners in `useMaskOverlay` are torn down

When masks accordion re-expands:
1. Components are freshly mounted
2. Canvas is recreated
3. Event listeners need to be re-attached
4. Render needs to be triggered

### Secondary Issue: Canvas Dimension Race Condition

**Location**: `apps/web/app/composables/useMaskOverlay.ts`, lines 200-201

```typescript
if (w === 0 || h === 0) return  // Silent failure if dimensions are 0
```

When the canvas is first mounted after accordion expansion, its dimensions might be 0x0 temporarily, causing `render()` to silently return without drawing.

### Tertiary Issue: Mask Tool Deactivation Watch

**Location**: `apps/web/app/components/edit/EditControlsPanel.vue`, lines 150-161

```typescript
watch(
  () => expandedSections.value.includes('masks'),
  (isMasksExpanded) => {
    if (isMasksExpanded) {
      editUIStore.activateMaskTool()
    }
    else {
      editUIStore.deactivateMaskTool()  // THIS FIRES ON COLLAPSE
    }
  },
  { immediate: true },
)
```

This deactivates the mask tool on collapse, which:
- Sets `isMaskToolActive = false`
- Sets `maskDrawingMode = null`
- Removes the mask overlay canvas from DOM (`v-if="editUIStore.isMaskToolActive"`)

## Solution

### Primary Fix: Add `unmount-on-hide="false"` to UAccordion

**File**: `apps/web/app/components/edit/EditControlsPanel.vue`

Change line 229 from:
```vue
<UAccordion
  v-model="expandedSections"
  type="multiple"
  :items="accordionItems"
>
```

To:
```vue
<UAccordion
  v-model="expandedSections"
  type="multiple"
  :items="accordionItems"
  :unmount-on-hide="false"
>
```

This will preserve the component tree and state when accordion items are collapsed/expanded, preventing masks from disappearing.

### Why This Works

With `unmount-on-hide="false"`:
- EditMaskPanel and EditMaskAdjustments remain mounted (but hidden)
- Component state is preserved
- When accordion re-expands, components are already initialized
- Masks remain visible in the store and render correctly

## Alternative Considerations

### Alternative: Keep unmountOnHide but ensure proper re-render

If we want to keep `unmountOnHide={true}` for performance reasons:
1. Add explicit `render()` call in `useMaskOverlay` when canvas ref changes from null to valid
2. Ensure dimensions are available before rendering
3. Force re-render after `nextTick` to ensure dimensions are set

**However**, the simpler fix of `unmount-on-hide="false"` is recommended because:
- Minimal code change
- No risk of introducing new bugs
- Matches expected UX behavior (masks panel state preserved)
- Performance impact is negligible (a few hidden DOM nodes)

## Test Coverage Gaps

Currently missing tests for:
1. Accordion collapse/expand with masks present
2. Mask rendering after accordion toggle
3. Event listener reattachment after canvas remount
4. Canvas dimension validation during mount

## Files to Modify

1. `apps/web/app/components/edit/EditControlsPanel.vue` - Add `:unmount-on-hide="false"`

## Testing Plan

1. Manual verification:
   - Create linear mask
   - Collapse masks accordion
   - Expand masks accordion
   - Verify mask is still visible and interactive

2. Unit test additions:
   - Test mask persistence during accordion collapse/expand cycle
