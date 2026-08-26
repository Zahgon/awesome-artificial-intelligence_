import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      // scripts/ only, so the figure lines up with `coverage report` over
      // scripts/*.py on the Python side. The generated Unicode table carries no
      // logic and would otherwise dominate the denominator.
      include: ['scripts/**/*.ts'],
      exclude: ['scripts/internal/casedata.ts'],
      reporter: ['text'],
    },
  },
});
