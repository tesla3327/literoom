<script setup lang="ts">
/**
 * CatalogThumbnail Component
 *
 * Displays a single photo thumbnail in the catalog grid.
 * Handles loading states, selection, and flag badges.
 * Double-click navigates to edit view.
 */
import type { Asset, ThumbnailStatus } from '@literoom/core/catalog'
import { ThumbnailPriority } from '@literoom/core/catalog'

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

// ============================================================================
// Thumbnail Loading
// ============================================================================

const { requestThumbnail, updateThumbnailPriority } = useCatalog()

/**
 * Determine priority based on index.
 * First ~20 items (first visible page) get VISIBLE priority.
 * Items 20-40 get NEAR_VISIBLE priority.
 * Items 40-80 get PRELOAD priority.
 * Beyond that get BACKGROUND priority.
 */
function getPriorityForIndex(index: number): ThumbnailPriority {
  if (index < 20) return ThumbnailPriority.VISIBLE
  if (index < 40) return ThumbnailPriority.NEAR_VISIBLE
  if (index < 80) return ThumbnailPriority.PRELOAD
  return ThumbnailPriority.BACKGROUND
}

// ============================================================================
// Visibility Tracking
// ============================================================================

/**
 * Track visibility with IntersectionObserver to dynamically update priority.
 * When thumbnail enters viewport, boost its priority to VISIBLE.
 * When it leaves viewport, reduce priority to BACKGROUND.
 */
const { elementRef, isVisible } = useIntersectionObserver(
  undefined,
  { threshold: 0.1, rootMargin: '200px' },
)

/**
 * Update priority when visibility changes.
 */
watch(isVisible, (visible) => {
  // Only update priority for thumbnails that aren't ready yet
  if (props.asset.thumbnailStatus !== 'ready') {
    const priority = visible
      ? ThumbnailPriority.VISIBLE
      : ThumbnailPriority.BACKGROUND
    updateThumbnailPriority(props.asset.id, priority)
  }
})

/**
 * Request thumbnail when component mounts if status is pending.
 * Uses ThumbnailPriority enum - first page gets VISIBLE priority.
 */
onMounted(() => {
  if (props.asset.thumbnailStatus === 'pending') {
    requestThumbnail(props.asset.id, getPriorityForIndex(props.index))
  }
})

/**
 * Also watch for asset changes in case the same component
 * is reused for a different asset (virtual scrolling).
 */
watch(() => props.asset.id, (newId, oldId) => {
  if (newId !== oldId && props.asset.thumbnailStatus === 'pending') {
    requestThumbnail(props.asset.id, getPriorityForIndex(props.index))
  }
})

// ============================================================================
// Double-click navigation
// ============================================================================

const router = useRouter()

/**
 * Navigate to edit view on double-click.
 */
function handleDoubleClick() {
  router.push(`/edit/${props.asset.id}`)
}

// Computed classes for the container
const containerClasses = computed(() => {
  const base = 'aspect-square rounded-lg overflow-hidden relative bg-gray-900 cursor-pointer transition-all duration-150 ease-out focus:outline-none'

  if (props.isCurrent) {
    // Current takes priority - blue ring with offset
    return `${base} ring-2 ring-blue-500 ring-offset-2 ring-offset-gray-950`
  }
  if (props.isSelected) {
    // Selected - cyan ring
    return `${base} ring-2 ring-cyan-500`
  }
  return base
})
</script>

<template>
  <div
    ref="elementRef"
    :class="containerClasses"
    data-testid="catalog-thumbnail"
    :data-asset-id="asset.id"
    :data-index="index"
    :data-current="isCurrent"
    :data-flag="asset.flag"
    :tabindex="isCurrent ? 0 : -1"
    role="gridcell"
    :aria-selected="isSelected"
    @click="$emit('click', $event)"
    @dblclick="handleDoubleClick"
  >
    <!-- Flag badge (top-left) -->
    <div
      v-if="asset.flag !== 'none'"
      class="absolute top-1.5 left-1.5 z-10 w-5 h-5 flex items-center justify-center rounded-full bg-gray-950/70"
      data-testid="flag-badge"
      :data-flag="asset.flag"
    >
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
    <div
      v-if="isSelected"
      class="absolute top-1.5 right-1.5 z-10 w-5 h-5 flex items-center justify-center rounded-full bg-cyan-500"
    >
      <UIcon
        name="i-heroicons-check"
        class="w-3 h-3 text-white"
      />
    </div>

    <!-- Thumbnail states -->
    <div
      v-if="asset.thumbnailStatus === 'pending' || asset.thumbnailStatus === 'loading'"
      class="skeleton absolute inset-0 bg-gray-800"
    />
    <div
      v-else-if="asset.thumbnailStatus === 'error'"
      class="absolute inset-0 flex flex-col items-center justify-center bg-gray-800 text-gray-500"
    >
      <UIcon
        name="i-heroicons-exclamation-triangle"
        class="w-8 h-8"
      />
      <span class="text-xs mt-1">Failed</span>
    </div>
    <img
      v-else-if="asset.thumbnailUrl"
      :src="asset.thumbnailUrl"
      :alt="asset.filename"
      class="absolute inset-0 w-full h-full object-cover"
      loading="lazy"
      decoding="async"
    >

    <!-- Filename tooltip on hover (bottom) -->
    <div class="filename-overlay absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-gray-950/80 to-transparent opacity-0 transition-opacity duration-150">
      <span class="text-xs text-gray-200 truncate block">{{ asset.filename }}.{{ asset.extension }}</span>
    </div>
  </div>
</template>

<style scoped>
/* Shimmer animation for loading skeleton - plain CSS, no Tailwind */
.skeleton {
  background: linear-gradient(
    90deg,
    #1f2937 0%,
    #374151 50%,
    #1f2937 100%
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

/* Hover/focus state for filename overlay - plain CSS selectors */
div:hover > .filename-overlay,
div:focus > .filename-overlay {
  opacity: 1;
}
</style>
