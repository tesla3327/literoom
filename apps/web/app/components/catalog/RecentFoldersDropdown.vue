<script setup lang="ts">
/**
 * RecentFoldersDropdown Component
 *
 * Displays the current folder with a dropdown to switch between recent folders
 * or select a new folder. Shows folder accessibility status and loading states.
 */
import { formatRelativeTime } from '~/utils/formatRelativeTime'

interface DropdownItem {
  label: string
  icon: string
  disabled?: boolean
  suffix?: string
  suffixClass?: string
  click?: () => void
  iconClass?: string
  class?: string
}

const catalogStore = useCatalogStore()
const {
  recentFolders,
  isLoadingFolders,
  isLoadingFolderId,
  hasRecentFolders,
  loadRecentFolders,
  openRecentFolder,
  openNewFolder,
  isDemoMode,
} = useRecentFolders()

const emit = defineEmits<{
  folderChanged: []
}>()

// Computed: current folder name
const folderName = computed(() => {
  const path = catalogStore.folderPath
  if (!path) return 'Select Folder'
  return path.split('/').pop() || path
})

// Load recent folders when dropdown opens
const isDropdownOpen = ref(false)

watch(isDropdownOpen, async (open) => {
  if (open && !isDemoMode) {
    await loadRecentFolders()
  }
})

// Handle selecting a recent folder
async function handleSelectRecent(folderId: number) {
  const folder = recentFolders.value.find(f => f.id === folderId)
  if (!folder) return

  const success = await openRecentFolder(folder)
  if (success) {
    isDropdownOpen.value = false
    emit('folderChanged')
  }
}

// Handle selecting a new folder
async function handleSelectNew() {
  const success = await openNewFolder()
  if (success) {
    isDropdownOpen.value = false
    emit('folderChanged')
  }
}

// Build dropdown items from recent folders
const dropdownItems = computed(() => {
  const items: DropdownItem[][] = []

  // Recent folders section
  if (hasRecentFolders.value) {
    const folderItems = recentFolders.value.map(folder => ({
      label: folder.name,
      icon: folder.isAccessible ? 'i-heroicons-folder' : 'i-heroicons-lock-closed',
      disabled: isLoadingFolderId.value === folder.id,
      suffix: formatRelativeTime(folder.lastScanDate),
      suffixClass: 'text-xs text-gray-500',
      click: () => folder.isAccessible && handleSelectRecent(folder.id),
      // Show loading spinner when this folder is loading
      ...(isLoadingFolderId.value === folder.id && {
        icon: 'i-heroicons-arrow-path',
        iconClass: 'animate-spin',
      }),
      // Gray out if not accessible
      ...((!folder.isAccessible) && {
        class: 'opacity-50',
      }),
    }))
    items.push(folderItems)
  }

  // "Choose New Folder" action
  items.push([
    {
      label: 'Choose New Folder...',
      icon: 'i-heroicons-plus',
      click: handleSelectNew,
    },
  ])

  return items
})
</script>

<template>
  <UDropdownMenu
    v-model:open="isDropdownOpen"
    :items="dropdownItems"
    :popper="{ placement: 'bottom-start' }"
  >
    <UButton
      variant="ghost"
      size="sm"
      :loading="isLoadingFolders"
      :trailing-icon="hasRecentFolders || !isDemoMode ? 'i-heroicons-chevron-down' : undefined"
      data-testid="folder-dropdown-trigger"
    >
      <template #leading>
        <UIcon
          name="i-heroicons-folder"
          class="w-4 h-4"
        />
      </template>
      {{ folderName }}
    </UButton>
  </UDropdownMenu>
</template>
