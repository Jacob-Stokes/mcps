import { z } from "zod";
import type { CostTrackerClient } from "../cost-tracker-client.js";

export const USAGE_TOOL = {
  name: "cost_tracker_usage",
  description:
    "Read Claude.ai + ChatGPT (Codex) subscription quota utilization. Cost-tracker polls the " +
    "provider OAuth endpoints every 5 minutes and stores snapshots. Use to answer 'how much of my " +
    "5-hour Claude quota have I used?', 'am I close to the weekly cap?', 'plot my Codex usage " +
    "over the last day'. For per-run LLM API spend use cost_tracker_stats instead.",
} as const;

export const UsageInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("claude_current").describe("Latest Claude subscription snapshot (5h + 7d windows, per-model utilization)."),
    force: z.boolean().optional().describe("Bypass the cache and hit Anthropic live. Use sparingly — rate-limited."),
  }),
  z.object({
    action: z.literal("codex_current").describe("Latest Codex subscription snapshot (primary + secondary + code-review windows, credits)."),
    force: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("claude_history").describe("Historical Claude utilization points over a time window."),
    hours: z.number().int().min(1).max(720).default(24),
  }),
  z.object({
    action: z.literal("codex_history").describe("Historical Codex utilization points."),
    hours: z.number().int().min(1).max(720).default(24),
  }),
]);

export async function handleUsage(client: CostTrackerClient, input: z.infer<typeof UsageInput>) {
  switch (input.action) {
    case "claude_current":
      return client.claudeUsage(input.force ?? false);
    case "codex_current":
      return client.codexUsage(input.force ?? false);
    case "claude_history":
      return { hours: input.hours, points: await client.claudeSnapshots(input.hours) };
    case "codex_history":
      return { hours: input.hours, points: await client.codexSnapshots(input.hours) };
  }
}
