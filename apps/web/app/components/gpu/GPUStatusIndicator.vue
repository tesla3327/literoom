<script setup lang="ts">
/**
 * GPUStatusIndicator Component
 *
 * Displays GPU acceleration status as a small icon button with tooltip.
 * Shows whether WebGPU is active, unavailable (falling back to WASM),
 * or if there are errors.
 */
import { useGpuStatusStore } from '~/stores/gpuStatus'

const gpuStatus = useGpuStatusStore()
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
