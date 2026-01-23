import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineNuxtConfig({
  // Disable SSR - this app requires browser APIs (IndexedDB, FileSystem Access, Canvas, etc.)
  ssr: false,

  modules: [
    '@nuxt/ui',
    '@nuxt/eslint',
    '@nuxt/test-utils/module',
    '@pinia/nuxt',
  ],

  components: [
    {
      path: '~/components',
      pathPrefix: false,
    },
  ],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  runtimeConfig: {
    public: {
      demoMode: process.env.LITEROOM_DEMO_MODE === 'true',
    },
  },

  future: {
    compatibilityVersion: 4,
  },
  compatibilityDate: '2025-01-20',

  vite: {
    plugins: [wasm(), topLevelAwait()],
    worker: {
      plugins: () => [wasm(), topLevelAwait()],
    },
  },

  typescript: {
    strict: true,
    // Disable runtime type checking - CI handles this separately
    // Pre-existing TS errors in packages/core prevent dev server startup with typeCheck enabled
    typeCheck: false,
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },
})
