<script setup lang="ts">
const isLoading = ref(false)

async function selectFolder() {
  isLoading.value = true
  // TODO: Implement folder selection with File System Access API
  await new Promise(resolve => setTimeout(resolve, 500))
  isLoading.value = false
}
</script>

<template>
  <div class="flex flex-col items-center justify-center min-h-screen p-8">
    <div class="max-w-md text-center space-y-8">
      <h1 class="text-4xl font-bold">
        Literoom
      </h1>

      <p class="text-gray-400 text-lg">
        A desktop, offline-first photo culling and editing app.
        Your photos stay local, your edits persist.
      </p>

      <div class="space-y-4">
        <UButton
          size="xl"
          :loading="isLoading"
          @click="selectFolder"
        >
          Choose Folder
        </UButton>

        <p class="text-sm text-gray-500">
          Best experienced in Chrome, Edge, or Brave with File System Access API support.
        </p>
      </div>
    </div>
  </div>
</template>
