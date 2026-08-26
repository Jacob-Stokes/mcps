// obsidian-mcp — typed MCP wrapping Jacob's obsidian-landing API. Port 7002.
//
// Shared transport + schema + Infisical plumbing lives in `mcp-common`;
// this file is config + backend client + tool registration.

import { startMcp, fetchSecret } from "mcp-common";
import { ObsidianClient, ObsidianError } from "./obsidian-client.js";
import { normalizeVaultPath, VaultPolicy, type ToolContext } from "./lib/vault.js";

import { FILES_TOOL, FilesInput, handleFiles } from "./tools/files.js";
import { FOLDERS_TOOL, FoldersInput, handleFolders } from "./tools/folders.js";
import { SEARCH_TOOL, SearchInput } from "./tools/search.js";
import { DAILY_TOOL, DailyInput, handleDaily } from "./tools/daily.js";
import {
  GET_NOTE_TOOL, GetNoteInput, handleGetNote,
  LIST_NOTES_TOOL, ListNotesInput, handleListNotes,
  WRITE_NOTE_TOOL, WriteNoteInput, handleWriteNote,
  APPEND_NOTE_TOOL, AppendNoteInput, handleAppendNote,
  PATCH_NOTE_TOOL, PatchNoteInput, handlePatchNote,
  REPLACE_NOTE_TOOL, ReplaceNoteInput, handleReplaceNote,
  MOVE_NOTE_TOOL, MoveNoteInput, handleMoveNote,
  DELETE_NOTE_TOOL, DeleteNoteInput, handleDeleteNote,
} from "./tools/notes.js";
import { SEARCH_NOTES_TOOL, SearchNotesInput, handleSearchNotes } from "./tools/search-notes.js";
import {
  FRONTMATTER_TOOL, FrontmatterInput, handleFrontmatter,
  TAGS_TOOL, TagsInput, handleTags,
} from "./tools/metadata.js";
import { LINKS_TOOL, LinksInput, handleLinks } from "./tools/links.js";
import { BULK_TOOL, BulkInput, handleBulk } from "./tools/bulk.js";
import { ATTACHMENTS_TOOL, AttachmentsInput, handleAttachments } from "./tools/attachments.js";
import { STATUS_TOOL, StatusInput, handleStatus } from "./tools/status.js";

const PORT = parseInt(process.env.PORT || "7002", 10);
const OBSIDIAN_BASE_URL = process.env.OBSIDIAN_BASE_URL || "http://obsidian-landing:3099";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const apiKey = process.env.OBSIDIAN_API_KEY
  ? (console.log("obsidian api key: from env"), process.env.OBSIDIAN_API_KEY)
  : (console.log("obsidian api key: fetching from Infisical"), await fetchSecret("OBSIDIAN_API_KEY"));

const client = new ObsidianClient(OBSIDIAN_BASE_URL, apiKey);
const policy = new VaultPolicy();
const context: ToolContext = {
  client,
  policy,
  dailyFolder: normalizeVaultPath(process.env.OBSIDIAN_DAILY_FOLDER || "Journal"),
  timeZone: process.env.OBSIDIAN_TIMEZONE || "UTC",
  maxAttachmentBytes: parseInt(process.env.OBSIDIAN_MAX_ATTACHMENT_BYTES || String(10 * 1024 * 1024), 10),
};

if (!Number.isSafeInteger(context.maxAttachmentBytes) || context.maxAttachmentBytes <= 0) {
  console.error("FATAL: OBSIDIAN_MAX_ATTACHMENT_BYTES must be a positive integer");
  process.exit(1);
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const IDEMPOTENT_WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;
const MUTATING = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

try {
  new Intl.DateTimeFormat("en-CA", { timeZone: context.timeZone }).format(new Date());
} catch {
  console.error(`FATAL: invalid OBSIDIAN_TIMEZONE: ${context.timeZone}`);
  process.exit(1);
}

try {
  await client.get("/api/folders");
  console.log(`obsidian connectivity: ok (${OBSIDIAN_BASE_URL})`);
} catch (e: any) {
  console.error(`obsidian connectivity FAILED at ${OBSIDIAN_BASE_URL}:`, e.message);
  process.exit(1);
}

// OAuth is opt-in. Set MCP_OAUTH_ISSUER + MCP_OAUTH_CANONICAL_URL to enable.
// Bot + CLI continue working on static bearer regardless.
const oauth = process.env.MCP_OAUTH_ISSUER
  ? {
      issuer: process.env.MCP_OAUTH_ISSUER,
      canonicalUrl: process.env.MCP_OAUTH_CANONICAL_URL!,
      jwksUri: process.env.MCP_OAUTH_JWKS_URI,
      audience: process.env.MCP_OAUTH_AUDIENCE, // e.g. Authentik client_id
      scopesSupported: (process.env.MCP_OAUTH_SCOPES || "openid email profile offline_access").split(/\s+/),
    }
  : undefined;

await startMcp({
  name: "obsidian-mcp",
  version: "1.0.0",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  instructions:
    "This is the remote, server-side Obsidian vault integration. Read Home.md when present before choosing where to write. " +
    "Prefer focused tools over deprecated compatibility tools; use expected_hash for read-modify-write work and dry_run for broad changes. " +
    "Desktop UI, workspace and command-palette operations require the separate local companion and are intentionally unavailable here.",
  tools: [
    { def: { ...GET_NOTE_TOOL,     inputSchema: GetNoteInput,     annotations: READ_ONLY },        handler: (i) => handleGetNote(context, i) },
    { def: { ...LIST_NOTES_TOOL,   inputSchema: ListNotesInput,   annotations: READ_ONLY },        handler: (i) => handleListNotes(context, i) },
    { def: { ...SEARCH_NOTES_TOOL, inputSchema: SearchNotesInput, annotations: READ_ONLY },        handler: (i) => handleSearchNotes(context, i) },
    { def: { ...WRITE_NOTE_TOOL,   inputSchema: WriteNoteInput,   annotations: IDEMPOTENT_WRITE }, handler: (i) => handleWriteNote(context, i) },
    { def: { ...APPEND_NOTE_TOOL,  inputSchema: AppendNoteInput,  annotations: MUTATING },         handler: (i) => handleAppendNote(context, i) },
    { def: { ...PATCH_NOTE_TOOL,   inputSchema: PatchNoteInput,   annotations: MUTATING },         handler: (i) => handlePatchNote(context, i) },
    { def: { ...REPLACE_NOTE_TOOL, inputSchema: ReplaceNoteInput, annotations: IDEMPOTENT_WRITE }, handler: (i) => handleReplaceNote(context, i) },
    { def: { ...MOVE_NOTE_TOOL,    inputSchema: MoveNoteInput,    annotations: MUTATING },         handler: (i) => handleMoveNote(context, i) },
    { def: { ...DELETE_NOTE_TOOL,  inputSchema: DeleteNoteInput,  annotations: MUTATING },         handler: (i) => handleDeleteNote(context, i) },
    { def: { ...FRONTMATTER_TOOL,  inputSchema: FrontmatterInput, annotations: IDEMPOTENT_WRITE }, handler: (i) => handleFrontmatter(context, i) },
    { def: { ...TAGS_TOOL,         inputSchema: TagsInput,        annotations: IDEMPOTENT_WRITE }, handler: (i) => handleTags(context, i) },
    { def: { ...LINKS_TOOL,        inputSchema: LinksInput,       annotations: READ_ONLY },        handler: (i) => handleLinks(context, i) },
    { def: { ...BULK_TOOL,         inputSchema: BulkInput,        annotations: MUTATING },         handler: (i) => handleBulk(context, i) },
    { def: { ...DAILY_TOOL,        inputSchema: DailyInput,       annotations: MUTATING },         handler: (i) => handleDaily(context, i) },
    { def: { ...ATTACHMENTS_TOOL,  inputSchema: AttachmentsInput, annotations: MUTATING },         handler: (i) => handleAttachments(context, i) },
    { def: { ...STATUS_TOOL,       inputSchema: StatusInput,      annotations: READ_ONLY },        handler: () => handleStatus(context) },

    // Compatibility aliases retained for existing agents and automations.
    { def: { ...FILES_TOOL,   inputSchema: FilesInput,   annotations: MUTATING },  handler: (i) => handleFiles(context, i) },
    { def: { ...FOLDERS_TOOL, inputSchema: FoldersInput, annotations: READ_ONLY }, handler: (i) => handleFolders(context, i) },
    { def: { ...SEARCH_TOOL,  inputSchema: SearchInput,  annotations: READ_ONLY }, handler: (i) => handleSearchNotes(context, {
      mode: i.regex ? "regex" : "text",
      query: i.q,
      path: i.path,
      case_sensitive: i.case_sensitive,
      max_results: i.max_results,
      max_scan: 1000,
    }) },
  ],
  onBackendError: (e) => {
    if (e instanceof ObsidianError) {
      const detail = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
      return `obsidian API error: ${e.method} ${e.path} → HTTP ${e.status}: ${detail}`;
    }
    return null;
  },
});
