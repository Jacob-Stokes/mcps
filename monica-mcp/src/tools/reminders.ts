import { z } from "zod";
import type { MonicaClient } from "../monica-client.js";
import { runBounded } from "../monica-client.js";

// Monica reminders = recurring or one-off nudges tied to a contact.
// frequency_type ∈ {one_time, week, month, year}; frequency_number is
// the count (every N weeks/months/years).

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Frequency = z.enum(["one_time", "week", "month", "year"]);

export const REMINDERS_TOOL = {
  name: "monica_reminders",
  description: [
    "Manage follow-up reminders tied to contacts in Monica. Actions:",
    "• list — paginated reminders across all contacts.",
    "• list_upcoming — reminders whose next_expected_date is within N days.",
    "• get — full reminder by ID.",
    "• create — new reminder. Required: contact_id, title, initial_date (YYYY-MM-DD), frequency_type (one_time|week|month|year). For recurring, set frequency_number (e.g. every 2 weeks → week + 2).",
    "• bulk_create — up to 30 reminders in one call.",
    "• delete — remove by ID.",
    "Typical flow: 'remind me to call mum every week starting Sunday' → create with initial_date=Sunday, frequency_type=week, frequency_number=1.",
  ].join(" "),
} as const;

const ReminderSpec = z.object({
  contact_id: z.number().int(),
  title: z.string().min(1),
  description: z.string().optional(),
  initial_date: DateString,
  frequency_type: Frequency,
  frequency_number: z.number().int().min(1).default(1),
});

export const RemindersInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    limit: z.number().int().min(1).max(100).default(25),
    page: z.number().int().min(1).default(1),
  }),
  z.object({
    action: z.literal("list_upcoming"),
    days: z.number().int().min(1).max(365).default(14).describe("Look-ahead window in days."),
  }),
  z.object({
    action: z.literal("get"),
    id: z.number().int(),
  }),
  z.object({
    action: z.literal("create"),
    contact_id: z.number().int(),
    title: z.string().min(1),
    description: z.string().optional(),
    initial_date: DateString,
    frequency_type: Frequency,
    frequency_number: z.number().int().min(1).default(1),
  }),
  z.object({
    action: z.literal("bulk_create"),
    reminders: z.array(ReminderSpec).min(1).max(30),
  }),
  z.object({
    action: z.literal("delete"),
    id: z.number().int(),
  }),
]);

export async function handleReminders(client: MonicaClient, input: z.infer<typeof RemindersInput>) {
  switch (input.action) {
    case "list": {
      const params = new URLSearchParams({
        limit: String(input.limit), page: String(input.page),
      });
      const res = await client.get(`/api/reminders?${params}`);
      const items = Array.isArray(res?.data) ? res.data : [];
      return {
        page: res?.meta?.current_page,
        total: res?.meta?.total,
        count: items.length,
        reminders: items.map(compactReminder),
      };
    }
    case "list_upcoming": {
      // Monica populates next_expected_date lazily (nightly scheduler) —
      // until it runs, the field is null for fresh reminders. Fall back
      // to initial_date so newly-created reminders still surface.
      const now = Date.now();
      const threshold = now + input.days * 86400_000;
      const collected: any[] = [];
      let page = 1;
      while (page <= 10) {
        const res = await client.get(`/api/reminders?limit=100&page=${page}`);
        const items = Array.isArray(res?.data) ? res.data : [];
        for (const r of items) {
          const raw = r.next_expected_date ?? r.initial_date;
          const when = raw ? Date.parse(raw) : NaN;
          if (!isNaN(when) && when >= now - 86400_000 && when <= threshold) {
            collected.push({ ...r, _when: when });
          }
        }
        if (items.length < 100) break;
        page++;
      }
      collected.sort((a, b) => a._when - b._when);
      return {
        window_days: input.days,
        count: collected.length,
        reminders: collected.map(compactReminder),
      };
    }
    case "get":
      return await client.get(`/api/reminders/${input.id}`);
    case "create":
      return await client.post(`/api/reminders`, {
        contact_id: input.contact_id,
        title: input.title,
        description: input.description,
        initial_date: input.initial_date,
        frequency_type: input.frequency_type,
        frequency_number: input.frequency_number,
      });
    case "bulk_create": {
      const reminders = input.reminders;
      const results = await runBounded(reminders, 4, (r) =>
        client.post(`/api/reminders`, {
          contact_id: r.contact_id,
          title: r.title,
          description: r.description,
          initial_date: r.initial_date,
          frequency_type: r.frequency_type,
          frequency_number: r.frequency_number,
        }),
      );
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      return {
        total: results.length,
        succeeded: ok.length,
        failed: bad.length,
        reminders: ok.map((r) => ({ id: r.result?.data?.id, title: r.item.title })),
        failures: bad.map((r) => ({ reminder: r.item, error: r.error })),
      };
    }
    case "delete":
      await client.delete(`/api/reminders/${input.id}`);
      return { deleted: input.id };
  }
}

function compactReminder(r: any) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    initial_date: r.initial_date,
    next_expected_date: r.next_expected_date,
    frequency_type: r.frequency_type,
    frequency_number: r.frequency_number,
    contact: r.contact ? { id: r.contact.id, name: r.contact.complete_name ?? r.contact.name } : null,
  };
}
