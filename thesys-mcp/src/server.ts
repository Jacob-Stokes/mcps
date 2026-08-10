// thesys-mcp — typed MCP wrapping Jacob's thesys REST API.
// Runs as sidecar in the thesys compose stack. Port 7001.
//
// Shared transport + schema + Infisical plumbing lives in `mcp-common`;
// this file is just: config, backend-client setup, tool registration.

import { startMcp, fetchSecret } from "mcp-common";
import { ThesysClient, ThesysError } from "./thesys-client.js";

import { TASKS_TOOL, TasksInput, handleTasks } from "./tools/tasks.js";
import { EVENTS_TOOL, EventsInput, handleEvents } from "./tools/events.js";
import { HABITS_TOOL, HabitsInput, handleHabits } from "./tools/habits.js";
import { SHOPPING_TOOL, ShoppingInput, handleShopping } from "./tools/shopping.js";
import { PARSE_TOOL, ParseInput, handleParse } from "./tools/parse.js";

const PORT = parseInt(process.env.PORT || "7001", 10);
const THESYS_BASE_URL = process.env.THESYS_BASE_URL || "http://thesys:3000/api";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

// Resolve backend API key (env preferred; Infisical fallback).
const apiKey = process.env.THESYS_API_KEY
  ? (console.log("thesys api key: from env"), process.env.THESYS_API_KEY)
  : (console.log("thesys api key: fetching from Infisical"), await fetchSecret("THESYS_API_KEY"));

const client = new ThesysClient(THESYS_BASE_URL, apiKey);

// Sanity ping — fail loudly at boot rather than later.
try {
  await client.get("/tasks?status=todo");
  console.log(`thesys connectivity: ok (${THESYS_BASE_URL})`);
} catch (e: any) {
  console.error(`thesys connectivity FAILED at ${THESYS_BASE_URL}:`, e.message);
  process.exit(1);
}

// OAuth opt-in. Set MCP_OAUTH_ISSUER + MCP_OAUTH_AUDIENCE to enable dual-auth.
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
  name: "thesys-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...TASKS_TOOL,    inputSchema: TasksInput },    handler: (i) => handleTasks(client, i) },
    { def: { ...EVENTS_TOOL,   inputSchema: EventsInput },   handler: (i) => handleEvents(client, i) },
    { def: { ...HABITS_TOOL,   inputSchema: HabitsInput },   handler: (i) => handleHabits(client, i) },
    { def: { ...SHOPPING_TOOL, inputSchema: ShoppingInput }, handler: (i) => handleShopping(client, i) },
    { def: { ...PARSE_TOOL,    inputSchema: ParseInput },    handler: (i) => handleParse(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof ThesysError) {
      const detail = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
      return `thesys API error: ${e.method} ${e.path} → HTTP ${e.status}: ${detail}`;
    }
    return null;
  },
});
