// Small helper for writing template_status_log entries. Used by the
// create/clone/transition endpoints. Non-throwing — we'd rather lose
// an audit entry than fail the user-facing operation.

import { db } from "@/db";
import { templateStatusLog } from "@/db/schema";

export async function logTemplateStatusChange(args: {
  templateId: string;
  fromStatus: string | null;
  toStatus: string;
  changedBy: string | null;
}): Promise<void> {
  try {
    await db.insert(templateStatusLog).values({
      template_id: args.templateId,
      from_status: args.fromStatus,
      to_status: args.toStatus,
      changed_by: args.changedBy,
    });
  } catch (err) {
    console.error("[template-log] failed to write audit entry:", err);
  }
}
