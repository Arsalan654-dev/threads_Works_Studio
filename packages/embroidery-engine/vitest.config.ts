import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // Stitch generation tests are CPU-bound geometry; give them room.
    testTimeout: 20000,
  },
});
