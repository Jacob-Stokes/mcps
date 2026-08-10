import { z } from "zod";
import type { MonicaClient } from "../monica-client.js";
import { runBounded } from "../monica-client.js";

// Monica activities = interactions with contacts (calls, meetings,
// lunches, etc.) Each activity ties to 1+ contacts and has an
// activity_type_id. Monica ships with ~30 default types; we look them
// up dynamically the first time we create so the agent doesn't need to
// know the enum.

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ACTIVITIES_TOOL = {
  name: "monica_activities",
  description: [
    "Log + browse interactions with contacts. Actions:",
    "• list — paginated activities in reverse-chronological order. Optional contact_id to filter to one person.",
    "• list_types — every activity_type (id + name) available in Monica; pick one for `create`.",
    "• get — full activity by ID.",
    "• create — log an interaction. Required: summary, happened_at (YYYY-MM-DD), contact_ids[]. Optional: activity_type_id, description, duration_in_minutes.",
    "• bulk_create — log many interactions in one call (up to 30).",
    "• delete — remove by ID.",
    "Typical use: 'called mum today' → create with summary, happened_at=today, contact_ids=[mum's id].",
  ].join(" "),
} as const;

const ActivitySpec = z.object({
  summary: z.string().min(1),
  happened_at: DateString,
  contact_ids: z.array(z.number().int()).min(1),
  activity_type_id: z.number().int().optional().describe("Default: first type (usually 'just hung out'). Use list_types to discover."),
  description: z.string().optional(),
  duration_in_minutes: z.number().int().min(0).optional(),
});

export const ActivitiesInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    contact_id: z.number().int().optional(),
    limit: z.number().int().min(1).max(100).default(25),
    page: z.number().int().min(1).default(1),
  }),
  z.object({ action: z.literal("list_types") }),
  z.object({
    action: z.literal("get"),
    id: z.number().int(),
  }),
  z.object({
    action: z.literal("create"),
    summary: z.string().min(1),
    happened_at: DateString,
    contact_ids: z.array(z.number().int()).min(1),
    activity_type_id: z.number().int().optional(),
    description: z.string().optional(),
    duration_in_minutes: z.number().int().min(0).optional(),
  }),
  z.object({
    action: z.literal("bulk_create"),
    activities: z.array(ActivitySpec).min(1).max(30),
  }),
  z.object({
    action: z.literal("delete"),
    id: z.number().int(),
  }),
]);

// Cached activity_type_id for the default ("just hung out") — first
// lookup populates, subsequent creates skip the call.
let defaultActivityType: number | null = null;
async function resolveDefaultType(client: MonicaClient): Promise<number> {
  if (defaultActivityType !== null) return defaultActivityType;
  const types = await client.get(`/api/activitytypes`);
  const first = types?.data?.[0]?.id;
  if (typeof first !== "number") throw new Error("monica: no activity types configured");
  defaultActivityType = first;
  return first;
}

export async function handleActivities(client: MonicaClient, input: z.infer<typeof ActivitiesInput>) {
  switch (input.action) {
    case "list": {
      const params = new URLSearchParams({
        limit: String(input.limit), page: String(input.page),
      });
      const path = input.contact_id
        ? `/api/contacts/${input.contact_id}/activities`
        : `/api/activities`;
      const res = await client.get(`${path}?${params}`);
      const items = Array.isArray(res?.data) ? res.data : [];
      return {
        page: res?.meta?.current_page,
        total: res?.meta?.total,
        count: items.length,
        activities: items.map(compactActivity),
      };
    }
    case "list_types": {
      const res = await client.get(`/api/activitytypes`);
      const items = Array.isArray(res?.data) ? res.data : [];
      return { count: items.length, types: items.map((t: any) => ({ id: t.id, name: t.name })) };
    }
    case "get":
      return await client.get(`/api/activities/${input.id}`);
    case "create": {
      const type = input.activity_type_id ?? await resolveDefaultType(client);
      return await client.post(`/api/activities`, {
        summary: input.summary,
        happened_at: input.happened_at,
        activity_type_id: type,
        contacts: input.contact_ids,
        description: input.description,
        duration_in_minutes: input.duration_in_minutes,
      });
    }
    case "bulk_create": {
      const type = await resolveDefaultType(client);
      const activities = input.activities;
      const results = await runBounded(activities, 4, (a) =>
        client.post(`/api/activities`, {
          summary: a.summary,
          happened_at: a.happened_at,
          activity_type_id: a.activity_type_id ?? type,
          contacts: a.contact_ids,
          description: a.description,
          duration_in_minutes: a.duration_in_minutes,
        }),
      );
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      return {
        total: results.length,
        succeeded: ok.length,
        failed: bad.length,
        activities: ok.map((r) => ({ id: r.result?.data?.id, summary: r.item.summary })),
        failures: bad.map((r) => ({ activity: r.item, error: r.error })),
      };
    }
    case "delete":
      await client.delete(`/api/activities/${input.id}`);
      return { deleted: input.id };
  }
}

function compactActivity(a: any) {
  return {
    id: a.id,
    summary: a.summary,
    happened_at: a.happened_at,
    description: a.description,
    duration_in_minutes: a.duration_in_minutes,
    activity_type: a.activity_type?.name,
    contacts: (a.attendees?.contacts ?? a.contacts ?? []).map((c: any) => ({ id: c.id, name: c.complete_name ?? c.name })),
  };
}
