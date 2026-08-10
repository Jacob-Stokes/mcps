import { z } from "zod";
import type { MonicaClient } from "../monica-client.js";
import { runBounded } from "../monica-client.js";

// Monica requires these flags on every contact create. Defaulted false
// since most contacts Jacob tracks have no known birthdate / aren't deceased.
const REQ_FLAGS = {
  is_birthdate_known: false,
  is_deceased: false,
  is_deceased_date_known: false,
};

export const CONTACTS_TOOL = {
  name: "monica_contacts",
  description: [
    "CRUD on Jacob's personal CRM contacts in Monica. Actions:",
    "• search — keyword match on name/nickname/description.",
    "• list — paginated browse (filter by is_starred / is_active etc).",
    "• get — full contact record by ID (includes relationship summary, last activity date, 'stay in touch' setting).",
    "• create — new contact. Required: first_name, gender ('Man'/'Woman'/'Rather not say'). Everything else optional.",
    "• bulk_create — create up to 30 contacts in one call.",
    "• update — partial patch by ID.",
    "• delete — remove contact.",
    "• set_stay_in_touch — configure monica's nudge: 'remind me about this person every N weeks/months'.",
    "Contact IDs are stable ints. The `complete_name` field is canonical for display.",
  ].join(" "),
} as const;

const Gender = z.enum(["Man", "Woman", "Rather not say"]);
const GENDER_ID: Record<z.infer<typeof Gender>, number> = {
  "Man": 1,
  "Woman": 2,
  "Rather not say": 3,
};

const ContactSpec = z.object({
  first_name: z.string().min(1),
  last_name: z.string().optional(),
  nickname: z.string().optional(),
  gender: Gender.default("Rather not say"),
  description: z.string().optional().describe("Free-text memo — where they live, how you know them, context."),
});

export const ContactsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"),
    query: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(25),
    page: z.number().int().min(1).default(1),
  }),
  z.object({
    action: z.literal("list"),
    limit: z.number().int().min(1).max(100).default(25),
    page: z.number().int().min(1).default(1),
    sort: z.string().optional().describe("e.g. 'updated_at', 'created_at', 'firstnameAZ', 'lastnameAZ'"),
  }),
  z.object({
    action: z.literal("get"),
    id: z.number().int(),
  }),
  z.object({
    action: z.literal("create"),
    first_name: z.string().min(1),
    last_name: z.string().optional(),
    nickname: z.string().optional(),
    gender: Gender.default("Rather not say"),
    description: z.string().optional(),
  }),
  z.object({
    action: z.literal("bulk_create"),
    contacts: z.array(ContactSpec).min(1).max(30),
  }),
  z.object({
    action: z.literal("update"),
    id: z.number().int(),
    fields: z.object({
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      nickname: z.string().optional(),
      gender: Gender.optional(),
      description: z.string().optional(),
    }),
  }),
  z.object({
    action: z.literal("delete"),
    id: z.number().int(),
  }),
  z.object({
    action: z.literal("set_stay_in_touch"),
    id: z.number().int(),
    frequency_days: z.number().int().min(0).describe("Nudge interval in days. 0 disables."),
  }),
]);

export async function handleContacts(client: MonicaClient, input: z.infer<typeof ContactsInput>) {
  switch (input.action) {
    case "search": {
      const params = new URLSearchParams({
        query: input.query, limit: String(input.limit), page: String(input.page),
      });
      return compactList(await client.get(`/api/contacts?${params}`));
    }
    case "list": {
      const params = new URLSearchParams({
        limit: String(input.limit), page: String(input.page),
      });
      if (input.sort) params.set("sort", input.sort);
      return compactList(await client.get(`/api/contacts?${params}`));
    }
    case "get":
      return await client.get(`/api/contacts/${input.id}`);
    case "create":
      return await client.post(`/api/contacts`, buildCreatePayload(input));
    case "bulk_create": {
      const contacts = input.contacts;
      const results = await runBounded(contacts, 4, (c) =>
        client.post(`/api/contacts`, buildCreatePayload({ ...c, gender: c.gender ?? "Rather not say" })),
      );
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      return {
        total: results.length,
        succeeded: ok.length,
        failed: bad.length,
        contacts: ok.map((r) => ({ id: r.result?.data?.id, name: r.result?.data?.complete_name })),
        failures: bad.map((r) => ({ contact: r.item, error: r.error })),
      };
    }
    case "update": {
      const payload: any = { ...REQ_FLAGS };
      if (input.fields.first_name !== undefined) payload.first_name = input.fields.first_name;
      if (input.fields.last_name !== undefined) payload.last_name = input.fields.last_name;
      if (input.fields.nickname !== undefined) payload.nickname = input.fields.nickname;
      if (input.fields.description !== undefined) payload.description = input.fields.description;
      if (input.fields.gender) payload.gender_id = GENDER_ID[input.fields.gender];
      return await client.put(`/api/contacts/${input.id}`, payload);
    }
    case "delete":
      await client.delete(`/api/contacts/${input.id}`);
      return { deleted: input.id };
    case "set_stay_in_touch": {
      // Monica endpoint: POST /api/contacts/{id}/stayintouch
      return await client.post(`/api/contacts/${input.id}/stayintouch`, {
        frequency: input.frequency_days,
      });
    }
  }
}

function buildCreatePayload(c: { first_name: string; last_name?: string; nickname?: string; gender: z.infer<typeof Gender>; description?: string }) {
  return {
    first_name: c.first_name,
    last_name: c.last_name,
    nickname: c.nickname,
    gender_id: GENDER_ID[c.gender],
    description: c.description,
    ...REQ_FLAGS,
  };
}

function compactList(res: any) {
  const items = Array.isArray(res?.data) ? res.data : [];
  return {
    page: res?.meta?.current_page,
    total: res?.meta?.total,
    count: items.length,
    contacts: items.map((c: any) => ({
      id: c.id,
      name: c.complete_name,
      nickname: c.nickname,
      gender: c.gender,
      description: c.description,
      is_starred: c.is_starred,
      last_activity: c.last_activity_together,
      stay_in_touch_days: c.stay_in_touch_frequency,
    })),
  };
}
