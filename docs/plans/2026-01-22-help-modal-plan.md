# Keyboard Shortcuts Help Modal - Implementation Plan

## Date: 2026-01-22

## Objective
Create a help modal that displays all keyboard shortcuts, triggered by pressing `?` or `Cmd/Ctrl+/`.

---

## Phase 1: Create Help Store

**File**: `apps/web/app/stores/help.ts`

```typescript
export const useHelpStore = defineStore('help', () => {
  const isModalOpen = ref(false)

  function openModal() { isModalOpen.value = true }
  function closeModal() { isModalOpen.value = false }
  function toggleModal() { isModalOpen.value = !isModalOpen.value }

  return { isModalOpen, openModal, closeModal, toggleModal }
})
```

---

## Phase 2: Create HelpModal Component

**File**: `apps/web/app/components/help/HelpModal.vue`

### Structure
- Two-column layout
- Grid View shortcuts on left
- Edit View shortcuts on right
- Platform-aware modifier keys

### Key Features
- `<kbd>` styled elements for keys
- Grouped by section (Navigation, Flagging, etc.)
- Responsive: stack on mobile

### Slot Usage
- `#header`: "Keyboard Shortcuts" title
- `#body`: Two-column shortcut tables
- `#footer`: Close button

---

## Phase 3: Add Global Keyboard Handler

**File**: `apps/web/app/composables/useHelpModal.ts`

```typescript
export function useHelpModal() {
  const helpStore = useHelpStore()

  function handleKeydown(event: KeyboardEvent) {
    // Ignore if typing in input
    if (shouldIgnoreShortcuts(event)) return

    // ? key
    if (event.key === '?') {
      event.preventDefault()
      helpStore.toggleModal()
      return
    }

    // Cmd/Ctrl + /
    if ((event.metaKey || event.ctrlKey) && event.key === '/') {
      event.preventDefault()
      helpStore.toggleModal()
      return
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

  return { openModal: helpStore.openModal }
}
```

---

## Phase 4: Integrate Into Pages

### Index Page (`apps/web/app/pages/index.vue`)
1. Import and use `useHelpModal()` composable
2. Add `<HelpModal />` component to template

### Edit Page (`apps/web/app/pages/edit/[id].vue`)
1. Import and use `useHelpModal()` composable
2. Add `<HelpModal />` component to template

---

## Phase 5: Add Help Button (Optional)

Add a help button to the header/toolbar that opens the modal:
- Icon: `heroicons:question-mark-circle`
- Location: Header right side, near settings
- Click handler: `helpStore.openModal()`

---

## Implementation Checklist

- [ ] Create `stores/help.ts`
- [ ] Create `components/help/HelpModal.vue`
- [ ] Create `composables/useHelpModal.ts`
- [ ] Integrate into `pages/index.vue`
- [ ] Integrate into `pages/edit/[id].vue`
- [ ] Add help button to header (optional)
- [ ] Test `?` key opens modal
- [ ] Test `Cmd/Ctrl+/` opens modal
- [ ] Test modal closes with ESC
- [ ] Test platform-aware modifier display

---

## Files to Create (3)
1. `apps/web/app/stores/help.ts`
2. `apps/web/app/components/help/HelpModal.vue`
3. `apps/web/app/composables/useHelpModal.ts`

## Files to Modify (2)
1. `apps/web/app/pages/index.vue`
2. `apps/web/app/pages/edit/[id].vue`

---

## Estimated Effort
- Phase 1 (Store): Small
- Phase 2 (Component): Medium
- Phase 3 (Composable): Small
- Phase 4 (Integration): Small
- Phase 5 (Button): Small (optional)

Total: ~1 iteration
