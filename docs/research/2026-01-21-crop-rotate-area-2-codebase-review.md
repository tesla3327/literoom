# Crop/Rotate/Straighten: Codebase Review

**Date**: 2026-01-21
**Status**: Complete
**Scope**: Area 2 - Existing codebase patterns for integration

---

## 1. Edit State Structure

### Current Location
`packages/core/src/catalog/types.ts`

### Current EditState

```typescript
export interface EditState {
  version: typeof EDIT_SCHEMA_VERSION  // Currently 2
  adjustments: Adjustments
  // Future: toneCurve, crop, masks
}
```

### Integration Point

Comments already document future `crop?: CropTransform` field. Follows versioned schema pattern.

---

## 2. Edit Store Architecture

### Location
`apps/web/app/stores/edit.ts`

### Pattern Analysis

```typescript
export const useEditStore = defineStore('edit', () => {
  // State refs
  const currentAssetId = ref<string | null>(null)
  const adjustments = ref<Adjustments>({ ...DEFAULT_ADJUSTMENTS })
  const isDirty = ref(false)

  // Actions
  function setAdjustment(key, value): void { /* mark dirty */ }
  function setToneCurve(curve): void { /* mark dirty */ }
  function reset(): void { /* reset all */ }
})
```

### Crop Integration Pattern

Follow tone curve's pattern:
1. Add `cropTransform` ref
2. Add `setCropTransform()`, `setCrop()`, `setRotation()` actions
3. Update `hasModifications` computed
4. Update `reset()` to reset transforms

---

## 3. WASM Worker Patterns

### Location
`packages/core/src/decode/decode-worker.ts`

### Message Handling Pattern

```typescript
self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const { id, type } = event.data

  switch (type) {
    case 'apply-adjustments': {
      // Create WASM wrapper, apply, return pixels
    }
    case 'apply-tone-curve': {
      // Create LUT, apply, return pixels
    }
  }
}
```

### New Message Types Needed

```typescript
case 'apply-crop-rotate': {
  // Order: rotate -> crop
  // Return new dimensions + pixels
}
```

---

## 4. Preview Pipeline

### Location
`apps/web/app/composables/useEditPreview.ts`

### Current Flow

```typescript
async function renderPreview(): Promise<void> {
  // 1. Apply basic adjustments
  // 2. Apply tone curve (if modified)
  // 3. Convert to blob URL
}
```

### Integration Point

Add crop/rotate step FIRST (before adjustments):
1. Apply rotation
2. Apply crop
3. Apply adjustments
4. Apply tone curve
5. Display

---

## 5. UI Panel Patterns

### Location
`apps/web/app/components/edit/EditControlsPanel.vue`

### Structure

```vue
<UAccordion type="multiple">
  <template #basic-body>
    <EditAdjustmentSlider v-for="adj in config" />
  </template>

  <template #tonecurve-body>
    <EditToneCurveEditor />
  </template>

  <template #crop-body>
    <!-- Placeholder for crop/transform -->
  </template>
</UAccordion>
```

### Slider Pattern

```vue
<div class="flex items-center gap-3 py-1.5">
  <span class="w-24">{{ label }}</span>
  <USlider :model-value="value" @update:model-value="emit" />
  <span class="w-14 text-right font-mono">{{ displayValue }}</span>
</div>
```

---

## 6. Key Design Patterns

### Versioned Schema
```typescript
export const EDIT_SCHEMA_VERSION = 2  // Will become 3
```

### Modification Detection
```typescript
export function isModifiedTransform(transform: CropTransform): boolean {
  return transform.crop !== null ||
         transform.rotation.angle !== 0 ||
         transform.rotation.straighten !== 0
}
```

### Default Values with Object.freeze
```typescript
export const DEFAULT_CROP_TRANSFORM = Object.freeze({
  crop: null,
  rotation: { angle: 0, straighten: 0 }
})
```

### Dirty Flag Pattern
All setters mark `isDirty.value = true`

---

## 7. Recommendations

### Implementation Order
1. Types in `catalog/types.ts`
2. Store state in `edit.ts`
3. Worker messages in `worker-messages.ts`
4. Worker handler in `decode-worker.ts`
5. Service methods in `decode-service.ts`
6. Preview integration in `useEditPreview.ts`
7. UI components

### Files to Modify
- `packages/core/src/catalog/types.ts` - Add types, bump version
- `apps/web/app/stores/edit.ts` - Add state + actions
- `packages/core/src/decode/worker-messages.ts` - Add message types
- `packages/core/src/decode/decode-worker.ts` - Add handler
- `packages/core/src/decode/decode-service.ts` - Add methods
- `apps/web/app/composables/useEditPreview.ts` - Add transform step
