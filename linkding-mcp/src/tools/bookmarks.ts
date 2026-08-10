import { z } from "zod";
import type { LinkdingClient } from "../linkding-client.js";

export const BOOKMARKS_TOOL = {
  name: "linkding_bookmarks",
  description: [
    "Manage Jacob's linkding bookmarks. Single-item actions:",
    "• search — full-text search across title/description/url plus linkding's own query syntax (!unread, #tag, etc.).",
    "• list — browse paginated, optionally filtered by archived / unread status.",
    "• get — full bookmark by ID.",
    "• create — save a URL. linkding scrapes title/description/favicon automatically; optionally pass tags / notes / unread flag.",
    "• update — edit a bookmark's fields (partial patch).",
    "• archive / unarchive — move a single bookmark to/from the archive.",
    "• delete — permanently remove.",
    "Bulk actions (prefer these over looping single ops — one MCP call fans out):",
    "• bulk_tag_add — add one or more tags to many bookmarks (merged with existing).",
    "• bulk_tag_remove — remove one or more tags from many bookmarks (other tags preserved).",
    "• bulk_tag_set — replace tags on many bookmarks with the same set.",
    "• bulk_archive / bulk_unarchive — archive/unarchive many.",
    "• bulk_delete — delete many.",
    "Use linkding_tags to discover tag names first.",
  ].join(" "),
} as const;

const TagList = z.array(z.string()).describe("Tag names (linkding auto-creates missing ones).");

export const BookmarksInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"),
    query: z.string().min(1).describe("Free text + linkding query syntax: !unread, !archived, !untagged, #tag."),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    action: z.literal("list"),
    archived: z.boolean().optional().describe("true = archive only, false = active only, omit for active."),
    unread: z.boolean().optional(),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    action: z.literal("get"),
    id: z.number().int(),
  }),
  z.object({
    action: z.literal("create"),
    url: z.string().url(),
    title: z.string().optional().describe("Omit for auto-scrape."),
    description: z.string().optional(),
    notes: z.string().optional(),
    tag_names: TagList.optional(),
    unread: z.boolean().default(false),
    shared: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("update"),
    id: z.number().int(),
    fields: z.object({
      url: z.string().url().optional(),
      title: z.string().optional(),
      description: z.string().optional(),
      notes: z.string().optional(),
      tag_names: TagList.optional(),
      unread: z.boolean().optional(),
      shared: z.boolean().optional(),
    }),
  }),
  z.object({ action: z.literal("archive"), id: z.number().int() }),
  z.object({ action: z.literal("unarchive"), id: z.number().int() }),
  z.object({ action: z.literal("delete"), id: z.number().int() }),
  z.object({
    action: z.literal("bulk_tag_add"),
    ids: z.array(z.number().int()).min(1).max(100),
    tag_names: TagList.describe("Tags to add. Existing tags are preserved."),
  }),
  z.object({
    action: z.literal("bulk_tag_remove"),
    ids: z.array(z.number().int()).min(1).max(100),
    tag_names: TagList.describe("Tags to remove. Other tags on each bookmark are preserved."),
  }),
  z.object({
    action: z.literal("bulk_tag_set"),
    ids: z.array(z.number().int()).min(1).max(100),
    tag_names: TagList.describe("Tags to set. Completely REPLACES existing tags on each bookmark."),
  }),
  z.object({
    action: z.literal("bulk_archive"),
    ids: z.array(z.number().int()).min(1).max(100),
  }),
  z.object({
    action: z.literal("bulk_unarchive"),
    ids: z.array(z.number().int()).min(1).max(100),
  }),
  z.object({
    action: z.literal("bulk_delete"),
    ids: z.array(z.number().int()).min(1).max(100),
  }),
]);

export async function handleBookmarks(client: LinkdingClient, input: z.infer<typeof BookmarksInput>) {
  switch (input.action) {
    case "search": {
      const params = new URLSearchParams({ q: input.query, limit: String(input.limit), offset: String(input.offset) });
      return compactList(await client.get(`/api/bookmarks/?${params}`));
    }
    case "list": {
      const params = new URLSearchParams({ limit: String(input.limit), offset: String(input.offset) });
      if (input.unread !== undefined) params.set("unread", String(input.unread));
      const path = input.archived ? `/api/bookmarks/archived/` : `/api/bookmarks/`;
      return compactList(await client.get(`${path}?${params}`));
    }
    case "get":
      return await client.get(`/api/bookmarks/${input.id}/`);
    case "create":
      return await client.post(`/api/bookmarks/`, {
        url: input.url,
        title: input.title,
        description: input.description,
        notes: input.notes,
        tag_names: input.tag_names,
        unread: input.unread,
        shared: input.shared,
      });
    case "update":
      return await client.patch(`/api/bookmarks/${input.id}/`, input.fields);
    case "archive":
      await client.post(`/api/bookmarks/${input.id}/archive/`);
      return { archived: input.id };
    case "unarchive":
      await client.post(`/api/bookmarks/${input.id}/unarchive/`);
      return { unarchived: input.id };
    case "delete":
      await client.delete(`/api/bookmarks/${input.id}/`);
      return { deleted: input.id };

    case "bulk_tag_add": {
      // linkding PATCH replaces tag_names, so we GET each first, merge, then PATCH.
      // Two round trips per bookmark; bounded concurrency keeps SQLite happy.
      const results = await runBounded(input.ids, 4, async (id) => {
        const current = await client.get(`/api/bookmarks/${id}/`);
        const existing = new Set<string>(current.tag_names ?? []);
        for (const t of input.tag_names) existing.add(t);
        const merged = Array.from(existing);
        await client.patch(`/api/bookmarks/${id}/`, { tag_names: merged });
        return { id, tags: merged };
      });
      return summarize("bulk_tag_add", results);
    }

    case "bulk_tag_remove": {
      const toRemove = new Set(input.tag_names);
      const results = await runBounded(input.ids, 4, async (id) => {
        const current = await client.get(`/api/bookmarks/${id}/`);
        const kept = (current.tag_names ?? []).filter((t: string) => !toRemove.has(t));
        await client.patch(`/api/bookmarks/${id}/`, { tag_names: kept });
        return { id, tags: kept };
      });
      return summarize("bulk_tag_remove", results);
    }

    case "bulk_tag_set": {
      const results = await runBounded(input.ids, 4, async (id) => {
        await client.patch(`/api/bookmarks/${id}/`, { tag_names: input.tag_names });
        return { id, tags: input.tag_names };
      });
      return summarize("bulk_tag_set", results);
    }

    case "bulk_archive": {
      const results = await runBounded(input.ids, 4, async (id) => {
        await client.post(`/api/bookmarks/${id}/archive/`);
        return { id };
      });
      return summarize("bulk_archive", results);
    }

    case "bulk_unarchive": {
      const results = await runBounded(input.ids, 4, async (id) => {
        await client.post(`/api/bookmarks/${id}/unarchive/`);
        return { id };
      });
      return summarize("bulk_unarchive", results);
    }

    case "bulk_delete": {
      const results = await runBounded(input.ids, 4, async (id) => {
        await client.delete(`/api/bookmarks/${id}/`);
        return { id };
      });
      return summarize("bulk_delete", results);
    }
  }
}

// Bounded parallelism — burst of N concurrent requests, then move on.
// linkding is Django/sqlite, no need to be heroic.
async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: boolean; item: T; result?: R; error?: string }>> {
  const out: Array<{ ok: boolean; item: T; result?: R; error?: string }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      const item = items[i];
      try {
        const result = await fn(item);
        out[i] = { ok: true, item, result };
      } catch (e: any) {
        out[i] = { ok: false, item, error: e?.message ?? String(e) };
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, worker);
  await Promise.all(workers);
  return out;
}

function summarize(action: string, results: Array<{ ok: boolean; item: any; error?: string }>) {
  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  return {
    action,
    total: results.length,
    succeeded,
    failed: failed.length,
    failures: failed.map((r) => ({ id: r.item, error: r.error })),
  };
}

// linkding's list responses are DRF paginated and fairly verbose. Trim to
// what agents usually need — full record via action=get.
function compactList(res: any) {
  const results = Array.isArray(res?.results) ? res.results : [];
  return {
    total: res?.count,
    count: results.length,
    next: res?.next,
    previous: res?.previous,
    bookmarks: results.map((b: any) => ({
      id: b.id,
      url: b.url,
      title: b.title || b.website_title || "",
      description: b.description || b.website_description || "",
      notes: b.notes,
      tags: b.tag_names ?? [],
      unread: b.unread,
      shared: b.shared,
      date_added: b.date_added,
      date_modified: b.date_modified,
    })),
  };
}
