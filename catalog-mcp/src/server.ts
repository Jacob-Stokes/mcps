// catalog-mcp — typed MCP wrapping the homelab catalog service. Port 7003.
//
// Shared transport + schema + Infisical plumbing lives in `mcp-common`;
// this file is config + backend client + tool registration.

import { startMcp, fetchSecret } from "mcp-common";
import { CatalogClient, CatalogError } from "./catalog-client.js";

import { SERVICES_TOOL, ServicesInput, handleServices } from "./tools/services.js";
import { GLOSSARY_TOOL, GlossaryInput, handleGlossary } from "./tools/glossary.js";
import { INFRASTRUCTURE_TOOL, InfrastructureInput, handleInfrastructure } from "./tools/infrastructure.js";

const PORT = parseInt(process.env.PORT || "7003", 10);
const CATALOG_BASE_URL = process.env.CATALOG_BASE_URL || "http://catalog:3000";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const apiKey = process.env.CATALOG_API_KEY
  ? (console.log("catalog api key: from env"), process.env.CATALOG_API_KEY)
  : (console.log("catalog api key: fetching from Infisical"), await fetchSecret("CATALOG_API_KEY"));

const client = new CatalogClient(CATALOG_BASE_URL, apiKey);

try {
  const health = await client.get("/api/health");
  console.log(`catalog connectivity: ok (${CATALOG_BASE_URL}) — service=${health?.service}`);
} catch (e: any) {
  console.error(`catalog connectivity FAILED at ${CATALOG_BASE_URL}:`, e.message);
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
  name: "catalog-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...SERVICES_TOOL,       inputSchema: ServicesInput },       handler: (i) => handleServices(client, i) },
    { def: { ...GLOSSARY_TOOL,       inputSchema: GlossaryInput },       handler: (i) => handleGlossary(client, i) },
    { def: { ...INFRASTRUCTURE_TOOL, inputSchema: InfrastructureInput }, handler: (i) => handleInfrastructure(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof CatalogError) {
      const detail = typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail);
      return `catalog API error: ${e.method} ${e.path} → HTTP ${e.status}: ${detail}`;
    }
    return null;
  },
});
