import { z } from "zod";
import type { FreshrssClient } from "../freshrss-client.js";

const READ_STATE = "user/-/state/com.google/read";
const STARRED_STATE = "user/-/state/com.google/starred";

export const MARK_TOOL = {
  name: "freshrss_mark",
  description: [
    "Update read/starred state on RSS items. Actions:",
    "• read / unread — mark one or more items (use item.id from freshrss_items).",
    "• star / unstar — flag important items.",
    "• read_all_in_feed — mark an entire feed read (e.g. after a summary).",
    "• read_all_in_category — mark a category read.",
    "Bulk ops are preferred over looping single-item calls — each is one API round-trip.",
  ].join(" "),
} as const;

export const MarkInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    item_ids: z.array(z.string()).min(1).max(200),
  }),
  z.object({
    action: z.literal("unread"),
    item_ids: z.array(z.string()).min(1).max(200),
  }),
  z.object({
    action: z.literal("star"),
    item_ids: z.array(z.string()).min(1).max(200),
  }),
  z.object({
    action: z.literal("unstar"),
    item_ids: z.array(z.string()).min(1).max(200),
  }),
  z.object({
    action: z.literal("read_all_in_feed"),
    feed_id: z.string().describe("'feed/<url>' identifier from freshrss_feeds."),
    older_than_ms: z.number().int().optional().describe("Only mark items older than this epoch-ms timestamp (defaults to all)."),
  }),
  z.object({
    action: z.literal("read_all_in_category"),
    category: z.string().describe("Category label."),
    older_than_ms: z.number().int().optional(),
  }),
]);

export async function handleMark(client: FreshrssClient, input: z.infer<typeof MarkInput>) {
  switch (input.action) {
    case "read":
      await client.post(`/reader/api/0/edit-tag`, { i: input.item_ids, a: READ_STATE });
      return { updated: input.item_ids.length, state: "read" };
    case "unread":
      await client.post(`/reader/api/0/edit-tag`, { i: input.item_ids, r: READ_STATE });
      return { updated: input.item_ids.length, state: "unread" };
    case "star":
      await client.post(`/reader/api/0/edit-tag`, { i: input.item_ids, a: STARRED_STATE });
      return { updated: input.item_ids.length, state: "starred" };
    case "unstar":
      await client.post(`/reader/api/0/edit-tag`, { i: input.item_ids, r: STARRED_STATE });
      return { updated: input.item_ids.length, state: "unstarred" };
    case "read_all_in_feed": {
      const params: Record<string, string> = { s: input.feed_id };
      if (input.older_than_ms) params.ts = String(input.older_than_ms);
      await client.post(`/reader/api/0/mark-all-as-read`, params);
      return { ok: true, feed: input.feed_id };
    }
    case "read_all_in_category": {
      const params: Record<string, string> = { s: `user/-/label/${input.category}` };
      if (input.older_than_ms) params.ts = String(input.older_than_ms);
      await client.post(`/reader/api/0/mark-all-as-read`, params);
      return { ok: true, category: input.category };
    }
  }
}
