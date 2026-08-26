import { z } from "zod";
import { extractTags, joinFrontmatter, splitFrontmatter } from "../lib/markdown.js";
import {
  assertExpectedHash,
  listMarkdownPaths,
  normalizeTag,
  readNote,
  runBounded,
  writeNoteContent,
  type ToolContext,
} from "../lib/vault.js";

const NotePath = z.string().min(1).describe("Vault-relative Markdown path ending in .md.");
const ExpectedHash = z.string().regex(/^[a-f0-9]{64}$/).optional();

export const FrontmatterInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("get"), path: NotePath }),
  z.object({
    action: z.literal("merge"),
    path: NotePath,
    fields: z.record(z.unknown()).describe("Fields to merge. A null value deletes that key."),
    expected_hash: ExpectedHash,
    dry_run: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("replace"),
    path: NotePath,
    fields: z.record(z.unknown()).describe("Complete replacement frontmatter mapping."),
    expected_hash: ExpectedHash,
    dry_run: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("delete_keys"),
    path: NotePath,
    keys: z.array(z.string().min(1)).min(1).max(100),
    expected_hash: ExpectedHash,
    dry_run: z.boolean().default(false),
  }),
]);
export type FrontmatterInput = z.infer<typeof FrontmatterInput>;
export const FRONTMATTER_TOOL = {
  name: "obsidian_manage_frontmatter",
  description: "Read, merge, replace, or delete YAML frontmatter fields while preserving the note body. Values may be scalars, arrays or nested objects. Null deletes a field during merge. Mutations support expected_hash and dry_run.",
  inputSchema: FrontmatterInput,
};
export async function handleFrontmatter(ctx: ToolContext, input: FrontmatterInput) {
  const existing = await readNote(ctx, input.path);
  const split = splitFrontmatter(existing.content);
  if (input.action === "get") {
    return { path: existing.path, hash: existing.hash, frontmatter: split.data, hasFrontmatter: split.hasFrontmatter };
  }
  assertExpectedHash(existing, input.expected_hash);
  let next: Record<string, unknown>;
  if (input.action === "replace") next = { ...input.fields };
  else if (input.action === "delete_keys") {
    next = { ...split.data };
    for (const key of input.keys) delete next[key];
  } else {
    next = { ...split.data };
    for (const [key, value] of Object.entries(input.fields)) {
      if (value === null) delete next[key];
      else next[key] = value;
    }
  }
  const updated = joinFrontmatter(next, split.body);
  const result = await writeNoteContent(ctx, input.path, updated, {
    overwrite: true,
    expectedHash: input.expected_hash,
    dryRun: input.dry_run,
    existing,
  });
  return { frontmatter: next, ...result };
}

const TagDryRun = z.boolean().optional().describe(
  "Omit for contextual safety: add/remove and note-scoped rename execute; folder- or vault-wide rename previews only.",
);

export const TagsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    path: z.string().optional().describe("A note path or folder subtree. Omit for the whole vault."),
    max_notes: z.number().int().positive().max(5000).default(1000),
  }),
  z.object({
    action: z.literal("add"),
    path: NotePath,
    tags: z.array(z.string().min(1)).min(1).max(100),
    expected_hash: ExpectedHash,
    dry_run: TagDryRun,
  }),
  z.object({
    action: z.literal("remove"),
    path: NotePath,
    tags: z.array(z.string().min(1)).min(1).max(100),
    locations: z.enum(["frontmatter", "inline", "both"]).default("frontmatter"),
    expected_hash: ExpectedHash,
    dry_run: TagDryRun,
  }),
  z.object({
    action: z.literal("rename"),
    old_tag: z.string().min(1),
    new_tag: z.string().min(1),
    path: z.string().optional().describe("Limit to one note or folder subtree."),
    locations: z.enum(["frontmatter", "inline", "both"]).default("both"),
    max_notes: z.number().int().positive().max(5000).default(1000),
    dry_run: TagDryRun,
  }),
]);
export type TagsInput = z.infer<typeof TagsInput>;
export function resolveTagsDryRun(input: { action: string; path?: string; dry_run?: boolean }): boolean {
  const broadRename = input.action === "rename" && (!input.path || !input.path.toLocaleLowerCase().endsWith(".md"));
  return input.dry_run ?? broadRename;
}
export const TAGS_TOOL = {
  name: "obsidian_manage_tags",
  description: "List vault tags with counts, add/remove frontmatter tags on one note, or rename a tag across a note/folder/vault. Inline changes avoid code spans and fenced code. Add/remove and note-scoped rename execute by default; folder- or vault-wide rename defaults to dry_run.",
  inputSchema: TagsInput,
};

export async function handleTags(ctx: ToolContext, input: TagsInput) {
  if (input.action === "add" || input.action === "remove") {
    const dryRun = resolveTagsDryRun(input);
    const existing = await readNote(ctx, input.path);
    assertExpectedHash(existing, input.expected_hash);
    const normalized = input.tags.map(normalizeTag);
    const split = splitFrontmatter(existing.content);
    let data = { ...split.data };
    let body = split.body;
    if (input.action === "add") {
      const current = frontmatterTags(data.tags);
      data.tags = [...new Set([...current, ...normalized])].sort();
    } else {
      const remove = new Set(normalized.map((tag) => tag.toLocaleLowerCase()));
      if (input.locations !== "inline") {
        const remaining = frontmatterTags(data.tags).filter((tag) => !remove.has(tag.toLocaleLowerCase()));
        if (remaining.length) data.tags = remaining;
        else delete data.tags;
      }
      if (input.locations !== "frontmatter") body = transformInlineTags(body, remove, null);
    }
    const updated = joinFrontmatter(data, body);
    const result = await writeNoteContent(ctx, input.path, updated, {
      overwrite: true,
      expectedHash: input.expected_hash,
      dryRun,
      existing,
    });
    return { tags: extractTags(updated), ...result };
  }

  const { notePath, folderPath } = splitPathScope(input.path);
  const listed = notePath
    ? { paths: [ctx.policy.assertRead(notePath)], total: 1, truncated: false }
    : await listMarkdownPaths(ctx, folderPath, { limit: input.max_notes });
  const bulk = await ctx.client.post("/api/bulk/read", { paths: listed.paths });
  const readable = (Array.isArray(bulk?.results) ? bulk.results : []).filter((item: any) => typeof item.content === "string");

  if (input.action === "list") {
    const counts = new Map<string, { tag: string; notes: number; frontmatter: number; inline: number }>();
    for (const item of readable) {
      const tags = extractTags(item.content);
      for (const tag of tags.all) {
        const key = tag.toLocaleLowerCase();
        const row = counts.get(key) ?? { tag, notes: 0, frontmatter: 0, inline: 0 };
        row.notes++;
        if (tags.frontmatter.some((candidate) => candidate.toLocaleLowerCase() === key)) row.frontmatter++;
        if (tags.inline.some((candidate) => candidate.toLocaleLowerCase() === key)) row.inline++;
        counts.set(key, row);
      }
    }
    return {
      path: input.path,
      scanned: readable.length,
      scanTruncated: listed.truncated,
      tags: [...counts.values()].sort((a, b) => b.notes - a.notes || a.tag.localeCompare(b.tag)),
    };
  }

  const oldTag = normalizeTag(input.old_tag);
  const newTag = normalizeTag(input.new_tag);
  const dryRun = resolveTagsDryRun(input);
  const candidates = readable.filter((item: any) =>
    extractTags(item.content).all.some((tag) => tag.toLocaleLowerCase() === oldTag.toLocaleLowerCase()),
  );
  const changes = await runBounded(candidates, 4, async (item: any) => {
    const existing = await readNote(ctx, item.path);
    const split = splitFrontmatter(existing.content);
    const data = { ...split.data };
    let body = split.body;
    if (input.locations !== "inline") {
      data.tags = frontmatterTags(data.tags).map((tag) =>
        tag.toLocaleLowerCase() === oldTag.toLocaleLowerCase() ? newTag : tag,
      );
      data.tags = [...new Set(data.tags as string[])].sort();
      if ((data.tags as string[]).length === 0) delete data.tags;
    }
    if (input.locations !== "frontmatter") {
      body = transformInlineTags(body, new Set([oldTag.toLocaleLowerCase()]), newTag);
    }
    const updated = joinFrontmatter(data, body);
    return writeNoteContent(ctx, item.path, updated, {
      overwrite: true,
      dryRun,
      existing,
    });
  });
  return {
    oldTag,
    newTag,
    dryRun,
    scanned: readable.length,
    matched: candidates.length,
    scanTruncated: listed.truncated,
    succeeded: changes.filter((change) => change.ok).length,
    failed: changes.filter((change) => !change.ok).length,
    results: changes.map((change) => change.ok ? change.result : { path: (change.item as any).path, error: change.error }),
  };
}

function frontmatterTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[ ,]+/) : [];
  return values.filter((item): item is string => typeof item === "string").map(normalizeTag);
}

function splitPathScope(rawPath?: string): { notePath?: string; folderPath: string } {
  if (!rawPath) return { folderPath: "" };
  return rawPath.toLowerCase().endsWith(".md") ? { notePath: rawPath, folderPath: "" } : { folderPath: rawPath };
}

function transformInlineTags(body: string, selected: Set<string>, replacement: string | null): string {
  const fenced: string[] = [];
  const protectedBody = body.replace(/```[\s\S]*?```/g, (block) => {
    const marker = `\u0000FENCE${fenced.length}\u0000`;
    fenced.push(block);
    return marker;
  });
  const inline: string[] = [];
  const protectedInline = protectedBody.replace(/`[^`]*`/g, (block) => {
    const marker = `\u0000CODE${inline.length}\u0000`;
    inline.push(block);
    return marker;
  });
  const transformed = protectedInline.replace(/(^|\s)#([\p{L}\p{N}_/-]+)/gu, (full, prefix, tag) => {
    if (!selected.has(String(tag).toLocaleLowerCase())) return full;
    return replacement ? `${prefix}#${replacement}` : prefix;
  });
  return transformed
    .replace(/\u0000CODE(\d+)\u0000/g, (_, index) => inline[Number(index)])
    .replace(/\u0000FENCE(\d+)\u0000/g, (_, index) => fenced[Number(index)]);
}
