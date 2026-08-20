import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Boots a real server for the tests under tests/http.
    globalSetup: ['tests/http/server.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // The suite shares one Postgres database, so files must not race.
    fileParallelism: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Domain tests run outside a Next request scope.
      'next/headers': path.resolve(__dirname, 'tests/stubs/next-headers.ts'),
    },
  },
});
