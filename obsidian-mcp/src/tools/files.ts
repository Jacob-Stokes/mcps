import { z } from "zod";
import type { ObsidianClient } from "../obsidian-client.js";
import { encodeVaultPath } from "../obsidian-client.js";

// Read/write/delete/move/bulk operations on vault files. Parent folders are
// auto-created on write, so there's no separate "create folder" tool needed.

const FilePath = z
  .string()
  .min(1)
  .describe("Vault-relative path, e.g. 'Home.md', 'Homelab/README.md', 'Scratch/briefing-2026-04-18.md'. Always include .md extension.");

const WriteItem = z.object({
  path: FilePath,
  content: z.string().describe("Full markdown content (frontmatter + body)."),
});

export const FilesInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    path: FilePath,
  }),
  z.object({
    action: z.literal("write"),
    path: FilePath,
    content: z.string(),
    overwrite: z.boolean().default(true).describe("If false, fails on existing file."),
  }),
  z.object({
    action: z.literal("delete"),
    path: FilePath,
  }),
  z.object({
    action: z.literal("move"),
    from: FilePath,
    to: FilePath,
    overwrite: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("bulk_write"),
    files: z.array(WriteItem).min(1).max(50),
  }),
  z.object({
    action: z.literal("bulk_delete"),
    paths: z.array(FilePath).min(1).max(50),
  }),
  z.object({
    action: z.literal("bulk_move"),
    moves: z.array(z.object({
      from: FilePath,
      to: FilePath,
    })).min(1).max(50).describe("Array of {from,to} pairs. Useful for reorganising a folder."),
    overwrite: z.boolean().default(false).describe("Per-move overwrite flag (applied to every pair)."),
  }),
]);

export type FilesInput = z.infer<typeof FilesInput>;

export const FILES_TOOL = {
  name: "obsidian_files",
  description:
    "Read/write/delete/move vault files with bulk variants (bulk_write/bulk_delete/bulk_move). Parent folders auto-created on write. " +
    "Before writing, you should typically read 'Home.md' (the vault's orientation doc) to pick the " +
    "right top-level folder (Scratch/ for tests, Homelab/ for infra, Agents/ for agent stuff, etc.). " +
    "Paths are vault-relative and should include .md extensions. Examples: 'Journal/2026-04-18.md', " +
    "'Scratch/notes.md', 'Homelab/Decisions/008-something.md'. " +
    // User-facing reply instruction: do NOT emit obsidian:// deep links in
    // replies. Telegram (the bot's main channel) blocks non-http/https URL
    // schemes everywhere (markdown links AND inline keyboard buttons — the API
    // rejects them with 'Unsupported URL protocol'). When mentioning a file
    // you've just written/read, just quote the path in backticks, e.g.:
    //   Written to `Scratch/notes.md`.
    "When replying to the user about a file, cite the path in backticks — do NOT construct obsidian:// " +
    "deep links. Telegram rejects custom URL schemes; the deep link will either be stripped to plain " +
    "text or produce an error.",
  inputSchema: FilesInput,
};

export async function handleFiles(client: ObsidianClient, input: FilesInput): Promise<any> {
  switch (input.action) {
    case "read": {
      const res = await client.get(`/api/files/${encodeVaultPath(input.path)}`);
      return { path: input.path, content: res?.content ?? res };
    }

    case "write": {
      const res = await client.put(`/api/files/${encodeVaultPath(input.path)}`, {
        content: input.content,
        overwrite: input.overwrite,
      });
      return { path: input.path, ...res };
    }

    case "delete": {
      await client.delete(`/api/files/${encodeVaultPath(input.path)}`);
      return { deleted: input.path };
    }

    case "move": {
      const res = await client.post(`/api/move`, {
        from: input.from,
        to: input.to,
        overwrite: input.overwrite,
      });
      return { from: input.from, to: input.to, ...res };
    }

    case "bulk_write": {
      const res = await client.post(`/api/bulk/write`, { files: input.files });
      return {
        total: input.files.length,
        ...res,
      };
    }

    case "bulk_delete": {
      const res = await client.post(`/api/bulk/delete`, { paths: input.paths });
      return {
        total: input.paths.length,
        ...res,
      };
    }

    case "bulk_move": {
      // obsidian-landing has no /api/bulk/move — fan out with bounded
      // concurrency (4). Not atomic across moves; partial success reported.
      const results = await runBounded(input.moves, 4, async (m) => {
        await client.post(`/api/move`, {
          from: m.from,
          to: m.to,
          overwrite: input.overwrite,
        });
        return { from: m.from, to: m.to };
      });
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      return {
        total: results.length,
        succeeded: ok.length,
        failed: bad.length,
        moves: ok.map((r) => r.result),
        failures: bad.map((r) => ({ move: r.item, error: r.error })),
      };
    }
  }
}

// Bounded-concurrency fan-out — fresh fetch per iteration, no Response reuse.
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
      try {
        out[i] = { ok: true, item: items[i], result: await fn(items[i]) };
      } catch (e: any) {
        out[i] = { ok: false, item: items[i], error: e?.message ?? String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
