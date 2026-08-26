import { z } from "zod";
import { encodeVaultPath } from "../obsidian-client.js";
import { readNoteIfExists, writeNoteContent, type ToolContext } from "../lib/vault.js";

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");

export const DailyInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get"), date: DateString.optional().describe("Defaults to today in the configured vault timezone.") }),
  z.object({ action: z.literal("latest"), limit: z.number().int().positive().max(100).default(5) }),
  z.object({
    action: z.literal("append"),
    date: DateString.optional().describe("Defaults to today in the configured vault timezone."),
    content: z.string().min(1),
    expected_hash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    dry_run: z.boolean().default(false),
  }),
]);
export type DailyInput = z.infer<typeof DailyInput>;
export const DAILY_TOOL = {
  name: "obsidian_daily",
  description: "Read, list or append daily notes in the configured daily-note folder. The requested date is honored and 'today' uses the configured vault timezone. Append creates a dated note when missing and supports expected_hash/dry_run.",
  inputSchema: DailyInput,
};

export async function handleDaily(ctx: ToolContext, input: DailyInput) {
  if (input.action === "latest") {
    const folder = ctx.policy.assertRead(ctx.dailyFolder);
    const result = await ctx.client.get(`/api/folders/${encodeVaultPath(folder)}`);
    const entries = (Array.isArray(result?.children) ? result.children : [])
      .filter((item: any) => item.type !== "dir" && /^\d{4}-\d{2}-\d{2}\.md$/.test(item.name))
      .sort((a: any, b: any) => b.name.localeCompare(a.name))
      .slice(0, input.limit)
      .map((item: any) => ({
        date: item.name.replace(/\.md$/, ""),
        path: `${folder}/${item.name}`,
        size: item.size,
        modified: item.modified,
      }));
    return { folder, count: entries.length, entries };
  }

  const date = input.date ?? todayInTimeZone(ctx.timeZone);
  const notePath = `${ctx.dailyFolder}/${date}.md`;
  const existing = await readNoteIfExists(ctx, notePath);
  if (input.action === "get") {
    if (!existing) throw new Error(`daily note does not exist: ${notePath}`);
    return { date, ...existing };
  }

  const addition = input.content.replace(/^\n+|\n+$/g, "");
  const updated = existing
    ? `${existing.content.replace(/\s*$/, "")}\n\n${addition}\n`
    : `# ${date}\n\n${addition}\n`;
  const result = await writeNoteContent(ctx, notePath, updated, {
    overwrite: true,
    expectedHash: input.expected_hash,
    dryRun: input.dry_run,
    existing,
  });
  return { date, ...result };
}

function todayInTimeZone(timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
