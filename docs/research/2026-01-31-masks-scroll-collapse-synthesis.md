# Research Synthesis: Masks Panel Scroll Collapse Bug

**Date**: 2026-01-31
**Issue**: Masks accordion panel collapses unexpectedly when scrolling the page

## Problem Statement

When the Masks accordion panel is expanded and the user scrolls the page (using mouse wheel or scrollbar), the Masks panel unexpectedly collapses. This disrupts the mask editing workflow by forcing users to repeatedly re-expand the panel.

## Research Findings

### 1. Accordion State Management

**File**: `apps/web/app/components/edit/EditControlsPanel.vue`

The accordion uses a local ref for expansion state:
```typescript
const expandedSections = ref<string[]>(['basic'])
```

Three watchers monitor this state:
1. **Crop expansion watch** (lines 121-129): Activates crop tool when expanded
2. **Crop deactivation watch** (lines 135-143): Collapses crop section when tool deactivated
3. **Masks expansion watch** (lines 150-161): Activates/deactivates mask tool on expansion/collapse

### 2. UAccordion Configuration

The UAccordion component is configured with:
- `type="multiple"` - Allows multiple sections expanded simultaneously
- `v-model="expandedSections"` - Two-way binding to the local ref
- `unmount-on-hide="false"` - Keeps child components mounted when collapsed (already fixed in iteration 152)

### 3. Potential Root Causes Investigated

#### A. Wheel Event Propagation
- `useZoomPan.ts` has a wheel handler with `e.preventDefault()`
- Attached to the center preview container only, not the right panel
- Right panel (`overflow-y-auto`) is independently scrollable
- This is NOT the cause - wheel events in right panel shouldn't reach zoom handler

#### B. Vue Reactivity Issues
- The `expandedSections` ref uses a simple array
- When `expandedSections.value.includes('masks')` is checked in watchers, it creates a reactive dependency
- No evidence of infinite loops or circular dependencies

#### C. Focus/Blur Events
- Accordion components may track focus state
- Scrolling could cause focus to shift between elements
- This could trigger unexpected state changes in Reka-UI's AccordionRoot

#### D. Reka-UI Internal Behavior
- UAccordion wraps Reka-UI's AccordionRoot
- AccordionRoot uses `useSingleOrMultipleValue()` hook for state management
- CollapsibleContent has dimension recalculation watchers that use `getBoundingClientRect()`
- Scrolling changes `getBoundingClientRect()` values, potentially triggering re-renders

### 4. Key Discovery

After extensive investigation, the most likely cause is:

**The accordion may be receiving unintended state updates during scroll events due to Vue's reactivity system interacting with Reka-UI's internal state management.**

However, reproducing this issue is difficult because:
1. The issue description mentions scrolling the "page" but the right panel has its own scroll container
2. The issue might be specific to certain scroll patterns or browser behaviors
3. Recent code changes (unmount-on-hide=false) may have partially addressed the issue

## Investigation Strategy

To properly diagnose this issue, we need to:

1. **Add debug logging** to the masks expansion watcher to see when it fires
2. **Monitor `expandedSections.value`** changes during scroll events
3. **Test in different scenarios**:
   - Scrolling within right panel
   - Scrolling via page scroll (if any)
   - Mouse wheel vs scrollbar drag

## Potential Solutions

### Option 1: Debounce/Throttle State Changes
Debounce the `expandedSections` watcher to prevent rapid state changes during scroll.

### Option 2: Use Controlled Accordion
Instead of v-model, use separate props and events to have more control over state changes.

### Option 3: Guard Against Unintended Collapses
Add a flag to track intentional user actions vs unintended state changes.

### Option 4: Investigate Reka-UI Behavior
Check if there's a bug or known issue with Reka-UI's Accordion during scroll events.

## Current Status

The issue is described but difficult to reproduce with current code. The `unmount-on-hide="false"` fix from iteration 152 may have partially addressed this. Further investigation with actual browser debugging is needed to confirm the exact cause.

## Files Analyzed

- `apps/web/app/components/edit/EditControlsPanel.vue`
- `apps/web/app/pages/edit/[id].vue`
- `apps/web/app/composables/useZoomPan.ts`
- `apps/web/app/stores/editUI.ts`
- `apps/web/app/composables/useMaskOverlay.ts`
