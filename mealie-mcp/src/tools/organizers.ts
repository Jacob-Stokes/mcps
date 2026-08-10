import { z } from "zod";
import type { MealieClient } from "../mealie-client.js";

// Tags/categories/tools share an identical {name} CRUD shape in Mealie's API.
// Cookbooks are richer (description, public, queryFilterString) but fit the
// same "labelled collection used to organize recipes" mental model, so all
// four live behind one tool rather than four near-identical ones.

const ORGANIZER_PATHS: Record<string, string> = {
  tag: "/api/organizers/tags",
  category: "/api/organizers/categories",
  tool: "/api/organizers/tools",
  cookbook: "/api/households/cookbooks",
};

export const ORGANIZERS_TOOL = {
  name: "mealie_organizers",
  description: [
    "Manage the labels Jacob's Mealie recipes are organized by. `type` selects which kind:",
    "tag, category, tool (kitchen equipment), or cookbook (a curated, filterable recipe collection).",
    "Actions: • list — all of that type. • get — one by ID. • create — new one (name required;",
    "cookbooks also take description/public/query_filter). • update — rename or change a cookbook's",
    "settings by ID. • delete — remove by ID.",
  ].join(" "),
} as const;

const OrganizerType = z.enum(["tag", "category", "tool", "cookbook"]);

export const OrganizersInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    type: OrganizerType,
  }),
  z.object({
    action: z.literal("get"),
    type: OrganizerType,
    id: z.string().min(1),
  }),
  z.object({
    action: z.literal("create"),
    type: OrganizerType,
    name: z.string().min(1),
    description: z.string().optional().describe("Cookbook only."),
    public: z.boolean().optional().describe("Cookbook only — visible without login."),
    query_filter: z.string().optional().describe("Cookbook only — Mealie recipe filter string that populates it."),
  }),
  z.object({
    action: z.literal("update"),
    type: OrganizerType,
    id: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional().describe("Cookbook only."),
    public: z.boolean().optional().describe("Cookbook only."),
    query_filter: z.string().optional().describe("Cookbook only."),
  }),
  z.object({
    action: z.literal("delete"),
    type: OrganizerType,
    id: z.string().min(1),
  }),
]);

export async function handleOrganizers(client: MealieClient, input: z.infer<typeof OrganizersInput>) {
  const base = ORGANIZER_PATHS[input.type];
  switch (input.action) {
    case "list": {
      const res = await client.get(base);
      const items = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
      return { count: items.length, [`${input.type}s`]: items.map(compact) };
    }
    case "get":
      return compact(await client.get(`${base}/${encodeURIComponent(input.id)}`));
    case "create":
      return compact(await client.post(base, buildBody(input)));
    case "update": {
      // PUT is a full replacement and `name` is required server-side, so
      // merge onto the current record rather than risk sending a partial
      // body that clobbers unset fields (or 422s on a missing name).
      const current = await client.get(`${base}/${encodeURIComponent(input.id)}`);
      const body = buildBody({ ...input, name: input.name ?? current?.name });
      if (input.type === "cookbook") {
        if (input.description === undefined) body.description = current?.description;
        if (input.public === undefined) body.public = current?.public;
        if (input.query_filter === undefined) body.queryFilterString = current?.queryFilterString;
      }
      return compact(await client.put(`${base}/${encodeURIComponent(input.id)}`, body));
    }
    case "delete":
      await client.delete(`${base}/${encodeURIComponent(input.id)}`);
      return { deleted: input.id, type: input.type };
  }
}

function buildBody(input: any) {
  if (input.type !== "cookbook") return { name: input.name };
  const body: any = { name: input.name };
  if (input.description !== undefined) body.description = input.description;
  if (input.public !== undefined) body.public = input.public;
  if (input.query_filter !== undefined) body.queryFilterString = input.query_filter;
  return body;
}

function compact(item: any) {
  if (!item) return item;
  return {
    id: item.id,
    name: item.name,
    slug: item.slug,
    description: item.description,
    public: item.public,
    query_filter: item.queryFilterString,
  };
}
