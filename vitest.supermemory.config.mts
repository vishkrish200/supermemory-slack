import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["test/supermemory.spec.ts"],
    exclude: [
      "test/index.spec.ts",
      "test/slackDatabase.spec.ts",
      "test/slackRateLimit.spec.ts",
    ],
  },
  resolve: {
    alias: {
      "@": "./src",
    },
  },
});
