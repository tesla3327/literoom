<script setup lang="ts">
/**
 * GPUPerformanceBadge Component
 *
 * Displays FPS (rolling average) and backend info in the edit view.
 * Shows the average FPS over recent renders and whether GPU or WASM backend is being used.
 */
import { useGpuStatusStore } from '~/stores/gpuStatus'

const gpuStatus = useGpuStatusStore()

/**
 * Display rolling average FPS from the store.
 * Returns "-- FPS" if no timing data is available yet.
 */
const displayFps = computed(() => {
  const fps = gpuStatus.rollingAverageFps
  if (fps === null) return '-- FPS'
  return `${Math.round(fps)} FPS`
})

/**
 * Show "GPU" if webgpu backend, "WASM" if wasm backend.
 */
const displayBackend = computed(() => {
  return gpuStatus.backend === 'webgpu' ? 'GPU' : 'WASM'
})

/**
 * Badge color based on backend type.
 * Green/success for GPU (fast), neutral for WASM (fallback).
 */
const badgeColor = computed(() => {
  return gpuStatus.backend === 'webgpu' ? 'success' : 'neutral'
})
</script>

<template>
  <UBadge
    v-if="gpuStatus.isInitialized"
    :color="badgeColor"
    variant="subtle"
    size="xs"
  >
    {{ displayFps }} {{ displayBackend }}
  </UBadge>
</template>
