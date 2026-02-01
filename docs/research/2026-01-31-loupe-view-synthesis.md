# Loupe View Implementation - Research Synthesis

**Date**: 2026-01-31
**Task**: Implement Loupe View for the culling workflow as specified in spec section 3.4

## Executive Summary

The Loupe view is a single-image culling interface positioned between Grid view (thumbnails) and Edit view (full editing). It allows rapid photo evaluation and flagging without the overhead of the full edit interface. The implementation infrastructure is largely in place—the main work is creating a dedicated page and adapting existing components.

## Spec Requirements (Section 3.4)

### Views Definition
- **Grid view** (default): thumbnails in responsive grid ✅ Implemented
- **Loupe view**: single image large preview + filmstrip ❌ Not implemented
- Filmstrip is present in Loupe and optionally in Edit

### Culling Actions Required
- **Flagging**: Pick (P), Reject (X), Clear (U)
- **Filtering**: All / Picks / Rejects / Unflagged
- **Navigation**: next/prev via arrow keys

### Performance Requirements
- Loupe should switch photos quickly
- Display something immediately (cached preview or scaled thumbnail)
- Replace with full preview when ready

## Existing Infrastructure

### Store Support (Already Exists)

**catalogUI Store** (`apps/web/app/stores/catalogUI.ts`):
```typescript
const viewMode = ref<ViewMode>('grid')  // 'grid' | 'loupe' - READY
const filterMode = ref<FilterMode>('all')
const sortField = ref<SortField>('captureDate')
const sortDirection = ref<SortDirection>('desc')

// Actions
setViewMode(mode: ViewMode)
toggleViewMode()  // grid ↔ loupe
```

**Selection Store** (`apps/web/app/stores/selection.ts`):
- `currentId` - designed for loupe view (documented in comments)
- `selectSingle(id)` - set current and clear selection
- `navigateNext(orderedIds)` / `navigatePrevious(orderedIds)` - navigation helpers

### Reusable Components

1. **EditFilmstrip.vue** (80% reusable)
   - Horizontal thumbnail strip with virtual windowing
   - Auto-scroll to current photo
   - Click to navigate
   - Uses `filteredAssetIds` from catalogUI store
   - Requests thumbnails for visible items

2. **EditPreviewCanvas.vue** (can be simplified)
   - Canvas-based image display with ImageBitmap
   - Zoom/pan via CSS transforms
   - Clipping overlay support
   - ResizeObserver for dimensions

3. **useZoomPan composable** (fully reusable)
   - Wheel zoom with exponential scaling
   - Pan with spacebar hold
   - Double-click toggle (fit ↔ 100%)
   - Camera state in editUI store

4. **useGridKeyboard composable** (pattern reference)
   - Arrow key navigation
   - P/X/U flagging
   - View mode switching (E/Enter/D for edit, G for grid)

## Recommended Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Header (48px): ← Back | Filename | ◀ ▶ Navigation | ? Help  │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│              Center: LoupePreviewCanvas                      │
│              (flex-1, centered, max preview size)            │
│              - Preview 1x/2x display                         │
│              - Zoom/pan with useZoomPan                      │
│              - Optional clipping overlay (J key)             │
│                                                              │
├─────────────────────────────────────────────────────────────┤
│ Filter Bar (40px): All | Picks | Rejects | Unflagged + Sort │
├─────────────────────────────────────────────────────────────┤
│ Filmstrip (80px): ◀ [thumb] [thumb] [CURRENT] [thumb] ▶     │
└─────────────────────────────────────────────────────────────┘
```

## Keyboard Shortcuts

| Action | Shortcut | Notes |
|--------|----------|-------|
| Navigate | ← / → | Previous/Next in filtered list |
| Pick | P | Flag as pick |
| Reject | X | Flag as reject |
| Clear | U | Remove flag |
| Edit | E, Enter, D | Go to /edit/[id] |
| Grid | G, Esc | Return to grid view |
| Zoom fit | Cmd/Ctrl+0 | Fit to window |
| Zoom 100% | Cmd/Ctrl+1 | 1:1 pixels |
| Toggle zoom | Z | Fit ↔ 100% |
| Pan | Space+Drag | When zoomed |
| Clipping | J | Toggle clipping overlay |
| Help | ? | Show help modal |

## Implementation Approach

### Option A: Separate Page Route (`/loupe/[id]`)
- **Pros**: Clean separation, dedicated layout
- **Cons**: Route navigation overhead, needs state sync

### Option B: Inline in Grid Page (Overlay/Modal)
- **Pros**: No route change, faster toggle
- **Cons**: Complex z-index management, state complexity

### Option C: Grid Page with Conditional Rendering (RECOMMENDED)
- **Pros**: Same page, viewMode state controls display, no routing
- **Cons**: Slightly larger page component
- **Implementation**: When `viewMode === 'loupe'`, show loupe view inline

**Recommendation**: Option C - Keep on grid page, toggle with viewMode state

## Files to Create/Modify

### New Files
1. `apps/web/app/components/loupe/LoupeView.vue` - Main loupe view container
2. `apps/web/app/components/loupe/LoupePreviewCanvas.vue` - Simplified preview canvas
3. `apps/web/app/components/loupe/LoupeFilmstrip.vue` - Adapted filmstrip
4. `apps/web/app/composables/useLoupeKeyboard.ts` - Keyboard handling
5. `apps/web/test/loupeView.test.ts` - Unit tests
6. `apps/web/e2e/loupe-view.spec.ts` - E2E tests

### Modified Files
1. `apps/web/app/pages/index.vue` - Add loupe view conditional rendering
2. `apps/web/app/components/catalog/CatalogGrid.vue` - Add view mode toggle
3. `apps/web/app/components/help/HelpModal.vue` - Add loupe shortcuts section

## Key Simplifications vs Edit View

| Aspect | Edit View | Loupe View |
|--------|-----------|-----------|
| Overlays | 3 (clipping, crop, mask) | 1 (clipping only) |
| Quality levels | Draft + full | Full only |
| State machine | 4 states | 2 states (loading/ready) |
| Right panel | Edit controls | None |
| Left panel | Histogram | None (or minimal) |
| Rendering | GPU pipeline | Simple preview display |

## Data Flow

```
User clicks thumbnail or presses V key
    ↓
catalogUIStore.setViewMode('loupe')
    ↓
selectionStore.selectSingle(assetId)
    ↓
Grid page conditionally renders LoupeView
    ↓
LoupeView displays preview + filmstrip
    ↓
User presses P/X/U → setFlag(flag)
User presses ←/→ → navigateNext/Prev
User presses G/Esc → setViewMode('grid')
User presses E → navigateTo('/edit/[id]')
```

## Testing Strategy

### Unit Tests
- LoupeView component rendering
- Keyboard navigation (P/X/U, arrows, Esc, G)
- View mode toggle
- Filmstrip integration
- Preview loading states

### E2E Tests
- Grid → Loupe → Grid navigation
- Flagging workflow in loupe
- Arrow key navigation
- Filter mode respects in loupe
- Edit transition from loupe

## Success Criteria

1. V key or double-click enters loupe view from grid
2. Arrow keys navigate between filtered photos
3. P/X/U flags photos correctly
4. E key enters edit view for current photo
5. G/Esc returns to grid view
6. Filmstrip shows filtered photos with current highlighted
7. Preview displays quickly (cached or thumbnail fallback)
8. Zoom/pan works with useZoomPan
9. All keyboard shortcuts from help modal work
10. Performance: <100ms view switch, <300ms photo change
