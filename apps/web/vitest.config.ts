import { defineVitestConfig } from '@nuxt/test-utils/config'

export default defineVitestConfig({
  test: {
    environment: 'nuxt',
    environmentOptions: {
      nuxt: {
        domEnvironment: 'happy-dom',
        overrides: {
          runtimeConfig: {
            public: {
              demoMode: true,
            },
          },
        },
      },
    },
    include: ['test/**/*.{test,spec}.{js,ts}'],
  },
})
