import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// DB-free unit tests for the guard library (S3). The `@/` alias mirrors
// tsconfig's path mapping so tests import the same modules the app does.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"] },
});
