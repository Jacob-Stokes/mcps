import { z } from "zod";
import type { LinkdingClient } from "../linkding-client.js";

export const TAGS_TOOL = {
  name: "linkding_tags",
  description: [
    "Inspect linkding tags (used to scope bookmark searches). Actions:",
    "• list — every tag with bookmark count.",
    "• get — one tag's details by ID.",
    "Tags are created implicitly via linkding_bookmarks action=create with tag_names.",
  ].join(" "),
} as const;

export const TagsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    limit: z.number().int().min(1).max(500).default(200),
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    action: z.literal("get"),
    id: z.number().int(),
  }),
]);

export async function handleTags(client: LinkdingClient, input: z.infer<typeof TagsInput>) {
  switch (input.action) {
    case "list": {
      const params = new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) });
      const res = await client.get(`/api/tags/?${params}`);
      const results = Array.isArray(res?.results) ? res.results : [];
      return {
        total: res?.count,
        count: results.length,
        tags: results.map((t: any) => ({ id: t.id, name: t.name, date_added: t.date_added })),
      };
    }
    case "get":
      return await client.get(`/api/tags/${input.id}/`);
  }
}
