import { startMcp, fetchSecret } from "mcp-common";
import { LinkdingClient, LinkdingError } from "./linkding-client.js";
import { BOOKMARKS_TOOL, BookmarksInput, handleBookmarks } from "./tools/bookmarks.js";
import { TAGS_TOOL, TagsInput, handleTags } from "./tools/tags.js";

const PORT = parseInt(process.env.PORT || "7010", 10);
const LINKDING_BASE_URL = process.env.LINKDING_BASE_URL || "http://linkding:9090";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const apiToken = process.env.LINKDING_API_TOKEN
  ? (console.log("linkding api token: from env"), process.env.LINKDING_API_TOKEN)
  : (console.log("linkding api token: fetching from Infisical"), await fetchSecret("LINKDING_API_TOKEN"));

const client = new LinkdingClient(LINKDING_BASE_URL, apiToken);
try {
  // /api/bookmarks/ with limit=1 is the cheapest auth-probing call.
  await client.get(`/api/bookmarks/?limit=1`);
  console.log(`linkding connectivity: ok (${LINKDING_BASE_URL})`);
} catch (e: any) {
  console.error(`linkding connectivity FAILED at ${LINKDING_BASE_URL}:`, e.message);
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
  name: "linkding-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...BOOKMARKS_TOOL, inputSchema: BookmarksInput }, handler: (i) => handleBookmarks(client, i) },
    { def: { ...TAGS_TOOL, inputSchema: TagsInput }, handler: (i) => handleTags(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof LinkdingError) {
      return `linkding error: ${e.method} ${e.path} → HTTP ${e.status}: ${JSON.stringify(e.detail).slice(0, 200)}`;
    }
    return null;
  },
});
