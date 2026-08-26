import { z } from "zod";
import { sha256, runBounded, type ToolContext } from "../lib/vault.js";
import { handleFrontmatter } from "./metadata.js";
import {
  handleAppendNote,
  handleDeleteNote,
  handleMoveNote,
  handleWriteNote,
} from "./notes.js";

const Path = z.string().min(1);
const Hash = z.string().regex(/^[a-f0-9]{64}$/).optional();

export const BulkInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("read"),
    paths: z.array(Path).min(1).max(100),
    frontmatter_only: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("write"),
    files: z.array(z.object({ path: Path, content: z.string(), expected_hash: Hash })).min(1).max(50),
    mode: z.enum(["create", "overwrite", "upsert"]).default("create"),
    dry_run: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("append"),
    entries: z.array(z.object({ path: Path, content: z.string().min(1), heading: z.string().optional(), expected_hash: Hash })).min(1).max(50),
    create_if_missing: z.boolean().default(false),
    dry_run: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("move"),
    moves: z.array(z.object({ from: Path, to: Path, expected_hash: Hash })).min(1).max(50),
    overwrite: z.boolean().default(false),
    dry_run: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("delete"),
    paths: z.array(Path).min(1).max(50),
    mode: z.enum(["trash", "permanent"]).default("trash"),
    confirm_permanent: z.boolean().default(false),
    dry_run: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("frontmatter"),
    patches: z.array(z.object({ path: Path, fields: z.record(z.unknown()), expected_hash: Hash })).min(1).max(50),
    dry_run: z.boolean().default(false),
  }),
]);
export type BulkInput = z.infer<typeof BulkInput>;
export const BULK_TOOL = {
  name: "obsidian_bulk",
  description: "Run bounded batches of note reads, writes, appends, moves, safe deletes, or frontmatter merges. Each mutation reports partial failures; batches are not atomic. Defaults remain create-only, trash-not-delete, and no destination overwrite.",
  inputSchema: BulkInput,
};

export async function handleBulk(ctx: ToolContext, input: BulkInput) {
  if (input.action === "read") {
    const paths = input.paths.map((notePath) => ctx.policy.assertRead(notePath));
    const result = await ctx.client.post("/api/bulk/read", {
      paths,
      frontmatterOnly: input.frontmatter_only,
    });
    return {
      count: paths.length,
      results: (Array.isArray(result?.results) ? result.results : []).map((item: any) => ({
        ...item,
        hash: typeof item.content === "string" ? sha256(item.content) : undefined,
      })),
    };
  }

  let items: unknown[];
  let operation: (item: any) => Promise<any>;
  switch (input.action) {
    case "write":
      items = input.files;
      operation = (file) => handleWriteNote(ctx, {
        path: file.path,
        content: file.content,
        mode: input.mode,
        expected_hash: file.expected_hash,
        dry_run: input.dry_run,
      });
      break;
    case "append":
      items = input.entries;
      operation = (entry) => handleAppendNote(ctx, {
        path: entry.path,
        content: entry.content,
        heading: entry.heading,
        create_if_missing: input.create_if_missing,
        expected_hash: entry.expected_hash,
        dry_run: input.dry_run,
      });
      break;
    case "move":
      items = input.moves;
      operation = (move) => handleMoveNote(ctx, {
        from: move.from,
        to: move.to,
        overwrite: input.overwrite,
        expected_hash: move.expected_hash,
        dry_run: input.dry_run,
      });
      break;
    case "delete":
      if (input.mode === "permanent" && !input.confirm_permanent) {
        throw new Error("bulk permanent deletion requires confirm_permanent=true");
      }
      items = input.paths;
      operation = (notePath) => handleDeleteNote(ctx, {
        path: notePath,
        mode: input.mode,
        confirm_path: input.mode === "permanent" ? notePath : undefined,
        dry_run: input.dry_run,
      });
      break;
    case "frontmatter":
      items = input.patches;
      operation = (patch) => handleFrontmatter(ctx, {
        action: "merge",
        path: patch.path,
        fields: patch.fields,
        expected_hash: patch.expected_hash,
        dry_run: input.dry_run,
      });
      break;
  }
  const results = await runBounded(items, 4, operation);
  return {
    action: input.action,
    total: results.length,
    succeeded: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    results: results.map((result) => result.ok ? result.result : { item: result.item, error: result.error }),
  };
}
