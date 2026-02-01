<script setup lang="ts">
useHead({
  title: 'Literoom',
  meta: [
    { name: 'description', content: 'A desktop, offline-first photo culling and editing web app' },
  ],
})
</script>

<template>
  <UApp>
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
