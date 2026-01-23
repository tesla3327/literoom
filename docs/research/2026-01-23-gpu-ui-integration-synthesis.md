# GPU UI Integration & Polish - Phase 8 Research Synthesis

**Date**: 2026-01-23
**Phase**: GPU Acceleration Phase 8

## Executive Summary

GPU acceleration infrastructure (Phases 1-7) is fully implemented but almost completely invisible to users. There are no status indicators showing GPU is active/available, no performance metrics displayed, no error messages when GPU fails, no settings UI to control GPU features, and silent WASM fallback when GPU errors occur.

## Current GPU Infrastructure (Fully Built)

### 1. Detection & Initialization (`packages/core/src/gpu/capabilities.ts`)
- WebGPU detection with full adapter info
- Device loss recovery
- Error tracking (max 3 errors before disabling GPU)
- `isAvailable`, `isInitialized`, `hasErrors` properties

### 2. Adaptive Processing (`packages/core/src/gpu/adaptive-processor.ts`)
- Automatic backend selection (GPU vs WASM)
- Per-operation control available but unused by UI
- Performance timing on ALL operations
- Manual enable/disable methods: `setGpuEnabled()`, `setOperationEnabled()`

### 3. Timing Data Available (`packages/core/src/gpu/pipelines/edit-pipeline.ts`)
- 7 separate metrics: upload, rotation, adjustments, toneCurve, masks, readback, total
- Currently computed but never exposed to UI

### 4. Plugin Integration (`apps/web/app/plugins/catalog.client.ts`)
- GPU initialized in background (non-blocking)
- Status logged to console only
- No observable state provided to UI

## Identified Gaps

### Critical (Must Have)
1. **No GPU Status Indicator** - Users don't know if GPU acceleration is active
2. **No Performance Metrics UI** - Timing data exists but is only in console
3. **No Error Messaging** - GPU failures are silent to users

### Medium Priority
4. **No Settings Control** - Can't enable/disable GPU per-operation
5. **No Initialization Feedback** - GPU init happens silently
6. **No Developer Tools** - No way to debug GPU issues

### Minor
7. **No Help Documentation** - No explanation of GPU features
8. **Histogram Processing Opaque** - No indication of GPU vs WASM

## Phase 8 Recommendations

### Tier 1: Essential Features
1. **GPU Status Indicator** - Small icon in header showing GPU state (active/inactive/error)
2. **Error Toast Notification** - Appears on GPU initialization failure
3. **Performance Badge** - Shows render time (e.g., "25ms GPU" or "180ms WASM")

### Tier 2: Important Features
4. **GPU Preferences Panel** - Settings modal with GPU toggle
5. **Device Info Display** - Show GPU name and capabilities
6. **Initialization Feedback** - Brief loading indicator during GPU detection

### Tier 3: Nice-to-Have
7. **Developer Console** - Real-time GPU logging (dev mode only)
8. **Performance Chart** - Visual timing breakdown by operation

## Technical Architecture

### New Pinia Stores

```typescript
// stores/gpuStatus.ts
interface GPUStatusState {
  isAvailable: boolean
  isInitialized: boolean
  hasErrors: boolean
  deviceName: string | null
  lastError: string | null
  lastRenderTiming: EditPipelineTiming | null
  backend: 'webgpu' | 'wasm' | 'unknown'
}

// stores/gpuPreferences.ts (persisted to localStorage)
interface GPUPreferencesState {
  gpuEnabled: boolean
  showPerformanceBadge: boolean
  operationSettings: {
    rotation: boolean
    adjustments: boolean
    toneCurve: boolean
    masks: boolean
    histogram: boolean
  }
}
```

### New Components

```
apps/web/app/components/gpu/
├── GPUStatusIndicator.vue      # Header icon (3 states)
├── GPUErrorNotification.vue    # Toast for GPU errors
├── GPUPerformanceBadge.vue     # Shows render timing
├── GPUPreferencesPanel.vue     # Settings UI
└── GPUDeviceInfo.vue           # Device capabilities modal
```

### Integration Points

1. **Header** (`AppHeader.vue`) - Add GPUStatusIndicator
2. **Edit View** (`edit/[id].vue`) - Add GPUPerformanceBadge
3. **Plugin** (`catalog.client.ts`) - Update gpuStatus store on state changes
4. **useEditPreview** - Expose timing to gpuStatus store

## Implementation Priority

**Phase 8A (This Iteration)**:
- GPUStatusIndicator component
- gpuStatus Pinia store
- Plugin integration to update store

**Phase 8B (Next Iteration)**:
- GPUPerformanceBadge component
- Timing data exposed from useEditPreview

**Phase 8C (Future)**:
- GPUPreferencesPanel
- GPUDeviceInfo modal

## Success Metrics

- Users can see at a glance if GPU is active
- GPU errors result in visible notification
- Performance timing visible during editing
- No breaking changes to existing functionality
