// Deprecated compatibility façade. New clients should use the focused note
// tools and obsidian_bulk; this keeps existing Jacob Gateway callers working.
import { z } from "zod";
import type { ToolContext } from "../lib/vault.js";
import { handleBulk } from "./bulk.js";
import { handleDeleteNote, handleGetNote, handleMoveNote, handleWriteNote } from "./notes.js";

const FilePath = z.string().min(1).describe("Vault-relative Markdown path ending in .md.");
const WriteItem = z.object({ path: FilePath, content: z.string() });

export const FilesInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), path: FilePath }),
  z.object({ action: z.literal("write"), path: FilePath, content: z.string(), overwrite: z.boolean().default(true) }),
  z.object({ action: z.literal("delete"), path: FilePath }),
  z.object({ action: z.literal("move"), from: FilePath, to: FilePath, overwrite: z.boolean().default(false) }),
  z.object({ action: z.literal("bulk_write"), files: z.array(WriteItem).min(1).max(50) }),
  z.object({ action: z.literal("bulk_delete"), paths: z.array(FilePath).min(1).max(50) }),
  z.object({
    action: z.literal("bulk_move"),
    moves: z.array(z.object({ from: FilePath, to: FilePath })).min(1).max(50),
    overwrite: z.boolean().default(false),
  }),
]);
export type FilesInput = z.infer<typeof FilesInput>;
export const FILES_TOOL = {
  name: "obsidian_files",
  description: "DEPRECATED compatibility tool for older clients. Use obsidian_get_note, obsidian_write_note, obsidian_move_note, obsidian_delete_note and obsidian_bulk. Deletes now move notes to .trash rather than permanently removing them.",
  inputSchema: FilesInput,
};

export async function handleFiles(ctx: ToolContext, input: FilesInput) {
  switch (input.action) {
    case "read": return handleGetNote(ctx, { path: input.path, view: "full", occurrence: 1 });
    case "write": return handleWriteNote(ctx, {
      path: input.path,
      content: input.content,
      mode: input.overwrite ? "upsert" : "create",
      dry_run: false,
    });
    case "delete": return handleDeleteNote(ctx, { path: input.path, mode: "trash", dry_run: false });
    case "move": return handleMoveNote(ctx, {
      from: input.from,
      to: input.to,
      overwrite: input.overwrite,
      dry_run: false,
    });
    case "bulk_write": return handleBulk(ctx, {
      action: "write",
      files: input.files,
      mode: "upsert",
      dry_run: false,
    });
    case "bulk_delete": return handleBulk(ctx, {
      action: "delete",
      paths: input.paths,
      mode: "trash",
      confirm_permanent: false,
      dry_run: false,
    });
    case "bulk_move": return handleBulk(ctx, {
      action: "move",
      moves: input.moves,
      overwrite: input.overwrite,
      dry_run: false,
    });
  }
}
