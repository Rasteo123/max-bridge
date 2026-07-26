import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    clearMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"]
    },
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.worktrees/**"
    ],
    include: [
      "apps/**/*.test.{ts,tsx}",
      "packages/**/*.test.{ts,tsx}",
      "tests/**/*.test.{ts,tsx}"
    ]
  }
});
