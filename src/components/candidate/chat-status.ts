/** Chat message-API statuses that mean this link will never work again:
 *  401 (token revoked), 404 (conversation gone), 410 (org deleted). All three
 *  occur when a candidate opts out and their chat data is purged — the UI shows
 *  a terminal "link no longer active" notice and stops polling. 403
 *  (conversation_closed) and 503 (org suspended) are deliberately excluded:
 *  those are recoverable/handled elsewhere, not a dead link. */
export function isTerminalChatStatus(status: number): boolean {
  return status === 401 || status === 404 || status === 410;
}
