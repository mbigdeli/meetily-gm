import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: "./",
  root: ".",
  publicDir: false,
  build: {
    outDir: "dist",
    emptyOutDir: false,
    modulePreload: { polyfill: false },
    rollupOptions: {
      input: path.resolve(__dirname, "src/content/capture/index.ts"),
      output: {
        entryFileNames: "captureContent.js",
        format: "iife",
        inlineDynamicImports: true,
      },
    },
    target: "esnext",
    minify: false,
  },
});
