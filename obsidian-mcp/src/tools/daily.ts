import { z } from "zod";
import type { ObsidianClient } from "../obsidian-client.js";

// Daily notes get their own tool because:
// 1. The date-based lookup is a common enough agent pattern to deserve a primitive
// 2. Appending to a daily note (standup entry, quick note) has different
//    semantics than writing a new file (no overwrite, timestamped sections)
// 3. Journal/ is typically not-safe-to-write-to for agents EXCEPT via append

const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD (user's local timezone)");

export const DailyInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("get"),
    date: DateString,
  }),
  z.object({
    action: z.literal("latest"),
    limit: z.number().int().positive().max(30).default(1).describe("Return N most recent daily notes."),
  }),
  z.object({
    action: z.literal("append"),
    date: DateString.optional().describe("Defaults to today if omitted"),
    content: z.string().min(1).describe("Markdown to append. Prepended with a blank line if the file already has content."),
  }),
]);

export type DailyInput = z.infer<typeof DailyInput>;

export const DAILY_TOOL = {
  name: "obsidian_daily",
  description:
    "Work with Jacob's daily journal entries (Journal/YYYY-MM-DD.md). " +
    "get: fetch a specific date. latest: fetch the N most recent entries. " +
    "append: add content to a daily note (preferred over full file write — respects " +
    "existing content; creates file if it doesn't exist). Use for standup-style entries, " +
    "quick captures during the day, or agent-written notes on a specific date.",
  inputSchema: DailyInput,
};

export async function handleDaily(client: ObsidianClient, input: DailyInput): Promise<any> {
  switch (input.action) {
    case "get": {
      const res = await client.get(`/api/daily/${input.date}`);
      return { date: input.date, content: res?.content ?? res };
    }

    case "latest": {
      // Derive from folder listing — sort by name descending (YYYY-MM-DD sorts lexically).
      const folderRes = await client.get(`/api/folders/Journal`);
      const children = Array.isArray(folderRes?.children) ? folderRes.children : [];
      const dated = children
        .filter((c: any) => /^\d{4}-\d{2}-\d{2}\.md$/.test(c.name))
        .sort((a: any, b: any) => b.name.localeCompare(a.name))
        .slice(0, input.limit);
      return {
        count: dated.length,
        entries: dated.map((c: any) => ({
          date: c.name.replace(/\.md$/, ""),
          name: c.name,
          modified: c.modified,
          size: c.size,
        })),
      };
    }

    case "append": {
      const res = await client.post(`/api/daily/append`, {
        date: input.date,
        content: input.content,
      });
      return {
        date: input.date ?? new Date().toISOString().slice(0, 10),
        appended: input.content.length,
        ...res,
      };
    }
  }
}
