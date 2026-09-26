import { defineConfig } from 'vitest/config';

// Only the TypeScript sources: `npm run build` writes compiled copies of every test into dist/,
// which vitest would otherwise run a second time.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], exclude: ['dist/**', 'node_modules/**'] },
});
