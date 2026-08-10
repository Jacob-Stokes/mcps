import { startMcp, fetchSecret } from "mcp-common";
import { GrimmoryClient, GrimmoryError } from "./grimmory-client.js";
import { SEARCH_TOOL, SearchInput, handleSearch } from "./tools/search.js";
import { BOOKS_TOOL, BooksInput, handleBooks } from "./tools/books.js";
import { READ_STATUS_TOOL, ReadStatusInput, handleReadStatus } from "./tools/read-status.js";

const PORT = parseInt(process.env.PORT || "7007", 10);
const GRIMMORY_BASE_URL = process.env.GRIMMORY_BASE_URL || "http://grimmory:6060";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const user = process.env.GRIMMORY_USERNAME ?? await fetchSecret("GRIMMORY_USERNAME");
const pass = process.env.GRIMMORY_PASSWORD ?? await fetchSecret("GRIMMORY_PASSWORD");
console.log(`grimmory credentials: loaded (user=${user.slice(0,3)}…)`);

const client = new GrimmoryClient(GRIMMORY_BASE_URL, user, pass);
try {
  await client.get("/api/v1/libraries");
  console.log(`grimmory connectivity: ok (${GRIMMORY_BASE_URL})`);
} catch (e: any) {
  console.error(`grimmory connectivity FAILED at ${GRIMMORY_BASE_URL}:`, e.message);
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
  name: "grimmory-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...SEARCH_TOOL, inputSchema: SearchInput }, handler: (i) => handleSearch(client, i) },
    { def: { ...BOOKS_TOOL, inputSchema: BooksInput }, handler: (i) => handleBooks(client, i) },
    { def: { ...READ_STATUS_TOOL, inputSchema: ReadStatusInput }, handler: (i) => handleReadStatus(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof GrimmoryError) return `grimmory error: ${e.method} ${e.path} → HTTP ${e.status}: ${JSON.stringify(e.detail).slice(0,200)}`;
    return null;
  },
});
