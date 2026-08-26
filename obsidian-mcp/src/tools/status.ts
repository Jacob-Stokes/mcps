import { z } from "zod";
import type { ToolContext } from "../lib/vault.js";

export const StatusInput = z.object({});
export type StatusInput = z.infer<typeof StatusInput>;
export const STATUS_TOOL = {
  name: "obsidian_status",
  description: "Report backend health, vault statistics, path policies, limits and supported remote/desktop capabilities. Use this to discover what this deployment can safely do.",
  inputSchema: StatusInput,
};

export async function handleStatus(ctx: ToolContext) {
  const [health, stats] = await Promise.all([
    ctx.client.get("/api/health"),
    ctx.client.get("/api/stats"),
  ]);
  return {
    service: "obsidian-mcp",
    version: "1.0.0",
    health,
    vault: stats,
    configuration: {
      dailyFolder: ctx.dailyFolder,
      timeZone: ctx.timeZone,
      maxAttachmentBytes: ctx.maxAttachmentBytes,
      policy: ctx.policy.describe(),
    },
    capabilities: {
      remoteVault: true,
      markdownAwareEditing: true,
      frontmatter: true,
      tags: true,
      linksAndBacklinks: true,
      attachments: true,
      bulkOperations: true,
      dryRun: true,
      optimisticConcurrency: true,
      trashByDefault: true,
      desktopCommands: false,
      openInDesktopUi: false,
      workspaceState: false,
    },
  };
}
