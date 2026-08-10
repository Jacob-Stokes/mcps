import { startMcp, fetchSecret } from "mcp-common";
import { AnkiClient, AnkiError } from "./anki-client.js";
import { NOTES_TOOL, NotesInput, handleNotes } from "./tools/notes.js";
import { METADATA_TOOL, MetadataInput, handleMetadata } from "./tools/metadata.js";
import { SYNC_TOOL, SyncInput, handleSync } from "./tools/sync.js";

const PORT = parseInt(process.env.PORT || "7006", 10);
const ANKI_BASE_URL = process.env.ANKI_BASE_URL || "http://anki-desktop:8765";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const apiKey = process.env.ANKI_CONNECT_API_KEY
  ? (console.log("anki api key: from env"), process.env.ANKI_CONNECT_API_KEY)
  : (console.log("anki api key: fetching from Infisical"), await fetchSecret("ANKI_CONNECT_API_KEY"));

const client = new AnkiClient(ANKI_BASE_URL, apiKey);
try {
  const v = await client.invoke<number>("version");
  console.log(`anki connectivity: ok (${ANKI_BASE_URL}, AnkiConnect v${v})`);
} catch (e: any) {
  console.error(`anki connectivity FAILED at ${ANKI_BASE_URL}:`, e.message);
  process.exit(1);
}

const oauth = process.env.MCP_OAUTH_ISSUER
  ? {
      issuer: process.env.MCP_OAUTH_ISSUER,
      canonicalUrl: process.env.MCP_OAUTH_CANONICAL_URL!,
      jwksUri: process.env.MCP_OAUTH_JWKS_URI,
      audience: process.env.MCP_OAUTH_AUDIENCE,
      scopesSupported: (process.env.MCP_OAUTH_SCOPES || "openid email profile").split(/\s+/),
    }
  : undefined;

await startMcp({
  name: "anki-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...NOTES_TOOL, inputSchema: NotesInput }, handler: (i) => handleNotes(client, i) },
    { def: { ...METADATA_TOOL, inputSchema: MetadataInput }, handler: (i) => handleMetadata(client, i) },
    { def: { ...SYNC_TOOL, inputSchema: SyncInput }, handler: (i) => handleSync(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof AnkiError) return `anki error: ${e.action}: ${e.detail}`;
    return null;
  },
});
