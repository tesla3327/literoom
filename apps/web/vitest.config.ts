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
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'app/**/*.{ts,vue}',
        'composables/**/*.{ts,vue}',
        'stores/**/*.{ts,vue}',
        'plugins/**/*.{ts,vue}',
        'utils/**/*.{ts,vue}',
      ],
      exclude: [
        'test/**',
        'e2e/**',
        '**/*.d.ts',
        'app/app.vue',
        'app/error.vue',
      ],
      // Thresholds set low initially due to Vue components that are harder to unit test.
      // Most coverage will come from testing stores, composables, and utilities.
      // Increase thresholds as coverage improves.
      thresholds: {
        lines: 20,
        functions: 50,
        branches: 50,
        statements: 20,
      },
    },
  },
})
