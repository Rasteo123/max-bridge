import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@maxbridge/core": fileURLToPath(
        new URL("./packages/core/src/index.ts", import.meta.url)
      ),
      "@maxbridge/max-adapter": fileURLToPath(
        new URL("./packages/max-adapter/src/index.ts", import.meta.url)
      ),
      "@maxbridge/protocol": fileURLToPath(
        new URL("./packages/protocol/src/index.ts", import.meta.url)
      )
    }
  },
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
