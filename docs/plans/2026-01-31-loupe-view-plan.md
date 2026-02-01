# Loupe View Implementation Plan

**Date**: 2026-01-31
**Task**: Implement Loupe View for catalog culling workflow (spec section 3.4)

## Overview

Add Loupe view as an alternative to Grid view for rapid photo culling. Loupe shows a single large preview with filmstrip navigation, optimized for keyboard-driven flagging workflow.

## Implementation Phases

### Phase 1: Core Components

#### 1.1 LoupePreviewCanvas Component
**File**: `apps/web/app/components/loupe/LoupePreviewCanvas.vue`

Simplified preview canvas without edit overlays:
- Display preview 1x (2560px) or thumbnail fallback
- Zoom/pan support via useZoomPan
- Optional clipping overlay (J key toggle)
- Loading state handling

```typescript
interface Props {
  assetId: string
}

// Uses:
// - useCatalog().requestPreview()
// - useZoomPan() for zoom/pan
// - useClippingOverlay() for clipping display
```

#### 1.2 LoupeFilmstrip Component
**File**: `apps/web/app/components/loupe/LoupeFilmstrip.vue`

Adapted from EditFilmstrip with selection store integration:
- Horizontal scrolling thumbnails
- Uses filteredAssetIds from catalogUI store
- Click to select (updates selectionStore.currentId)
- Auto-scroll to current
- Virtual windowing (30 items around current)

```typescript
// Uses selectionStore.currentId instead of route params
const selectionStore = useSelectionStore()
const currentAssetId = computed(() => selectionStore.currentId)
```

#### 1.3 LoupeView Container
**File**: `apps/web/app/components/loupe/LoupeView.vue`

Main container orchestrating the loupe layout:
- Header with back button, filename, navigation arrows
- LoupePreviewCanvas (flex-1)
- FilterBar (reused from catalog)
- LoupeFilmstrip (fixed height)

### Phase 2: Keyboard Handling

#### 2.1 useLoupeKeyboard Composable
**File**: `apps/web/app/composables/useLoupeKeyboard.ts`

Handle loupe-specific keyboard shortcuts:

```typescript
export function useLoupeKeyboard() {
  const catalogStore = useCatalogStore()
  const catalogUIStore = useCatalogUIStore()
  const selectionStore = useSelectionStore()
  const editUIStore = useEditUIStore()
  const router = useRouter()
  const { setFlag } = useCatalog()

  function handleKeydown(event: KeyboardEvent) {
    // Skip if typing in input
    if (shouldIgnoreShortcut(event)) return

    const filteredIds = catalogUIStore.filteredAssetIds
    const currentId = selectionStore.currentId

    switch (event.key) {
      // Navigation
      case 'ArrowLeft':
        event.preventDefault()
        selectionStore.navigatePrevious(filteredIds)
        break
      case 'ArrowRight':
        event.preventDefault()
        selectionStore.navigateNext(filteredIds)
        break

      // Flagging
      case 'p':
      case 'P':
        if (currentId) setFlag('pick')
        break
      case 'x':
      case 'X':
        if (currentId) setFlag('reject')
        break
      case 'u':
      case 'U':
        if (currentId) setFlag('none')
        break

      // View switching
      case 'g':
      case 'G':
      case 'Escape':
        catalogUIStore.setViewMode('grid')
        break
      case 'e':
      case 'E':
      case 'Enter':
        if (currentId) router.push(`/edit/${currentId}`)
        break

      // Zoom
      case 'z':
      case 'Z':
        editUIStore.toggleZoom()
        break
      case 'j':
      case 'J':
        editUIStore.toggleHighlightClipping()
        editUIStore.toggleShadowClipping()
        break
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
}
```

### Phase 3: Integration

#### 3.1 Update Index Page
**File**: `apps/web/app/pages/index.vue`

Add conditional rendering for loupe view:

```vue
<template>
  <div class="h-full flex flex-col">
    <!-- Show loupe view when viewMode is 'loupe' -->
    <LoupeView
      v-if="catalogUIStore.viewMode === 'loupe' && hasAssets"
      @back="catalogUIStore.setViewMode('grid')"
    />

    <!-- Show grid view when viewMode is 'grid' -->
    <template v-else>
      <!-- Existing grid view content -->
    </template>
  </div>
</template>
```

#### 3.2 Update CatalogGrid for Loupe Entry
**File**: `apps/web/app/components/catalog/CatalogGrid.vue`

Add loupe view trigger:

```typescript
// In useGridKeyboard options
onViewChange: (mode) => {
  if (mode === 'edit') {
    // Enter edit mode (existing behavior)
    navigateTo(`/edit/${currentId}`)
  }
  else if (mode === 'loupe') {
    // Enter loupe mode (new)
    catalogUIStore.setViewMode('loupe')
  }
}

// Add 'V' or 'Space' key for loupe toggle
case 'v':
case 'V':
case ' ': // Space key
  event.preventDefault()
  callbacks.onViewChange?.('loupe')
  break
```

#### 3.3 Update Help Modal
**File**: `apps/web/app/components/help/HelpModal.vue`

Add Loupe View section between Grid and Edit:

```vue
<!-- Loupe View shortcuts -->
<div>
  <h3>Loupe View</h3>
  <dl>
    <dt>← / →</dt><dd>Previous / Next photo</dd>
    <dt>P</dt><dd>Flag as Pick</dd>
    <dt>X</dt><dd>Flag as Reject</dd>
    <dt>U</dt><dd>Clear flag</dd>
    <dt>E / Enter</dt><dd>Enter Edit view</dd>
    <dt>G / Esc</dt><dd>Return to Grid</dd>
    <dt>Z</dt><dd>Toggle fit / 100%</dd>
    <dt>J</dt><dd>Toggle clipping overlay</dd>
  </dl>
</div>
```

### Phase 4: Tests

#### 4.1 Unit Tests
**File**: `apps/web/test/loupeView.test.ts`

```typescript
describe('LoupeView', () => {
  describe('rendering', () => {
    it('displays preview canvas')
    it('displays filmstrip')
    it('shows current photo filename in header')
    it('highlights current photo in filmstrip')
  })

  describe('navigation', () => {
    it('navigates to next photo with ArrowRight')
    it('navigates to previous photo with ArrowLeft')
    it('wraps at boundaries')
  })

  describe('flagging', () => {
    it('flags as pick with P key')
    it('flags as reject with X key')
    it('clears flag with U key')
  })

  describe('view switching', () => {
    it('returns to grid with G key')
    it('returns to grid with Escape')
    it('enters edit with E key')
  })
})
```

#### 4.2 E2E Tests
**File**: `apps/web/e2e/loupe-view.spec.ts`

```typescript
test('grid to loupe navigation', async () => {
  // Click thumbnail → loupe view appears
  // Press V → loupe view appears
})

test('flagging in loupe view', async () => {
  // Enter loupe, press P, verify pick flag
})

test('navigation in loupe view', async () => {
  // Enter loupe, press arrow keys, verify photo changes
})

test('edit transition from loupe', async () => {
  // Enter loupe, press E, verify edit page opens
})
```

## Files Summary

### New Files (6)
1. `apps/web/app/components/loupe/LoupeView.vue`
2. `apps/web/app/components/loupe/LoupePreviewCanvas.vue`
3. `apps/web/app/components/loupe/LoupeFilmstrip.vue`
4. `apps/web/app/composables/useLoupeKeyboard.ts`
5. `apps/web/test/loupeView.test.ts`
6. `apps/web/e2e/loupe-view.spec.ts`

### Modified Files (3)
1. `apps/web/app/pages/index.vue` - Add LoupeView conditional
2. `apps/web/app/components/catalog/CatalogGrid.vue` - Add V key handler
3. `apps/web/app/components/help/HelpModal.vue` - Add Loupe shortcuts

## Implementation Order

1. **LoupeFilmstrip.vue** - Adapt from EditFilmstrip (selection store)
2. **LoupePreviewCanvas.vue** - Simplified from EditPreviewCanvas
3. **useLoupeKeyboard.ts** - Keyboard handling
4. **LoupeView.vue** - Container combining components
5. **index.vue** - Integrate LoupeView with view mode toggle
6. **CatalogGrid.vue** - Add V key for loupe entry
7. **HelpModal.vue** - Document shortcuts
8. **Tests** - Unit and E2E tests

## Success Criteria

- [ ] V key or Space enters loupe from grid
- [ ] Arrow keys navigate between filtered photos
- [ ] P/X/U flags work correctly
- [ ] E key opens edit view
- [ ] G/Esc returns to grid
- [ ] Filmstrip shows filtered photos
- [ ] Current photo highlighted in filmstrip
- [ ] Preview loads quickly
- [ ] Zoom/pan works
- [ ] All tests pass
