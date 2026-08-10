import { startMcp } from "mcp-common";
import { CostTrackerClient, CostTrackerError } from "./cost-tracker-client.js";
import { STATS_TOOL, StatsInput, handleStats } from "./tools/stats.js";
import { USAGE_TOOL, UsageInput, handleUsage } from "./tools/usage.js";

const PORT = parseInt(process.env.PORT || "7013", 10);
const COST_TRACKER_BASE_URL = process.env.COST_TRACKER_BASE_URL || "http://cost-tracker:3200";
const COST_TRACKER_API_KEY = process.env.COST_TRACKER_API_KEY;
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;

if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }
if (!COST_TRACKER_API_KEY) { console.error("FATAL: COST_TRACKER_API_KEY env var required"); process.exit(1); }

const client = new CostTrackerClient(COST_TRACKER_BASE_URL, COST_TRACKER_API_KEY);

try {
  await client.stats({});
  console.log(`cost-tracker connectivity: ok (${COST_TRACKER_BASE_URL})`);
} catch (e: any) {
  console.error(`cost-tracker connectivity FAILED at ${COST_TRACKER_BASE_URL}:`, e.message);
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
  name: "cost-tracker-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...STATS_TOOL, inputSchema: StatsInput }, handler: (i) => handleStats(client, i) },
    { def: { ...USAGE_TOOL, inputSchema: UsageInput }, handler: (i) => handleUsage(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof CostTrackerError) return `cost-tracker error: HTTP ${e.status}: ${e.body.slice(0, 200)}`;
    return null;
  },
});
