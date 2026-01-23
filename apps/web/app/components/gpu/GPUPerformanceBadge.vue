<script setup lang="ts">
/**
 * GPUPerformanceBadge Component
 *
 * Displays render timing and backend info in the edit view.
 * Shows the total render time and whether GPU or WASM backend is being used.
 */
import { useGpuStatusStore } from '~/stores/gpuStatus'

const gpuStatus = useGpuStatusStore()

/**
 * Format totalRenderTime as "Xms" (rounded to integer).
 * Returns null if no timing data is available.
 */
const displayTime = computed(() => {
  const time = gpuStatus.totalRenderTime
  if (time === null) return null
  return `${Math.round(time)}ms`
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
    v-if="displayTime"
    :color="badgeColor"
    variant="subtle"
    size="xs"
  >
    {{ displayTime }} {{ displayBackend }}
  </UBadge>
</template>
