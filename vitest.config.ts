import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['core/**/*.test.ts', 'src/**/*.test.ts', 'tests/unit/**/*.test.ts'], testTimeout: 30_000 },
});
