import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineNuxtConfig({
  compatibilityDate: '2025-01-20',

  future: {
    compatibilityVersion: 4,
  },

  runtimeConfig: {
    public: {
      demoMode: process.env.LITEROOM_DEMO_MODE === 'true',
    },
  },

  modules: [
    '@nuxt/ui',
    '@nuxt/eslint',
    '@nuxt/test-utils/module',
    '@pinia/nuxt',
  ],

  devtools: { enabled: true },

  css: ['~/assets/css/main.css'],

  vite: {
    plugins: [wasm(), topLevelAwait()],
    worker: {
      plugins: () => [wasm(), topLevelAwait()],
    },
  },

  eslint: {
    config: {
      stylistic: true,
    },
  },

  typescript: {
    strict: true,
    // Disable runtime type checking - CI handles this separately
    // Pre-existing TS errors in packages/core prevent dev server startup with typeCheck enabled
    typeCheck: false,
  },
})
