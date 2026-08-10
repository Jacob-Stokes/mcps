import { z } from "zod";
import type { FreshrssClient } from "../freshrss-client.js";

export const FEEDS_TOOL = {
  name: "freshrss_feeds",
  description: [
    "Inspect Jacob's FreshRSS subscriptions. Actions:",
    "• list — every subscribed feed (id, title, url, category). Optional with_counts to include unread counts per feed.",
    "• categories — every category / folder with feed counts.",
    "Use this to pick a feed_id or category name before calling freshrss_items.",
  ].join(" "),
} as const;

export const FeedsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    with_counts: z.boolean().default(false).describe("Include unread count per feed (extra API call)."),
  }),
  z.object({ action: z.literal("categories") }),
]);

export async function handleFeeds(client: FreshrssClient, input: z.infer<typeof FeedsInput>) {
  switch (input.action) {
    case "list": {
      const subs = await client.get<any>(`/reader/api/0/subscription/list`);
      const feeds = (subs?.subscriptions ?? []).map((s: any) => ({
        id: s.id,                         // feed/<url> form
        title: s.title,
        url: s.url,                       // html URL
        feed_url: s.id?.startsWith("feed/") ? s.id.slice("feed/".length) : s.url,
        categories: (s.categories ?? []).map((c: any) => c.label ?? c.id),
        icon: s.iconUrl,
      }));
      if (!input.with_counts) {
        return { count: feeds.length, feeds };
      }
      const uc = await client.get<any>(`/reader/api/0/unread-count`);
      const counts: Record<string, number> = {};
      for (const r of uc?.unreadcounts ?? []) counts[r.id] = r.count;
      return {
        count: feeds.length,
        total_unread: counts["user/-/state/com.google/reading-list"] ?? 0,
        feeds: feeds.map((f: any) => ({ ...f, unread: counts[f.id] ?? 0 })),
      };
    }
    case "categories": {
      const tags = await client.get<any>(`/reader/api/0/tag/list`);
      const cats = (tags?.tags ?? [])
        .filter((t: any) => t.id?.startsWith("user/-/label/"))
        .map((t: any) => ({
          id: t.id,
          label: t.id.slice("user/-/label/".length),
        }));
      return { count: cats.length, categories: cats };
    }
  }
}
