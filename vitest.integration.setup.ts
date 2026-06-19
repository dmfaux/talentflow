// ── Integration-test safety guard ───────────────────────────────────
//
// Every *.itest.ts TRUNCATES ALL TABLES in its beforeAll (cross-org isolation +
// theme fixtures need a clean slate). That is safe ONLY against a throwaway test
// database. This setup runs once, before any test file is collected, so if
// DATABASE_URL points at a database whose name does not look like a dedicated
// test DB we throw HERE — aborting the run before a single beforeAll (and its
// deletes) can execute.
//
//   • DATABASE_URL unset      → no-op (the itests self-skip via describe.skipIf).
//   • DATABASE_URL → "…test…" → allowed.
//   • DATABASE_URL → anything else (e.g. the dev DB "interview_insider") → abort.
//
// This converts the "run the integration tests and lose your dev database"
// landmine into a loud, harmless stop.

const url = process.env.DATABASE_URL;

if (url) {
  let dbName = "";
  try {
    dbName = new URL(url).pathname.replace(/^\//, "").split("?")[0];
  } catch {
    throw new Error(
      "Integration tests: DATABASE_URL is not a parseable URL — refusing to run " +
        "(*.itest.ts truncate all tables and must target a throwaway test DB)."
    );
  }

  if (!/test/i.test(dbName)) {
    throw new Error(
      `Integration tests (*.itest.ts) TRUNCATE ALL TABLES and refuse to run against ` +
        `database "${dbName}". Point DATABASE_URL at a throwaway test database whose ` +
        `name contains "test" (e.g. interview_insider_test):\n\n` +
        `  createdb interview_insider_test\n` +
        `  DATABASE_URL=postgres://…/interview_insider_test npm run db:migrate\n` +
        `  DATABASE_URL=postgres://…/interview_insider_test npm run test:integration\n`
    );
  }
}
