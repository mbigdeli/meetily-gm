import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    environmentMatchGlobs: [
      ["src/content/capture/**/*.test.ts", "happy-dom"],
    ],
    include: ["src/**/*.test.ts"],
  },
});
