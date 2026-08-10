import { z } from "zod";
import type { ThesysClient } from "../thesys-client.js";

export const HabitsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    include_archived: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("log"),
    id: z.string().describe("Habit id, e.g. hab_XXXX"),
  }),
  z.object({
    action: z.literal("bulk_log"),
    ids: z.array(z.string()).min(1).max(20),
  }),
]);

export type HabitsInput = z.infer<typeof HabitsInput>;

export const HABITS_TOOL = {
  name: "thesys_habits",
  description:
    "Manage Jacob's habits. Action=list returns habits with rolled-up stats (loggedToday, totalLogs). " +
    "Action=log records a completion for today. bulk_log logs N habits in one call.",
  inputSchema: HabitsInput,
};

export async function handleHabits(client: ThesysClient, input: HabitsInput): Promise<any> {
  switch (input.action) {
    case "list": {
      const habits = await client.get(`/habits`);
      const list = Array.isArray(habits) ? habits : [];
      const filtered = input.include_archived ? list : list.filter((h: any) => !h.archived);
      return {
        count: filtered.length,
        habits: filtered.map((h: any) => ({
          id: h.id,
          title: h.title,
          emoji: h.emoji,
          frequency: h.frequency,
          loggedToday: h.stats?.loggedToday,
          totalLogs: h.stats?.totalLogs,
        })),
      };
    }

    case "log":
      await client.post(`/habits/${encodeURIComponent(input.id)}/logs`, {});
      return { logged: input.id };

    case "bulk_log": {
      const results = await Promise.all(
        input.ids.map(async (id) => {
          try {
            await client.post(`/habits/${encodeURIComponent(id)}/logs`, {});
            return { ok: true, id };
          } catch (e: any) {
            return { ok: false, id, error: e.message };
          }
        }),
      );
      return {
        total: results.length,
        logged: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }
  }
}
