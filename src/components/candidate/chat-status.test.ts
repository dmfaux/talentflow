import { describe, expect, it } from "vitest";
import { isTerminalChatStatus } from "./chat-status";

describe("isTerminalChatStatus", () => {
  it("treats revoked-token / gone-conversation statuses as terminal", () => {
    // The opt-out purge nulls the chat token (401) and deletes the
    // conversation (404); a deleted org is 410.
    expect(isTerminalChatStatus(401)).toBe(true);
    expect(isTerminalChatStatus(404)).toBe(true);
    expect(isTerminalChatStatus(410)).toBe(true);
  });

  it("does not treat success or recoverable statuses as terminal", () => {
    expect(isTerminalChatStatus(200)).toBe(false);
    expect(isTerminalChatStatus(403)).toBe(false); // conversation_closed — handled separately
    expect(isTerminalChatStatus(503)).toBe(false); // org suspended — transient
  });
});
