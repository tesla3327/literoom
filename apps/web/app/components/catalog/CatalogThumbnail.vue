<script setup lang="ts">
/**
 * CatalogThumbnail Component
 *
 * Displays a single photo thumbnail in the catalog grid.
 * Handles loading states, selection, and flag badges.
 */
import type { Asset, ThumbnailStatus } from '@literoom/core/catalog'

interface Props {
  /** The asset to display */
  asset: Asset
  /** Whether this thumbnail is in the selection set */
  isSelected: boolean
  /** Whether this is the current (focused) thumbnail */
  isCurrent: boolean
  /** Index in the current display list (for data attribute) */
  index: number
}

const props = defineProps<Props>()

defineEmits<{
  /** Emitted when the thumbnail is clicked */
  click: [event: MouseEvent]
}>()

// Computed classes for the container
const containerClasses = computed(() => [
  'thumbnail-container',
  {
    'is-selected': props.isSelected,
    'is-current': props.isCurrent,
  },
])
</script>

<template>
  <div
    :class="containerClasses"
    :data-asset-id="asset.id"
    :data-index="index"
    :tabindex="isCurrent ? 0 : -1"
    role="gridcell"
    :aria-selected="isSelected"
    @click="$emit('click', $event)"
  >
    <!-- Flag badge (top-left) -->
    <div v-if="asset.flag !== 'none'" class="flag-badge">
      <UIcon
        v-if="asset.flag === 'pick'"
        name="i-heroicons-check-circle-solid"
        class="text-green-500"
      />
      <UIcon
        v-else
        name="i-heroicons-x-circle-solid"
        class="text-red-500"
      />
    </div>

    <!-- Selection indicator (top-right, shown when selected) -->
    <div v-if="isSelected" class="selection-indicator">
      <UIcon name="i-heroicons-check" class="w-3 h-3 text-white" />
    </div>

    <!-- Thumbnail states -->
    <div
      v-if="asset.thumbnailStatus === 'pending' || asset.thumbnailStatus === 'loading'"
      class="skeleton"
    />
    <div v-else-if="asset.thumbnailStatus === 'error'" class="error-state">
      <UIcon name="i-heroicons-exclamation-triangle" class="w-8 h-8" />
      <span class="text-xs mt-1">Failed</span>
    </div>
    <img
      v-else-if="asset.thumbnailUrl"
      :src="asset.thumbnailUrl"
      :alt="asset.filename"
      class="thumbnail-image"
      loading="lazy"
      decoding="async"
    />

    <!-- Filename tooltip on hover (bottom) -->
    <div class="filename-overlay">
      <span class="filename-text">{{ asset.filename }}.{{ asset.extension }}</span>
    </div>
  </div>
</template>

<style scoped>
.thumbnail-container {
  @apply aspect-square rounded-lg overflow-hidden relative;
  @apply bg-gray-900 cursor-pointer;
  @apply transition-all duration-150 ease-out;
  @apply focus:outline-none;
}

/* Current (focused) state - blue ring */
.thumbnail-container.is-current {
  @apply ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-950;
}

/* Selected state - cyan ring (shown alongside current if both) */
.thumbnail-container.is-selected {
  @apply ring-2 ring-cyan-500;
}

/* When both current and selected, use blue (current takes priority for visibility) */
.thumbnail-container.is-current.is-selected {
  @apply ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-950;
}

/* Flag badge positioning */
.flag-badge {
  @apply absolute top-1.5 left-1.5 z-10;
  @apply w-5 h-5 flex items-center justify-center;
  @apply rounded-full bg-gray-950/70;
}

/* Selection indicator positioning */
.selection-indicator {
  @apply absolute top-1.5 right-1.5 z-10;
  @apply w-5 h-5 flex items-center justify-center;
  @apply rounded-full bg-cyan-500;
}

/* Loading skeleton with shimmer animation */
.skeleton {
  @apply absolute inset-0;
  @apply bg-gray-800;
  background: linear-gradient(
    90deg,
    theme('colors.gray.800') 0%,
    theme('colors.gray.700') 50%,
    theme('colors.gray.800') 100%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* Error state styling */
.error-state {
  @apply absolute inset-0;
  @apply flex flex-col items-center justify-center;
  @apply bg-gray-800 text-gray-500;
}

/* Thumbnail image */
.thumbnail-image {
  @apply absolute inset-0 w-full h-full;
  @apply object-cover;
}

/* Filename overlay (shown on hover) */
.filename-overlay {
  @apply absolute bottom-0 left-0 right-0;
  @apply p-1.5 bg-gradient-to-t from-gray-950/80 to-transparent;
  @apply opacity-0 transition-opacity duration-150;
}

.thumbnail-container:hover .filename-overlay,
.thumbnail-container:focus .filename-overlay {
  @apply opacity-100;
}

.filename-text {
  @apply text-xs text-gray-200 truncate block;
}
</style>
