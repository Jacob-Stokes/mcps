import { createHash } from "node:crypto";
import path from "node:path";
import type { ObsidianClient } from "../obsidian-client.js";
import { ObsidianError, encodeVaultPath } from "../obsidian-client.js";

export type ToolContext = {
  client: ObsidianClient;
  policy: VaultPolicy;
  dailyFolder: string;
  timeZone: string;
  maxAttachmentBytes: number;
};

export type NoteSnapshot = {
  path: string;
  content: string;
  size?: number;
  modified?: string;
  hash: string;
};

function configuredPrefixes(name: string): string[] | null {
  const value = process.env[name]?.trim();
  if (!value || value === "*") return null;
  return value.split(",").map(normalizeVaultPath).filter(Boolean);
}

export class VaultPolicy {
  private readonly readPrefixes = configuredPrefixes("OBSIDIAN_READ_PATHS");
  private readonly writePrefixes = configuredPrefixes("OBSIDIAN_WRITE_PATHS");

  assertRead(rawPath: string): string {
    const normalized = normalizeVaultPath(rawPath);
    this.assertNotPrivate(normalized);
    if (!matchesPrefix(normalized, this.readPrefixes)) {
      throw new Error(`read denied by OBSIDIAN_READ_PATHS: ${normalized}`);
    }
    return normalized;
  }

  assertBrowse(rawPath: string): string {
    const normalized = normalizeVaultPath(rawPath);
    this.assertNotPrivate(normalized);
    if (!this.canSee(normalized)) throw new Error(`browse denied by OBSIDIAN_READ_PATHS: ${normalized}`);
    return normalized;
  }

  canRead(rawPath: string): boolean {
    try { this.assertRead(rawPath); return true; } catch { return false; }
  }

  canSee(rawPath: string): boolean {
    try {
      const normalized = normalizeVaultPath(rawPath);
      this.assertNotPrivate(normalized);
      return !this.readPrefixes || this.readPrefixes.some((prefix) =>
        normalized === prefix || normalized.startsWith(`${prefix}/`) || prefix.startsWith(`${normalized}/`),
      );
    } catch {
      return false;
    }
  }

  assertWrite(rawPath: string, options: { allowTrash?: boolean } = {}): string {
    const normalized = normalizeVaultPath(rawPath);
    if (!(options.allowTrash && (normalized === ".trash" || normalized.startsWith(".trash/")))) {
      this.assertNotPrivate(normalized);
    }
    if (!options.allowTrash && !matchesPrefix(normalized, this.writePrefixes)) {
      throw new Error(`write denied by OBSIDIAN_WRITE_PATHS: ${normalized}`);
    }
    return normalized;
  }

  describe() {
    return {
      readPaths: this.readPrefixes ?? ["*"],
      writePaths: this.writePrefixes ?? ["*"],
      alwaysDenied: [".obsidian", ".trash"],
    };
  }

  private assertNotPrivate(normalized: string) {
    if (
      normalized === ".obsidian" || normalized.startsWith(".obsidian/") ||
      normalized === ".trash" || normalized.startsWith(".trash/")
    ) {
      throw new Error("access to private Obsidian folders is not exposed through the remote MCP");
    }
  }
}

function matchesPrefix(value: string, prefixes: string[] | null): boolean {
  if (!prefixes) return true;
  return prefixes.some((prefix) => value === prefix || value.startsWith(`${prefix}/`));
}

export function normalizeVaultPath(rawPath: string): string {
  if (typeof rawPath !== "string" || !rawPath.trim()) throw new Error("vault path is required");
  if (rawPath.includes("\0") || rawPath.includes("\\")) throw new Error("invalid vault path");
  const trimmed = rawPath.trim().replace(/^\/+|\/+$/g, "");
  if (!trimmed || path.posix.isAbsolute(trimmed)) throw new Error("path must be vault-relative");
  const segments = trimmed.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("path must not contain empty, '.' or '..' segments");
  }
  return segments.join("/");
}

export function assertMarkdownPath(rawPath: string): string {
  const normalized = normalizeVaultPath(rawPath);
  if (!normalized.toLowerCase().endsWith(".md")) throw new Error("note paths must end in .md");
  return normalized;
}

export function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function readNote(ctx: ToolContext, rawPath: string): Promise<NoteSnapshot> {
  const notePath = assertMarkdownPath(ctx.policy.assertRead(rawPath));
  const result = await ctx.client.get(`/api/files/${encodeVaultPath(notePath)}`);
  const content = result?.content ?? result;
  if (typeof content !== "string") throw new Error(`backend returned non-text content for ${notePath}`);
  return {
    path: notePath,
    content,
    size: result?.size,
    modified: result?.modified,
    hash: sha256(content),
  };
}

export async function readNoteIfExists(ctx: ToolContext, rawPath: string): Promise<NoteSnapshot | null> {
  try {
    return await readNote(ctx, rawPath);
  } catch (error) {
    if (error instanceof ObsidianError && error.status === 404) return null;
    throw error;
  }
}

export function assertExpectedHash(snapshot: NoteSnapshot | null, expectedHash?: string) {
  if (!expectedHash) return;
  if (!snapshot || snapshot.hash !== expectedHash) {
    throw new Error(
      `note changed since it was read (expected ${expectedHash}, current ${snapshot?.hash ?? "missing"}); read it again before writing`,
    );
  }
}

export async function writeNoteContent(
  ctx: ToolContext,
  rawPath: string,
  content: string,
  options: {
    overwrite?: boolean;
    expectedHash?: string;
    dryRun?: boolean;
    existing?: NoteSnapshot | null;
  } = {},
) {
  const notePath = assertMarkdownPath(ctx.policy.assertWrite(rawPath));
  const existing = options.existing === undefined ? await readNoteIfExists(ctx, notePath) : options.existing;
  assertExpectedHash(existing, options.expectedHash);
  if (existing && options.overwrite === false) throw new Error(`note already exists: ${notePath}`);

  const beforeHash = existing?.hash ?? null;
  const afterHash = sha256(content);
  if (options.dryRun) {
    return {
      path: notePath,
      dryRun: true,
      wouldCreate: !existing,
      wouldChange: beforeHash !== afterHash,
      beforeHash,
      afterHash,
      size: Buffer.byteLength(content),
    };
  }

  const result = await ctx.client.put(`/api/files/${encodeVaultPath(notePath)}`, { content });
  return {
    path: notePath,
    created: !existing,
    changed: beforeHash !== afterHash,
    beforeHash,
    hash: afterHash,
    size: Buffer.byteLength(content),
    ...result,
  };
}

export async function listMarkdownPaths(
  ctx: ToolContext,
  rawPath = "",
  options: { recursive?: boolean; maxDepth?: number; limit?: number } = {},
): Promise<{ paths: string[]; total: number; truncated: boolean }> {
  const base = rawPath ? ctx.policy.assertBrowse(rawPath) : "";
  const params = new URLSearchParams({ ext: "md" });
  if (base) params.set("dir", base);
  if (options.recursive === false) params.set("depth", "0");
  else if (options.maxDepth !== undefined) params.set("depth", String(options.maxDepth));
  const result = await ctx.client.get(`/api/files?${params}`);
  const all = Array.isArray(result?.files)
    ? result.files.filter((candidate: unknown): candidate is string => typeof candidate === "string")
    : [];
  const allowed = all.filter((candidate: string) => {
    try { ctx.policy.assertRead(candidate); return true; } catch { return false; }
  });
  const limit = options.limit ?? 500;
  return { paths: allowed.slice(0, limit), total: allowed.length, truncated: allowed.length > limit };
}

export async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: boolean; item: T; result?: R; error?: string }>> {
  const output: Array<{ ok: boolean; item: T; result?: R; error?: string }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        output[index] = { ok: true, item: items[index], result: await fn(items[index]) };
      } catch (error: any) {
        output[index] = { ok: false, item: items[index], error: error?.message ?? String(error) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return output;
}

export function normalizeTag(raw: string): string {
  const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, "-");
  if (!tag || !/^[\p{L}\p{N}_/-]+$/u.test(tag)) throw new Error(`invalid Obsidian tag: ${raw}`);
  return tag;
}
