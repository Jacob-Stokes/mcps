import { z } from "zod";
import { encodeVaultPath } from "../obsidian-client.js";
import {
  extractHeadingSection,
  findBlockLine,
  outline,
  patchTarget,
  replaceInContent,
  splitFrontmatter,
} from "../lib/markdown.js";
import {
  assertExpectedHash,
  assertMarkdownPath,
  listMarkdownPaths,
  normalizeVaultPath,
  readNote,
  readNoteIfExists,
  sha256,
  writeNoteContent,
  type ToolContext,
} from "../lib/vault.js";

const NotePath = z.string().min(1).describe("Vault-relative Markdown path ending in .md.");
const ExpectedHash = z.string().regex(/^[a-f0-9]{64}$/).optional().describe("Optional SHA-256 returned by a prior read; prevents overwriting a changed note.");

export const GetNoteInput = z.object({
  path: NotePath,
  view: z.enum(["full", "body", "frontmatter", "outline", "heading", "block"]).default("full"),
  selector: z.string().optional().describe("Heading text for view=heading or block id for view=block."),
  occurrence: z.number().int().positive().max(100).default(1).describe("Which matching heading to return."),
});
export type GetNoteInput = z.infer<typeof GetNoteInput>;
export const GET_NOTE_TOOL = {
  name: "obsidian_get_note",
  description: "Read one note with its hash and file metadata. Return the complete note, body, parsed frontmatter, heading outline, one heading section, or one ^block reference. Use the returned hash as expected_hash before a later mutation.",
  inputSchema: GetNoteInput,
};
export async function handleGetNote(ctx: ToolContext, input: GetNoteInput) {
  const note = await readNote(ctx, input.path);
  const base = { path: note.path, size: note.size, modified: note.modified, hash: note.hash };
  switch (input.view) {
    case "full": return { ...base, content: note.content };
    case "body": return { ...base, body: splitFrontmatter(note.content).body };
    case "frontmatter": return { ...base, frontmatter: splitFrontmatter(note.content).data };
    case "outline": return { ...base, headings: outline(note.content) };
    case "heading": {
      if (!input.selector) throw new Error("selector is required for view=heading");
      const content = extractHeadingSection(note.content, input.selector, input.occurrence);
      if (content === null) throw new Error(`heading not found: ${input.selector}`);
      return { ...base, heading: input.selector, occurrence: input.occurrence, content };
    }
    case "block": {
      if (!input.selector) throw new Error("selector is required for view=block");
      const block = findBlockLine(note.content, input.selector);
      if (!block) throw new Error(`block reference not found: ${input.selector}`);
      return { ...base, block: input.selector.replace(/^\^/, ""), line: block.line + 1, content: block.text };
    }
  }
}

export const ListNotesInput = z.object({
  path: z.string().default("").describe("Vault folder, empty for the vault root."),
  recursive: z.boolean().default(true),
  max_depth: z.number().int().min(0).max(20).optional(),
  limit: z.number().int().positive().max(2000).default(500),
  include_metadata: z.boolean().default(false).describe("Include size, modified time and content hash. More expensive than paths-only listing."),
});
export type ListNotesInput = z.infer<typeof ListNotesInput>;
export const LIST_NOTES_TOOL = {
  name: "obsidian_list_notes",
  description: "List Markdown notes beneath a vault folder. Use recursive=false to inspect one folder. Optionally include metadata and hashes for the returned notes.",
  inputSchema: ListNotesInput,
};
export async function handleListNotes(ctx: ToolContext, input: ListNotesInput) {
  const listed = await listMarkdownPaths(ctx, input.path, {
    recursive: input.recursive,
    maxDepth: input.max_depth,
    limit: input.limit,
  });
  if (!input.include_metadata) return { path: input.path, ...listed };
  const result = await ctx.client.post("/api/bulk/read", { paths: listed.paths });
  const notes = (Array.isArray(result?.results) ? result.results : []).map((item: any) => ({
    path: item.path,
    size: item.size,
    modified: item.modified,
    hash: typeof item.content === "string" ? sha256(item.content) : undefined,
    error: item.error,
  }));
  return { path: input.path, total: listed.total, truncated: listed.truncated, notes };
}

export const WriteNoteInput = z.object({
  path: NotePath,
  content: z.string().describe("Complete Markdown content, including frontmatter when required."),
  mode: z.enum(["create", "overwrite", "upsert"]).default("create"),
  expected_hash: ExpectedHash,
  dry_run: z.boolean().default(false),
});
export type WriteNoteInput = z.infer<typeof WriteNoteInput>;
export const WRITE_NOTE_TOOL = {
  name: "obsidian_write_note",
  description: "Create or replace a complete Markdown note. Defaults to create-only. Use mode=overwrite/upsert deliberately, expected_hash for concurrency safety, and dry_run to preview hashes without writing.",
  inputSchema: WriteNoteInput,
};
export async function handleWriteNote(ctx: ToolContext, input: WriteNoteInput) {
  const existing = await readNoteIfExists(ctx, input.path);
  if (input.mode === "create" && existing) throw new Error(`note already exists: ${input.path}`);
  if (input.mode === "overwrite" && !existing) throw new Error(`note does not exist: ${input.path}`);
  return writeNoteContent(ctx, input.path, input.content, {
    overwrite: input.mode !== "create",
    expectedHash: input.expected_hash,
    dryRun: input.dry_run,
    existing,
  });
}

export const AppendNoteInput = z.object({
  path: NotePath,
  content: z.string().min(1),
  heading: z.string().optional().describe("Append inside this heading section instead of at end of file."),
  create_if_missing: z.boolean().default(false),
  expected_hash: ExpectedHash,
  dry_run: z.boolean().default(false),
});
export type AppendNoteInput = z.infer<typeof AppendNoteInput>;
export const APPEND_NOTE_TOOL = {
  name: "obsidian_append_to_note",
  description: "Append Markdown to an existing note or within a named heading. Creation is disabled unless create_if_missing=true. Supports expected_hash and dry_run.",
  inputSchema: AppendNoteInput,
};
export async function handleAppendNote(ctx: ToolContext, input: AppendNoteInput) {
  const existing = await readNoteIfExists(ctx, input.path);
  if (!existing && !input.create_if_missing) throw new Error(`note does not exist: ${input.path}`);
  assertExpectedHash(existing, input.expected_hash);
  const addition = input.content.replace(/^\n+|\n+$/g, "");
  let updated: string;
  if (!existing) updated = `${addition}\n`;
  else if (input.heading) updated = patchTarget(existing.content, "heading", input.heading, "append", addition);
  else updated = `${existing.content.replace(/\s*$/, "")}\n\n${addition}\n`;
  return writeNoteContent(ctx, input.path, updated, {
    overwrite: true,
    expectedHash: input.expected_hash,
    dryRun: input.dry_run,
    existing,
  });
}

export const PatchNoteInput = z.object({
  path: NotePath,
  target_type: z.enum(["heading", "block"]),
  target: z.string().min(1).describe("Heading text or ^block-id."),
  operation: z.enum(["replace", "append", "prepend", "delete", "insert_before", "insert_after"]),
  content: z.string().default("").describe("Required except for delete."),
  occurrence: z.number().int().positive().max(100).default(1),
  expected_hash: ExpectedHash,
  dry_run: z.boolean().default(false),
});
export type PatchNoteInput = z.infer<typeof PatchNoteInput>;
export const PATCH_NOTE_TOOL = {
  name: "obsidian_patch_note",
  description: "Make a Markdown-aware edit targeted at a heading section or ^block reference. For headings, replace preserves the heading and replaces its body; delete removes the complete section. Supports expected_hash and dry_run.",
  inputSchema: PatchNoteInput,
};
export async function handlePatchNote(ctx: ToolContext, input: PatchNoteInput) {
  if (input.operation !== "delete" && !input.content) throw new Error(`content is required for ${input.operation}`);
  const existing = await readNote(ctx, input.path);
  assertExpectedHash(existing, input.expected_hash);
  const updated = patchTarget(
    existing.content,
    input.target_type,
    input.target,
    input.operation,
    input.content,
    input.occurrence,
  );
  return writeNoteContent(ctx, input.path, updated, {
    overwrite: true,
    expectedHash: input.expected_hash,
    dryRun: input.dry_run,
    existing,
  });
}

export const ReplaceNoteInput = z.object({
  path: NotePath,
  find: z.string().min(1).max(1000),
  replace: z.string(),
  regex: z.boolean().default(false),
  case_sensitive: z.boolean().default(true),
  replace_all: z.boolean().default(true),
  max_replacements: z.number().int().positive().max(10000).default(1000),
  expected_hash: ExpectedHash,
  dry_run: z.boolean().default(false),
});
export type ReplaceNoteInput = z.infer<typeof ReplaceNoteInput>;
export const REPLACE_NOTE_TOOL = {
  name: "obsidian_replace_in_note",
  description: "Perform controlled literal or regular-expression replacement inside one note. Fails when there are no matches or when max_replacements would be exceeded. Supports expected_hash and dry_run.",
  inputSchema: ReplaceNoteInput,
};
export async function handleReplaceNote(ctx: ToolContext, input: ReplaceNoteInput) {
  const existing = await readNote(ctx, input.path);
  assertExpectedHash(existing, input.expected_hash);
  const replaced = replaceInContent(existing.content, input.find, input.replace, {
    regex: input.regex,
    caseSensitive: input.case_sensitive,
    replaceAll: input.replace_all,
    maxReplacements: input.max_replacements,
  });
  const result = await writeNoteContent(ctx, input.path, replaced.content, {
    overwrite: true,
    expectedHash: input.expected_hash,
    dryRun: input.dry_run,
    existing,
  });
  return { replacements: replaced.replacements, ...result };
}

export const MoveNoteInput = z.object({
  from: NotePath,
  to: NotePath,
  overwrite: z.boolean().default(false),
  expected_hash: ExpectedHash,
  dry_run: z.boolean().default(false),
});
export type MoveNoteInput = z.infer<typeof MoveNoteInput>;
export const MOVE_NOTE_TOOL = {
  name: "obsidian_move_note",
  description: "Move or rename one note. Defaults to refusing an existing destination. Supports source expected_hash and dry_run.",
  inputSchema: MoveNoteInput,
};
export async function handleMoveNote(ctx: ToolContext, input: MoveNoteInput) {
  const from = assertMarkdownPath(ctx.policy.assertWrite(input.from));
  const to = assertMarkdownPath(ctx.policy.assertWrite(input.to));
  const source = await readNote(ctx, from);
  assertExpectedHash(source, input.expected_hash);
  const destination = await readNoteIfExists(ctx, to);
  if (destination && !input.overwrite) throw new Error(`destination already exists: ${to}`);
  if (input.dry_run) return { dryRun: true, from, to, sourceHash: source.hash, destinationExists: !!destination };
  const result = await ctx.client.post("/api/move", { from, to, overwrite: input.overwrite });
  return { from, to, hash: source.hash, ...result };
}

export const DeleteNoteInput = z.object({
  path: NotePath,
  mode: z.enum(["trash", "permanent"]).default("trash"),
  confirm_path: z.string().optional().describe("For permanent deletion, must exactly equal path."),
  expected_hash: ExpectedHash,
  dry_run: z.boolean().default(false),
});
export type DeleteNoteInput = z.infer<typeof DeleteNoteInput>;
export const DELETE_NOTE_TOOL = {
  name: "obsidian_delete_note",
  description: "Delete a note safely. Defaults to moving it into the vault's .trash folder. Permanent deletion requires confirm_path exactly matching path. Supports expected_hash and dry_run.",
  inputSchema: DeleteNoteInput,
};
export async function handleDeleteNote(ctx: ToolContext, input: DeleteNoteInput) {
  const notePath = assertMarkdownPath(ctx.policy.assertWrite(input.path));
  const existing = await readNote(ctx, notePath);
  assertExpectedHash(existing, input.expected_hash);
  if (input.mode === "permanent") {
    if (input.confirm_path !== input.path) throw new Error("permanent deletion requires confirm_path to exactly equal path");
    if (input.dry_run) return { dryRun: true, path: notePath, mode: "permanent", hash: existing.hash };
    await ctx.client.delete(`/api/files/${encodeVaultPath(notePath)}`);
    return { deleted: notePath, mode: "permanent", hash: existing.hash };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashPath = ctx.policy.assertWrite(`.trash/${stamp}/${notePath}`, { allowTrash: true });
  if (input.dry_run) return { dryRun: true, path: notePath, mode: "trash", destination: trashPath, hash: existing.hash };
  await ctx.client.post("/api/move", { from: notePath, to: trashPath, overwrite: false });
  return { deleted: notePath, mode: "trash", destination: trashPath, hash: existing.hash };
}
