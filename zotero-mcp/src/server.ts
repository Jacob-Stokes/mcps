import { startMcp, fetchSecret } from "mcp-common";
import { ZoteroClient, ZoteroError } from "./zotero-client.js";
import { ITEMS_TOOL, ItemsInput, handleItems } from "./tools/items.js";
import { COLLECTIONS_TOOL, CollectionsInput, handleCollections } from "./tools/collections.js";
import { ATTACHMENTS_TOOL, AttachmentsInput, handleAttachments } from "./tools/attachments.js";
import { NOTES_TOOL, NotesInput, handleNotes } from "./tools/notes.js";
import { TAGS_TOOL, TagsInput, handleTags } from "./tools/tags.js";

const PORT = parseInt(process.env.PORT || "7012", 10);
const ZOTERO_BASE_URL = process.env.ZOTERO_BASE_URL || "https://api.zotero.org";
const ZOTERO_USER_ID = process.env.ZOTERO_USER_ID;
if (!ZOTERO_USER_ID) { console.error("FATAL: ZOTERO_USER_ID env var required"); process.exit(1); }
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const apiToken = process.env.ZOTERO_API_TOKEN
  ? (console.log("zotero api token: from env"), process.env.ZOTERO_API_TOKEN)
  : (console.log("zotero api token: fetching from Infisical"), await fetchSecret("ZOTERO_API_TOKEN"));

const client = new ZoteroClient(ZOTERO_BASE_URL, ZOTERO_USER_ID, apiToken);
try {
  const { data } = await client.get<any>(`/keys/${apiToken}`);
  console.log(`zotero connectivity: ok (${ZOTERO_BASE_URL}, user=${data.username}, id=${data.userID})`);
} catch (e: any) {
  console.error(`zotero connectivity FAILED at ${ZOTERO_BASE_URL}:`, e.message);
  process.exit(1);
}

const oauth = process.env.MCP_OAUTH_ISSUER
  ? {
      issuer: process.env.MCP_OAUTH_ISSUER,
      canonicalUrl: process.env.MCP_OAUTH_CANONICAL_URL!,
      audience: process.env.MCP_OAUTH_AUDIENCE,
      scopesSupported: (process.env.MCP_OAUTH_SCOPES || "openid email profile").split(/\s+/),
    }
  : undefined;

await startMcp({
  name: "zotero-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...ITEMS_TOOL, inputSchema: ItemsInput }, handler: (i) => handleItems(client, i) },
    { def: { ...COLLECTIONS_TOOL, inputSchema: CollectionsInput }, handler: (i) => handleCollections(client, i) },
    { def: { ...ATTACHMENTS_TOOL, inputSchema: AttachmentsInput }, handler: (i) => handleAttachments(client, i) },
    { def: { ...NOTES_TOOL, inputSchema: NotesInput }, handler: (i) => handleNotes(client, i) },
    { def: { ...TAGS_TOOL, inputSchema: TagsInput }, handler: (i) => handleTags(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof ZoteroError) {
      return `zotero error: ${e.method} ${e.path} → HTTP ${e.status}: ${JSON.stringify(e.detail).slice(0, 200)}`;
    }
    return null;
  },
});
