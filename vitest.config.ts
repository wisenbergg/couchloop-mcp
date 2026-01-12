import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '*.config.ts',
        '**/*.test.ts',
        '**/*.spec.ts',
        'tests/setup.ts',
        'src/db/migrate.ts',
        'src/db/seed.ts',
        'src/db/seedOAuth.ts',
      ],
      thresholds: {
        statements: 80,
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
    pool: 'forks',
    testTimeout: 10000,
    hookTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});