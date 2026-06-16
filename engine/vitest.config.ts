import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    // Seed Math.random per test file so unseeded games are reproducible (kills
    // the shuffle-dependent flake class). See src/__tests__/vitest.setup.ts.
    setupFiles: ['./src/__tests__/vitest.setup.ts'],
  },
});
