import { startMcp, fetchSecret } from "mcp-common";
import { FreshrssClient, FreshrssError } from "./freshrss-client.js";
import { FEEDS_TOOL, FeedsInput, handleFeeds } from "./tools/feeds.js";
import { ITEMS_TOOL, ItemsInput, handleItems } from "./tools/items.js";
import { MARK_TOOL, MarkInput, handleMark } from "./tools/mark.js";

const PORT = parseInt(process.env.PORT || "7009", 10);
const FRESHRSS_BASE_URL = process.env.FRESHRSS_BASE_URL || "http://freshrss/FreshRSS/p";
const FRESHRSS_USER = process.env.FRESHRSS_USER || "jacob-admin";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

// FreshRSS API password — set in UI (Settings → Authentication → API password).
// Hash lives at /data/users/<user>/config.php:apiPasswordHash, but the
// plaintext has to be stashed in Infisical (or an env) for the MCP to use.
const apiPassword = process.env.FRESHRSS_API_TOKEN
  ? (console.log("freshrss api token: from env"), process.env.FRESHRSS_API_TOKEN)
  : (console.log("freshrss api token: fetching from Infisical"), await fetchSecret("FRESHRSS_API_TOKEN"));

const client = new FreshrssClient(FRESHRSS_BASE_URL, FRESHRSS_USER, apiPassword);
try {
  await client.ping();
  console.log(`freshrss connectivity: ok (${FRESHRSS_BASE_URL}, user=${FRESHRSS_USER})`);
} catch (e: any) {
  console.error(`freshrss connectivity FAILED at ${FRESHRSS_BASE_URL}:`, e.message);
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
  name: "freshrss-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...FEEDS_TOOL, inputSchema: FeedsInput }, handler: (i) => handleFeeds(client, i) },
    { def: { ...ITEMS_TOOL, inputSchema: ItemsInput }, handler: (i) => handleItems(client, i) },
    { def: { ...MARK_TOOL, inputSchema: MarkInput }, handler: (i) => handleMark(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof FreshrssError) {
      return `freshrss error: ${e.method} ${e.path} → HTTP ${e.status}: ${JSON.stringify(e.detail).slice(0, 200)}`;
    }
    return null;
  },
});
