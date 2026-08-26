import { z } from "zod";
import { encodeVaultPath, ObsidianError } from "../obsidian-client.js";
import { normalizeVaultPath, sha256, type ToolContext } from "../lib/vault.js";

const AttachmentPath = z.string().min(1).describe("Vault-relative non-Markdown attachment path.");

export const AttachmentsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    path: z.string().default("").describe("Folder subtree; empty for vault root."),
    recursive: z.boolean().default(true),
    max_depth: z.number().int().min(0).max(20).optional(),
    limit: z.number().int().positive().max(2000).default(500),
  }),
  z.object({ action: z.literal("read"), path: AttachmentPath }),
  z.object({
    action: z.literal("write"),
    path: AttachmentPath,
    content_base64: z.string().min(1),
    overwrite: z.boolean().default(false),
    dry_run: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("move"),
    from: AttachmentPath,
    to: AttachmentPath,
    overwrite: z.boolean().default(false),
    dry_run: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("delete"),
    path: AttachmentPath,
    mode: z.enum(["trash", "permanent"]).default("trash"),
    confirm_path: z.string().optional(),
    dry_run: z.boolean().default(false),
  }),
]);
export type AttachmentsInput = z.infer<typeof AttachmentsInput>;
export const ATTACHMENTS_TOOL = {
  name: "obsidian_attachments",
  description: "List, read, upload, move or safely delete non-Markdown vault attachments. Binary content uses base64 and is size-limited. Writes refuse overwrite by default; deletes move to .trash by default.",
  inputSchema: AttachmentsInput,
};

export async function handleAttachments(ctx: ToolContext, input: AttachmentsInput) {
  if (input.action === "list") {
    const base = input.path ? ctx.policy.assertBrowse(input.path) : "";
    const params = new URLSearchParams();
    if (base) params.set("dir", base);
    if (!input.recursive) params.set("depth", "0");
    else if (input.max_depth !== undefined) params.set("depth", String(input.max_depth));
    const result = await ctx.client.get(`/api/files?${params}`);
    const all = (Array.isArray(result?.files) ? result.files : [])
      .filter((candidate: unknown): candidate is string => typeof candidate === "string" && !candidate.toLowerCase().endsWith(".md"))
      .filter((candidate: string) => { try { ctx.policy.assertRead(candidate); return true; } catch { return false; } });
    return {
      path: base,
      total: all.length,
      truncated: all.length > input.limit,
      attachments: all.slice(0, input.limit).map((attachmentPath: string) => ({
        path: attachmentPath,
        mediaType: mediaTypeFor(attachmentPath),
      })),
    };
  }

  if (input.action === "read") {
    const attachmentPath = assertAttachment(ctx.policy.assertRead(input.path));
    const metadata = await ctx.client.head(`/api/files/${encodeVaultPath(attachmentPath)}`);
    if (metadata?.size > ctx.maxAttachmentBytes) {
      throw new Error(`attachment is ${metadata.size} bytes; remote read limit is ${ctx.maxAttachmentBytes}`);
    }
    const result = await ctx.client.get(`/api/files/${encodeVaultPath(attachmentPath)}?format=base64`);
    if (result?.size > ctx.maxAttachmentBytes) {
      throw new Error(`attachment is ${result.size} bytes; remote read limit is ${ctx.maxAttachmentBytes}`);
    }
    return {
      path: attachmentPath,
      mediaType: mediaTypeFor(attachmentPath),
      size: result?.size,
      modified: result?.modified,
      hash: result?.contentBase64 ? sha256(Buffer.from(result.contentBase64, "base64")) : undefined,
      contentBase64: result?.contentBase64,
    };
  }

  if (input.action === "write") {
    const attachmentPath = assertAttachment(ctx.policy.assertWrite(input.path));
    const bytes = decodeBase64(input.content_base64);
    if (bytes.length > ctx.maxAttachmentBytes) {
      throw new Error(`attachment is ${bytes.length} bytes; remote write limit is ${ctx.maxAttachmentBytes}`);
    }
    const exists = await attachmentExists(ctx, attachmentPath);
    if (exists && !input.overwrite) throw new Error(`attachment already exists: ${attachmentPath}`);
    const summary = {
      path: attachmentPath,
      size: bytes.length,
      hash: sha256(bytes),
      mediaType: mediaTypeFor(attachmentPath),
      created: !exists,
    };
    if (input.dry_run) return { dryRun: true, ...summary };
    const result = await ctx.client.put(`/api/files/${encodeVaultPath(attachmentPath)}`, {
      contentBase64: input.content_base64,
    });
    return { ...summary, ...result };
  }

  if (input.action === "move") {
    const from = assertAttachment(ctx.policy.assertWrite(input.from));
    const to = assertAttachment(ctx.policy.assertWrite(input.to));
    if (!(await attachmentExists(ctx, from))) throw new Error(`attachment not found: ${from}`);
    if ((await attachmentExists(ctx, to)) && !input.overwrite) throw new Error(`destination already exists: ${to}`);
    if (input.dry_run) return { dryRun: true, from, to };
    const result = await ctx.client.post("/api/move", { from, to, overwrite: input.overwrite });
    return { from, to, ...result };
  }

  const attachmentPath = assertAttachment(ctx.policy.assertWrite(input.path));
  if (!(await attachmentExists(ctx, attachmentPath))) throw new Error(`attachment not found: ${attachmentPath}`);
  if (input.mode === "permanent") {
    if (input.confirm_path !== input.path) throw new Error("permanent deletion requires confirm_path to exactly equal path");
    if (input.dry_run) return { dryRun: true, path: attachmentPath, mode: "permanent" };
    await ctx.client.delete(`/api/files/${encodeVaultPath(attachmentPath)}`);
    return { deleted: attachmentPath, mode: "permanent" };
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const trashPath = ctx.policy.assertWrite(`.trash/${stamp}/${attachmentPath}`, { allowTrash: true });
  if (input.dry_run) return { dryRun: true, path: attachmentPath, mode: "trash", destination: trashPath };
  await ctx.client.post("/api/move", { from: attachmentPath, to: trashPath, overwrite: false });
  return { deleted: attachmentPath, mode: "trash", destination: trashPath };
}

function assertAttachment(rawPath: string): string {
  const normalized = normalizeVaultPath(rawPath);
  if (normalized.toLowerCase().endsWith(".md")) throw new Error("use note tools for Markdown files");
  return normalized;
}

async function attachmentExists(ctx: ToolContext, attachmentPath: string): Promise<boolean> {
  try {
    await ctx.client.head(`/api/files/${encodeVaultPath(attachmentPath)}`);
    return true;
  } catch (error) {
    if (error instanceof ObsidianError && error.status === 404) return false;
    throw error;
  }
}

function decodeBase64(value: string): Buffer {
  const normalized = value.replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new Error("content_base64 is not valid base64");
  }
  return Buffer.from(normalized, "base64");
}

function mediaTypeFor(filePath: string): string {
  const extension = filePath.split(".").pop()?.toLowerCase();
  return ({
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
    svg: "image/svg+xml", pdf: "application/pdf", mp3: "audio/mpeg", m4a: "audio/mp4",
    wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", csv: "text/csv", json: "application/json",
  } as Record<string, string>)[extension ?? ""] ?? "application/octet-stream";
}
