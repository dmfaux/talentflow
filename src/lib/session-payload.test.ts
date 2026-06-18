import { describe, expect, it } from "vitest";

import type { OrgRole, SessionPayload } from "@/lib/auth";

// Compile-time guard (Finding 2): SessionPayload is finalised to exactly these
// four keys. If a legacy field (client_id / security_group) is ever
// reintroduced at the type level, KeysMatch resolves to `false` and this file
// fails to typecheck under `npm run build`.
type ExpectedPayload = {
  userId: string;
  orgId: string | null;
  orgRole: OrgRole | null;
  isOperator: boolean;
};
type KeysMatch<A, B> = keyof A extends keyof B
  ? keyof B extends keyof A
    ? true
    : false
  : false;
const KEYS_MATCH: KeysMatch<SessionPayload, ExpectedPayload> = true;

describe("SessionPayload is finalised (S13)", () => {
  it("has exactly userId/orgId/orgRole/isOperator and no legacy fields", () => {
    expect(KEYS_MATCH).toBe(true);

    const sample: SessionPayload = {
      userId: "u1",
      orgId: null,
      orgRole: null,
      isOperator: true,
    };
    expect(Object.keys(sample).sort()).toEqual([
      "isOperator",
      "orgId",
      "orgRole",
      "userId",
    ]);
    expect("client_id" in sample).toBe(false);
    expect("security_group" in sample).toBe(false);
  });
});
