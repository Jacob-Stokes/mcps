import { z } from "zod";
import type { FreshrssClient } from "../freshrss-client.js";

// Greader stream identifiers:
//   user/-/state/com.google/reading-list    — all items
//   user/-/state/com.google/read            — read (use as xt= to exclude)
//   user/-/state/com.google/starred         — starred
//   feed/<url>                              — a specific feed
//   user/-/label/<name>                     — a specific category

const READING_LIST = "user/-/state/com.google/reading-list";
const READ_STATE = "user/-/state/com.google/read";
const STARRED_STATE = "user/-/state/com.google/starred";

export const ITEMS_TOOL = {
  name: "freshrss_items",
  description: [
    "Read items from Jacob's RSS feeds. Actions:",
    "• unread — cross-feed unread items (optionally scoped to a feed or category). Main tool for 'what's new'.",
    "• feed — items from a single feed (use with include_read=true to browse archive).",
    "• starred — items Jacob marked important.",
    "Each item returns id, title, author, pub_time (unix s), feed, url, summary (text). Use item.id with freshrss_mark to update read/star state.",
  ].join(" "),
} as const;

export const ItemsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("unread"),
    limit: z.number().int().min(1).max(200).default(30),
    feed_id: z.string().optional().describe("Scope to one feed ('feed/<url>'). Omit for global unread."),
    category: z.string().optional().describe("Scope to a category label (e.g. 'Tech'). Omit for global."),
    order: z.enum(["newest", "oldest"]).default("newest"),
  }),
  z.object({
    action: z.literal("feed"),
    feed_id: z.string().describe("Either a feed URL or the 'feed/<url>' id from freshrss_feeds."),
    limit: z.number().int().min(1).max(200).default(30),
    include_read: z.boolean().default(false),
    order: z.enum(["newest", "oldest"]).default("newest"),
  }),
  z.object({
    action: z.literal("starred"),
    limit: z.number().int().min(1).max(200).default(30),
  }),
]);

export async function handleItems(client: FreshrssClient, input: z.infer<typeof ItemsInput>) {
  let streamId: string;
  const params = new URLSearchParams();
  params.set("n", String((input as any).limit));

  switch (input.action) {
    case "unread":
      if (input.feed_id) streamId = input.feed_id;
      else if (input.category) streamId = `user/-/label/${input.category}`;
      else streamId = READING_LIST;
      params.set("xt", READ_STATE);
      params.set("r", input.order === "oldest" ? "o" : "n");
      break;
    case "feed":
      streamId = input.feed_id.startsWith("feed/") ? input.feed_id : `feed/${input.feed_id}`;
      if (!input.include_read) params.set("xt", READ_STATE);
      params.set("r", input.order === "oldest" ? "o" : "n");
      break;
    case "starred":
      streamId = STARRED_STATE;
      break;
  }

  const res = await client.get<any>(
    `/reader/api/0/stream/contents/${encodeURIComponent(streamId)}?${params}`,
  );
  const items = (res?.items ?? []).map((it: any) => ({
    id: it.id,
    short_id: it.id?.match(/reader\/item\/([^/]+)$/)?.[1],
    title: it.title,
    author: it.author,
    published: it.published,
    updated: it.updated,
    url: it.alternate?.[0]?.href ?? it.canonical?.[0]?.href,
    feed_id: it.origin?.streamId,
    feed_title: it.origin?.title,
    summary: textify(it.summary?.content ?? it.content?.content ?? "").slice(0, 600),
    categories: it.categories ?? [],
    is_read: (it.categories ?? []).includes(READ_STATE),
    is_starred: (it.categories ?? []).includes(STARRED_STATE),
  }));
  return {
    count: items.length,
    updated: res?.updated,
    continuation: res?.continuation,
    items,
  };
}

// Strip HTML so agent contexts don't get cluttered. Keeping it simple —
// Greader summaries are already usually plaintext-ish.
function textify(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}
