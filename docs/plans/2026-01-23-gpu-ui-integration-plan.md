# GPU UI Integration Implementation Plan - Phase 8

**Date**: 2026-01-23
**Based on**: `docs/research/2026-01-23-gpu-ui-integration-synthesis.md`
**Phase**: GPU Acceleration Phase 8

## Overview

Add user-facing UI for GPU acceleration status, performance monitoring, and preferences. Currently GPU is invisible to users - they don't know if it's active, what performance gains they're getting, or if errors occur.

## Goals

1. Show GPU status indicator in header
2. Display render performance badge in edit view
3. Notify users of GPU errors
4. Provide GPU preferences in settings

## Implementation Phases

### Phase 8.1: GPU Status Store

**Create**: `apps/web/app/stores/gpuStatus.ts`

```typescript
import { defineStore } from 'pinia'
import type { EditPipelineTiming } from '@literoom/core/gpu'

export interface GPUStatusState {
  isAvailable: boolean
  isInitialized: boolean
  hasErrors: boolean
  deviceName: string | null
  lastError: string | null
  lastRenderTiming: EditPipelineTiming | null
  backend: 'webgpu' | 'wasm' | 'unknown'
}

export const useGPUStatusStore = defineStore('gpuStatus', {
  state: (): GPUStatusState => ({
    isAvailable: false,
    isInitialized: false,
    hasErrors: false,
    deviceName: null,
    lastError: null,
    lastRenderTiming: null,
    backend: 'unknown',
  }),

  getters: {
    statusIcon: (state) => {
      if (state.hasErrors) return 'i-heroicons-exclamation-triangle'
      if (state.isAvailable) return 'i-heroicons-bolt'
      return 'i-heroicons-bolt-slash'
    },
    statusColor: (state) => {
      if (state.hasErrors) return 'amber'
      if (state.isAvailable) return 'green'
      return 'gray'
    },
    statusText: (state) => {
      if (state.hasErrors) return `GPU Error: ${state.lastError}`
      if (state.isAvailable) return `GPU Active: ${state.deviceName || 'WebGPU'}`
      return 'GPU Unavailable (using WASM)'
    },
    totalRenderTime: (state) => state.lastRenderTiming?.total ?? null,
  },

  actions: {
    setAvailable(available: boolean, deviceName?: string) {
      this.isAvailable = available
      this.isInitialized = true
      this.deviceName = deviceName ?? null
      this.backend = available ? 'webgpu' : 'wasm'
    },
    setError(error: string) {
      this.hasErrors = true
      this.lastError = error
    },
    clearError() {
      this.hasErrors = false
      this.lastError = null
    },
    setRenderTiming(timing: EditPipelineTiming) {
      this.lastRenderTiming = timing
    },
  },
})
```

### Phase 8.2: GPU Status Indicator Component

**Create**: `apps/web/app/components/gpu/GPUStatusIndicator.vue`

```vue
<script setup lang="ts">
import { useGPUStatusStore } from '~/stores/gpuStatus'

const gpuStatus = useGPUStatusStore()
</script>

<template>
  <UTooltip :text="gpuStatus.statusText">
    <UButton
      :icon="gpuStatus.statusIcon"
      :color="gpuStatus.statusColor"
      variant="ghost"
      size="sm"
      :aria-label="gpuStatus.statusText"
    />
  </UTooltip>
</template>
```

### Phase 8.3: Plugin Integration

**Modify**: `apps/web/app/plugins/catalog.client.ts`

Add GPU status store updates:

```typescript
import { useGPUStatusStore } from '~/stores/gpuStatus'

// After GPU initialization:
const gpuStatus = useGPUStatusStore()
const gpuService = getGPUCapabilityService()

if (gpuService.isAvailable) {
  const adapter = gpuService.adapter
  const deviceName = adapter?.info?.device || 'WebGPU Device'
  gpuStatus.setAvailable(true, deviceName)
} else {
  gpuStatus.setAvailable(false)
}

// On GPU error (add to error handler):
gpuStatus.setError(errorMessage)
```

### Phase 8.4: Header Integration

**Modify**: `apps/web/app/components/AppHeader.vue`

Add GPU status indicator to header:

```vue
<template>
  <!-- In header actions area -->
  <GPUStatusIndicator />
</template>
```

### Phase 8.5: Performance Badge Component

**Create**: `apps/web/app/components/gpu/GPUPerformanceBadge.vue`

```vue
<script setup lang="ts">
import { useGPUStatusStore } from '~/stores/gpuStatus'

const gpuStatus = useGPUStatusStore()

const displayTime = computed(() => {
  const time = gpuStatus.totalRenderTime
  if (time === null) return null
  return `${time.toFixed(0)}ms`
})

const displayBackend = computed(() => {
  return gpuStatus.backend === 'webgpu' ? 'GPU' : 'WASM'
})
</script>

<template>
  <UBadge
    v-if="displayTime"
    :color="gpuStatus.backend === 'webgpu' ? 'green' : 'gray'"
    variant="subtle"
    size="xs"
  >
    {{ displayTime }} {{ displayBackend }}
  </UBadge>
</template>
```

### Phase 8.6: Expose Timing from useEditPreview

**Modify**: `apps/web/app/composables/useEditPreview.ts`

Emit timing data to store:

```typescript
import { useGPUStatusStore } from '~/stores/gpuStatus'

// After successful GPU pipeline render:
const gpuStatus = useGPUStatusStore()
gpuStatus.setRenderTiming(result.timing)
```

### Phase 8.7: Edit View Integration

**Modify**: `apps/web/app/pages/edit/[id].vue`

Add performance badge near histogram or preview:

```vue
<template>
  <!-- Near histogram panel -->
  <GPUPerformanceBadge />
</template>
```

## Files to Create

1. `apps/web/app/stores/gpuStatus.ts`
2. `apps/web/app/components/gpu/GPUStatusIndicator.vue`
3. `apps/web/app/components/gpu/GPUPerformanceBadge.vue`

## Files to Modify

1. `apps/web/app/plugins/catalog.client.ts` - Update GPU status store
2. `apps/web/app/components/AppHeader.vue` - Add status indicator
3. `apps/web/app/composables/useEditPreview.ts` - Expose timing data
4. `apps/web/app/pages/edit/[id].vue` - Add performance badge

## Testing Strategy

1. **Unit Tests**: Test gpuStatus store actions and getters
2. **Component Tests**: Test GPUStatusIndicator renders correct states
3. **Integration**: Verify status updates during app initialization
4. **E2E**: Verify indicator visible in header

## Implementation Order

1. Phase 8.1: Create gpuStatus store (foundation)
2. Phase 8.2: Create GPUStatusIndicator component
3. Phase 8.3: Wire plugin to update store
4. Phase 8.4: Add indicator to header
5. Phase 8.5: Create GPUPerformanceBadge
6. Phase 8.6: Expose timing from useEditPreview
7. Phase 8.7: Add badge to edit view

## Acceptance Criteria

- [ ] GPU status indicator visible in header
- [ ] Indicator shows correct state (active/inactive/error)
- [ ] Tooltip shows device name when available
- [ ] Performance badge shows render time in edit view
- [ ] Badge shows backend (GPU/WASM)
- [ ] All existing tests pass
