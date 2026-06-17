import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// DB-backed write-denial / cross-org isolation tests (S4 + S5 share this).
// Gated on DATABASE_URL: when it is unset the *.itest.ts files self-skip
// (describe.skipIf), so `npm run test:integration` is a clean no-op rather than
// a failure, and the default `npm test` (vitest.config.ts) stays DB-free.
//
// Run against a throwaway database, e.g.:
//   DATABASE_URL=postgres://… npm run db:migrate
//   DATABASE_URL=postgres://… npm run test:integration
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["src/**/*.itest.ts"],
    // One shared two-org fixture mutated by the route handlers — run serially.
    fileParallelism: false,
    sequence: { concurrent: false },
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
