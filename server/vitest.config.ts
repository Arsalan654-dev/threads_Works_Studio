import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests talk to a real local MongoDB; a generous timeout keeps
    // slow first-run index creation from being reported as a failure.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
