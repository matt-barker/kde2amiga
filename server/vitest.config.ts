import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Vitest 4's defaultExclude no longer excludes **/dist/**, so once `npm run build` or
    // `npm start` has created server/dist, `npm test` would otherwise pick up stale compiled
    // copies of the tests alongside the source ones. Exclude compiled output explicitly.
    exclude: ['**/node_modules/**', '**/.git/**', '**/dist/**'],
  },
});
