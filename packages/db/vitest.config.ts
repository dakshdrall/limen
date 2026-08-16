import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The append-only test creates and drops a database role. Two files doing
    // that concurrently would race on the same role name, so this package runs
    // its files in sequence rather than giving the role a random suffix — the
    // suite is small and a deterministic name is what makes a failed run's
    // leftovers findable.
    fileParallelism: false,
  },
});
