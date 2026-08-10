// obsidian-mcp — typed MCP wrapping Jacob's obsidian-landing API. Port 7002.
//
// Shared transport + schema + Infisical plumbing lives in `mcp-common`;
// this file is config + backend client + tool registration.

import { startMcp, fetchSecret } from "mcp-common";
import { ObsidianClient, ObsidianError } from "./obsidian-client.js";

import { FILES_TOOL, FilesInput, handleFiles } from "./tools/files.js";
import { FOLDERS_TOOL, FoldersInput, handleFolders } from "./tools/folders.js";
import { SEARCH_TOOL, SearchInput, handleSearch } from "./tools/search.js";
import { DAILY_TOOL, DailyInput, handleDaily } from "./tools/daily.js";

const PORT = parseInt(process.env.PORT || "7002", 10);
const OBSIDIAN_BASE_URL = process.env.OBSIDIAN_BASE_URL || "http://obsidian-landing:3099";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const apiKey = process.env.OBSIDIAN_API_KEY
  ? (console.log("obsidian api key: from env"), process.env.OBSIDIAN_API_KEY)
  : (console.log("obsidian api key: fetching from Infisical"), await fetchSecret("OBSIDIAN_API_KEY"));

const client = new ObsidianClient(OBSIDIAN_BASE_URL, apiKey);

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
      scopesSupported: (process.env.MCP_OAUTH_SCOPES || "openid email profile").split(/\s+/),
    }
  : undefined;

await startMcp({
  name: "obsidian-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...FILES_TOOL,   inputSchema: FilesInput },   handler: (i) => handleFiles(client, i) },
    { def: { ...FOLDERS_TOOL, inputSchema: FoldersInput }, handler: (i) => handleFolders(client, i) },
    { def: { ...SEARCH_TOOL,  inputSchema: SearchInput },  handler: (i) => handleSearch(client, i) },
    { def: { ...DAILY_TOOL,   inputSchema: DailyInput },   handler: (i) => handleDaily(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof ObsidianError) {
      const detail = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
      return `obsidian API error: ${e.method} ${e.path} → HTTP ${e.status}: ${detail}`;
    }
    return null;
  },
});
