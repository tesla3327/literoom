# Keyboard Shortcuts Help Modal - Research Synthesis

## Date: 2026-01-22

## Objective
Implement a help modal that documents all keyboard shortcuts in the application, fulfilling the spec requirement from section 7.3: "Keyboard shortcuts are documented in-app (help modal)".

---

## 1. Complete Keyboard Shortcuts Inventory

### Grid View (Catalog)

| Shortcut | Action | File | Line |
|----------|--------|------|------|
| Arrow Left | Navigate to previous item | useGridKeyboard.ts | 266 |
| Arrow Right | Navigate to next item | useGridKeyboard.ts | 262 |
| Arrow Up | Navigate up one row | useGridKeyboard.ts | 274 |
| Arrow Down | Navigate down one row | useGridKeyboard.ts | 270 |
| P | Pick (flag) current photo | useGridKeyboard.ts | 280 |
| X | Reject current photo | useGridKeyboard.ts | 284 |
| U | Unflag current photo | useGridKeyboard.ts | 290 |
| E | Enter edit view | useGridKeyboard.ts | 300 |
| Enter | Enter edit view | useGridKeyboard.ts | 300 |
| D | Enter edit view (Develop) | useGridKeyboard.ts | 310 |
| G | Grid view (no-op in grid) | useGridKeyboard.ts | 306 |
| Delete/Backspace | Delete current photo | useGridKeyboard.ts | 320 |
| Cmd/Ctrl+E | Open export modal | index.vue | 124-130 |
| Shift+Click | Range select | selection.ts | 196 |
| Cmd/Ctrl+Click | Toggle selection | selection.ts | 199 |

### Edit View

| Shortcut | Action | File | Line |
|----------|--------|------|------|
| Escape | Return to grid | edit/[id].vue | 135 |
| Arrow Left | Previous photo | edit/[id].vue | 138 |
| Arrow Right | Next photo | edit/[id].vue | 141 |
| G | Return to grid | edit/[id].vue | 144 |
| Cmd/Ctrl+Shift+C | Copy settings | edit/[id].vue | 120 |
| Cmd/Ctrl+Shift+V | Paste settings | edit/[id].vue | 125 |
| J | Toggle clipping overlay | EditHistogramDisplaySVG.vue | 44-47 |

### Mask Editing (Edit View)

| Shortcut | Action | File | Line |
|----------|--------|------|------|
| Escape | Cancel mask drawing | useMaskOverlay.ts | 631 |
| Delete/Backspace | Delete selected mask | useMaskOverlay.ts | 644 |

---

## 2. Nuxt UI 4 Modal Patterns

### Existing Modal Implementations
1. **ExportModal** - Export configuration
2. **EditCopySettingsModal** - Copy settings selector
3. **PermissionRecovery** - Folder permission recovery

### Common Pattern
```vue
<UModal v-model:open="store.isModalOpen" :dismissible="true">
  <template #header><!-- Title --></template>
  <template #body><!-- Content --></template>
  <template #footer><!-- Actions --></template>
</UModal>
```

### State Management Pattern
- Boolean ref in Pinia store (`isModalOpen`)
- `openModal()` / `closeModal()` methods
- Component binds via `v-model:open`

### Triggering Pattern
- Keyboard shortcut: `?` or `F1` (common conventions)
- Menu/button click
- Store method call

---

## 3. Design Decisions

### Modal Trigger
- **Primary**: `?` key (standard help shortcut)
- **Alternative**: `Cmd/Ctrl+/` (VS Code pattern)
- Both should work globally

### Modal Layout
Two-column layout grouping shortcuts by view:
- **Column 1**: Grid View shortcuts
- **Column 2**: Edit View shortcuts

### Visual Design
- Table format with Key + Description columns
- Key styling: monospace, slightly highlighted (kbd style)
- Platform-aware modifier keys (Cmd vs Ctrl)

### Store Location
Create new `helpStore` or add to existing `catalogUI` store
- Prefer new `helpStore` for separation of concerns

---

## 4. Implementation Approach

### Files to Create
1. `apps/web/app/stores/help.ts` - Modal state store
2. `apps/web/app/components/help/HelpModal.vue` - Modal component

### Files to Modify
1. `apps/web/app/pages/index.vue` - Add modal + keyboard handler
2. `apps/web/app/pages/edit/[id].vue` - Add keyboard handler

### Keyboard Handler Location
- Add `?` handler to both index.vue and edit/[id].vue
- Or create a global composable `useHelpModal`

---

## 5. UI Mockup

```
+----------------------------------------------------------+
|  Keyboard Shortcuts                                [X]   |
+----------------------------------------------------------+
|                                                          |
|  GRID VIEW                   EDIT VIEW                   |
|  ─────────                   ─────────                   |
|  ← →           Navigate      ← →         Navigate        |
|  ↑ ↓           Move row      Esc         Back to grid    |
|  P             Pick          G           Back to grid    |
|  X             Reject        Cmd+Shift+C Copy settings   |
|  U             Unflag        Cmd+Shift+V Paste settings  |
|  E/Enter/D     Edit          J           Toggle clipping |
|  Delete        Delete                                    |
|  Cmd+E         Export        MASK EDITING                |
|                              ───────────                 |
|  SELECTION                   Esc         Cancel drawing  |
|  ─────────                   Delete      Delete mask     |
|  Shift+Click   Range select                              |
|  Cmd+Click     Toggle select                             |
|                                                          |
+----------------------------------------------------------+
|                                          [Close]         |
+----------------------------------------------------------+
```

---

## 6. Platform Detection

Use `navigator.platform` or `navigator.userAgentData` to detect:
- macOS: Show "Cmd"
- Windows/Linux: Show "Ctrl"

```typescript
const isMac = computed(() =>
  typeof navigator !== 'undefined' &&
  /Mac|iPod|iPhone|iPad/.test(navigator.platform)
)
const modKey = computed(() => isMac.value ? 'Cmd' : 'Ctrl')
```

---

## 7. Accessibility Considerations

- Modal traps focus when open
- ESC key closes modal
- All content readable by screen readers
- Proper ARIA labels on modal

---

## 8. Testing Strategy

- Unit test: Store state management
- Unit test: Platform detection
- E2E: `?` key opens modal
- E2E: Modal content matches expected shortcuts
- E2E: ESC closes modal
