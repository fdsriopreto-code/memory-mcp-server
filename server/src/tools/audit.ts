import { Prisma } from "@prisma/client";
import { prisma } from "../config/database.js";

export async function logAudit(
  projectId: string | null,
  tool: string,
  input: Record<string, unknown>,
  outputSummary?: string,
): Promise<void> {
  await prisma.auditLog.create({
    data: { projectId, tool, input: input as Prisma.InputJsonValue, outputSummary },
  }).catch(() => {});
}
