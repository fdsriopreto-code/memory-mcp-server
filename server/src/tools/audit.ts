import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";
import { broadcast } from "../ws.js";

export async function logAudit(
  projectId: string | null,
  tool: string,
  input: Record<string, unknown>,
  outputSummary?: string,
): Promise<void> {
  try {
    const log = await prisma.auditLog.create({
      data: { projectId, tool, input: input as Prisma.InputJsonValue, outputSummary },
      include: { project: { select: { name: true, slug: true, color: true } } },
    });
    broadcast("audit_log", log);
  } catch {
    // silently ignore
  }
}
