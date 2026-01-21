# Copy/Paste Settings Research Synthesis

**Date**: 2026-01-21
**Status**: Complete
**Purpose**: Research for implementing copy/paste settings feature (Phase 13)

---

## Executive Summary

The copy/paste settings feature is a v1 requirement that allows users to copy edit settings from one photo and paste them selectively to one or many other photos. Research confirms that **90% of the infrastructure already exists** in Literoom.

**Key Findings**:
1. Edit state architecture is well-designed with clear separation of concerns
2. Selection store fully supports multi-select for paste targets
3. Keyboard shortcut patterns established and reusable
4. VueUse provides `useClipboard()` for native clipboard API
5. Modal patterns established for user interactions

---

## 1. Current Edit State Architecture

### EditState Structure (Version 3)

```typescript
interface EditState {
  version: 3
  adjustments: Adjustments
  cropTransform: CropTransform
}

interface Adjustments {
  temperature: number     // -100 to 100
  tint: number           // -100 to 100
  exposure: number       // -5 to 5
  contrast: number       // -100 to 100
  highlights: number     // -100 to 100
  shadows: number        // -100 to 100
  whites: number         // -100 to 100
  blacks: number         // -100 to 100
  vibrance: number       // -100 to 100
  saturation: number     // -100 to 100
  toneCurve: ToneCurve   // Array of control points
}

interface CropTransform {
  crop: CropRectangle | null
  rotation: RotationParameters
}
```

### What Can Be Copied

| Category | Sub-items | Default Include |
|----------|-----------|-----------------|
| **Basic Adjustments** | Temperature, Tint, Exposure, Contrast, Highlights, Shadows, Whites, Blacks, Vibrance, Saturation | ✅ Yes |
| **Tone Curve** | Control points array | ✅ Yes |
| **Crop** | left, top, width, height (normalized 0-1) | ❌ No |
| **Rotation** | angle, straighten | ❌ No |

### Store Methods Available

- `setAdjustments(updates: Partial<Adjustments>)` - Apply partial updates
- `setToneCurve(curve: ToneCurve)` - Apply tone curve
- `setCropTransform(transform: CropTransform)` - Apply crop/transform
- `setCrop(crop: CropRectangle | null)` - Apply crop only
- `setRotation(rotation: RotationParameters)` - Apply rotation only
- `reset()` - Reset all to defaults

---

## 2. Selection System for Paste Targets

### Current Capabilities

The selection store (`apps/web/app/stores/selection.ts`) fully supports multi-select:

- **Single selection**: `currentId` - The focused asset
- **Multi-selection**: `selectedIds` - A `Set<string>` of selected asset IDs
- **Selection methods**:
  - `selectSingle(assetId)` - Select one, clear others
  - `toggleSelection(assetId)` - Ctrl/Cmd+click
  - `selectRange(assetId, orderedIds)` - Shift+click
  - `selectAll(orderedIds)` - Select all

### Batch Operations Already Implemented

```typescript
// Example from useCatalog.ts - flagging multiple photos
async function setFlag(flag: FlagStatus): Promise<void> {
  const selectedIds = selectionStore.selectedIds
  if (selectedIds.size > 0) {
    await service.setFlagBatch([...selectedIds], flag)
  } else if (currentId) {
    await service.setFlag(currentId, flag)
  }
}
```

This pattern can be reused for paste operations.

---

## 3. Lightroom UX Patterns to Replicate

### Copy Settings Dialog

**Access Methods**:
- Keyboard: `Cmd+Shift+C` (Mac) / `Ctrl+Shift+C` (Windows)
- Menu: Edit → Copy Settings

**Dialog Structure**:
- Preset buttons: "All", "Modified", "Default", "None"
- Checkbox groups organized by panel:
  - Basic (master checkbox + individual items)
  - Tone Curve
  - Crop & Transform
- Master checkbox per group controls all sub-items

**Excluded by Default** (safety mechanism):
- Crop and Geometry
- These must be manually checked to include

### Paste Settings

**Access Methods**:
- Keyboard: `Cmd+Shift+V` (Mac) / `Ctrl+Shift+V` (Windows)
- Menu: Edit → Paste Settings

**Behavior**:
- In Edit view: Paste to current photo only
- In Grid view: Paste to all selected photos

### Sync Settings (Alternative Workflow)

- For batch editing photos from same scene
- Select multiple → Click "Sync" → Choose settings → Apply to all

---

## 4. Existing Utilities to Reuse

### Keyboard Shortcuts

**Pattern from `useGridKeyboard.ts`**:
```typescript
function handleKeydown(e: KeyboardEvent) {
  if (shouldIgnoreShortcuts(e.target as HTMLElement)) return

  const key = e.key.toLowerCase()
  if (e.metaKey || e.ctrlKey) {
    if (key === 'c') { /* copy */ }
    if (key === 'v') { /* paste */ }
  }
}
```

### VueUse Clipboard

```typescript
import { useClipboard } from '@vueuse/core'

const { copy, copied, isSupported } = useClipboard()
await copy(JSON.stringify(editState))
```

### Modal Pattern

**From `PermissionRecovery.vue`**:
```vue
<UModal v-model:open="store.showModal" :dismissible="false">
  <template #header>Copy Settings</template>
  <template #body>
    <!-- Checkbox groups -->
  </template>
  <template #footer>
    <UButton @click="cancel">Cancel</UButton>
    <UButton variant="primary" @click="copy">Copy</UButton>
  </template>
</UModal>
```

### State Tracking

```typescript
// Existing patterns for error/loading states
const copyState = ref<'idle' | 'copying' | 'success' | 'error'>('idle')
const copyError = ref<string | null>(null)
```

---

## 5. Recommended Implementation

### Data Structure for Clipboard

```typescript
interface CopiedSettings {
  type: 'literoom-settings'
  version: 1
  timestamp: number
  sourceAssetId: string
  groups: {
    basicAdjustments: boolean
    toneCurve: boolean
    crop: boolean
    rotation: boolean
  }
  data: {
    adjustments?: Partial<Adjustments>
    toneCurve?: ToneCurve
    crop?: CropRectangle | null
    rotation?: RotationParameters
  }
}
```

### New Files to Create

1. **`apps/web/app/stores/editClipboard.ts`** - Clipboard state management
2. **`apps/web/app/composables/useCopyPasteSettings.ts`** - Copy/paste logic
3. **`apps/web/app/components/edit/EditCopySettingsModal.vue`** - Copy dialog
4. **`apps/web/app/components/edit/EditPasteSettingsModal.vue`** - Paste dialog (optional)

### Files to Modify

1. **`apps/web/app/pages/edit/[id].vue`** - Add keyboard shortcuts
2. **`apps/web/app/components/edit/EditControlsPanel.vue`** - Add copy/paste buttons
3. **`apps/web/app/stores/edit.ts`** - Add bulk apply method for paste

---

## 6. Implementation Phases

### Phase 1: Clipboard Store
- Create `editClipboard.ts` store
- Track copied settings, source asset, timestamp
- Track which groups are selected for copy

### Phase 2: Copy Settings Composable
- Create `useCopyPasteSettings.ts`
- Implement `copySettings()` method
- Use `useClipboard()` for browser clipboard integration

### Phase 3: Copy Settings Modal
- Create `EditCopySettingsModal.vue`
- Checkbox groups for selecting what to copy
- Preset buttons (All, Modified, None)

### Phase 4: Paste Settings
- Implement `pasteSettings()` method
- Apply to current asset or all selected assets
- Integrate with selection store

### Phase 5: Keyboard Shortcuts
- Add `Cmd+Shift+C` for copy dialog
- Add `Cmd+Shift+V` for paste
- Handle focus properly (ignore when in inputs)

### Phase 6: UI Integration
- Add copy/paste buttons to EditControlsPanel
- Add visual feedback for clipboard state
- Add toast/notification for paste success

---

## 7. Architecture Diagram

```
┌─────────────────────────────────────────────────────────┐
│                    Edit View                             │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │ Keyboard    │  │ Copy/Paste  │  │ Edit Controls   │  │
│  │ Handler     │→ │ Composable  │← │ Panel           │  │
│  └─────────────┘  └──────┬──────┘  └─────────────────┘  │
│                          │                               │
│                          ▼                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │              Edit Clipboard Store                │    │
│  │  - copiedSettings: CopiedSettings | null        │    │
│  │  - selectedGroups: { basic, curve, crop, rot }  │    │
│  │  - copyFromAsset(id, groups)                    │    │
│  │  - clear()                                       │    │
│  └──────────────────────┬──────────────────────────┘    │
│                          │                               │
│         ┌────────────────┼────────────────┐              │
│         ▼                ▼                ▼              │
│  ┌────────────┐  ┌────────────┐  ┌────────────────┐     │
│  │ Edit Store │  │ Selection  │  │ Browser        │     │
│  │ (apply)    │  │ Store      │  │ Clipboard API  │     │
│  └────────────┘  │ (targets)  │  └────────────────┘     │
│                  └────────────┘                          │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Safety Considerations

1. **Crop/Transform excluded by default** - Prevents accidental crop overwrites
2. **Single-image paste in Edit view** - Grid view for batch paste
3. **Confirmation for multi-paste** - When pasting to >1 photos
4. **Clipboard validation** - Verify data format before paste
5. **Version checking** - Handle schema version mismatches

---

## 9. Open Questions

1. **Persist clipboard across sessions?**
   - Recommendation: No, keep in-memory only for simplicity

2. **Show paste preview?**
   - Recommendation: No for v1, just apply directly

3. **Support paste history?**
   - Recommendation: No for v1, single clipboard only

4. **Selective paste dialog?**
   - Recommendation: Optional for v1, can paste what was copied

---

## Sources

- Adobe Lightroom Classic Help - Copy and paste edit settings
- Lightroom Queen Forums - Copy/paste workflows
- Julieanne Kost's Blog - Batch editing in Lightroom
- Literoom codebase analysis (stores, composables, components)
