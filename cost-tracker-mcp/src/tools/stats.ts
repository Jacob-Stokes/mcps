import { z } from "zod";
import type { CostTrackerClient } from "../cost-tracker-client.js";

export const STATS_TOOL = {
  name: "cost_tracker_stats",
  description:
    "Read aggregated LLM agent-run cost + token stats from cost-tracker. " +
    "Use to answer 'how much did agent X cost me this month?', 'what's my daily spend trend?', " +
    "'which model dominates my bill?', 'list the most recent runs for agent X'. Doesn't include " +
    "claude.ai / chatgpt.com subscription utilization — for that use cost_tracker_usage.",
} as const;

export const StatsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("overview").describe("Totals today/week/month + breakdown by agent and model."),
    since: z.string().optional().describe("ISO8601 or 'YYYY-MM-DD' lower bound on run timestamp."),
    until: z.string().optional().describe("ISO8601 or 'YYYY-MM-DD' upper bound."),
    agent: z.string().optional().describe("Filter by agent name."),
    model: z.string().optional().describe("Filter by model name."),
  }),
  z.object({
    action: z.literal("timeseries").describe("Daily aggregate cost + token counts over the last N days."),
    days: z.number().int().min(1).max(365).default(30),
  }),
  z.object({
    action: z.literal("runs").describe("Paginated list of individual runs with optional filters."),
    agent: z.string().optional(),
    model: z.string().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    limit: z.number().int().min(1).max(500).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    action: z.literal("agent").describe("Deep stats for one agent: averages, totals, 30-day trend, recent runs."),
    agent: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(10),
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    action: z.literal("filters").describe("Distinct agent + model values available for filtering."),
  }),
]);

export async function handleStats(client: CostTrackerClient, input: z.infer<typeof StatsInput>) {
  switch (input.action) {
    case "overview":
      return client.stats({ since: input.since, until: input.until, agent: input.agent, model: input.model });
    case "timeseries":
      return client.timeseries(input.days);
    case "runs":
      return client.runs({ agent: input.agent, model: input.model, since: input.since, until: input.until, limit: input.limit, offset: input.offset });
    case "agent":
      return client.agentStats(input.agent, input.limit, input.offset);
    case "filters":
      return client.filters();
  }
}
