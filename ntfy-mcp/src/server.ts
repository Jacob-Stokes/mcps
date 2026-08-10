import { startMcp } from "mcp-common";
import { NtfyClient, NtfyError } from "./ntfy-client.js";
import { PUBLISH_TOOL, PublishInput, handlePublish, RECENT_TOOL, RecentInput, handleRecent } from "./tools/publish.js";

const PORT = parseInt(process.env.PORT || "7005", 10);
const NTFY_BASE_URL = process.env.NTFY_BASE_URL || "http://ntfy:80";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const client = new NtfyClient(NTFY_BASE_URL);
try {
  const res = await fetch(`${NTFY_BASE_URL}/v1/health`);
  if (!res.ok) throw new Error(`ntfy health HTTP ${res.status}`);
  console.log(`ntfy connectivity: ok (${NTFY_BASE_URL})`);
} catch (e: any) {
  console.error(`ntfy connectivity FAILED at ${NTFY_BASE_URL}:`, e.message);
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
  name: "ntfy-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...PUBLISH_TOOL, inputSchema: PublishInput }, handler: (i) => handlePublish(client, i) },
    { def: { ...RECENT_TOOL,  inputSchema: RecentInput },  handler: (i) => handleRecent(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof NtfyError) return `ntfy error: HTTP ${e.status}: ${e.body.slice(0, 200)}`;
    return null;
  },
});
