import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/**/*.d.ts',
        'src/**/types.ts',
        'src/**/index.ts',
      ],
      // Thresholds set low initially due to browser-only code (catalog-service.ts, decode-service.ts, etc.)
      // that can't be tested in Node.js environment. Increase as coverage improves.
      thresholds: {
        lines: 30,
        functions: 50,
        branches: 50,
        statements: 30,
      },
    },
  },
})
