// gateway-mcp — aggregates multiple backend MCPs behind one OAuth-protected
// endpoint. Admin toggles which backends participate; disabled ones drop
// out of the tools/list response so they don't eat input tokens.
//
// Routes:
//   POST /mcp                                   — MCP streamable HTTP (bearer OR OAuth)
//   GET  /mcp                                   — same (reconnect)
//   GET  /health                                — public liveness
//   GET  /.well-known/oauth-protected-resource  — OAuth 2.1 resource metadata
//   GET  /.well-known/oauth-authorization-server — AS metadata (DCR shim only)
//   POST /register                              — RFC 7591 shim (DCR shim only)
//   GET  /admin                                 — admin HTML (CF Access gated)
//   POST /admin/save                            — save config from form (CF Access gated)
//
// See the mcps monorepo for sibling MCPs.

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { Backend, type BackendTool } from "./backend-client.js";
import { loadConfig, saveConfig, type GatewayConfig, type BackendConfig } from "./config.js";
import { renderAdminPage } from "./admin-ui.js";
import { buildAuthorizationServerMetadata, parseOAuthScopes } from "./oauth-metadata.js";

const PORT = parseInt(process.env.PORT || "7000", 10);
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

// Optional hint surfaced to the connecting model in the MCP `initialize`
// response — e.g. telling it to check a docs tool before responding.
// Deployment-specific, so it's opt-in via env rather than hardcoded here.
const MCP_INSTRUCTIONS = process.env.MCP_INSTRUCTIONS;

// OAuth config — required for public exposure.
const oauth = process.env.MCP_OAUTH_ISSUER
  ? {
      issuer: process.env.MCP_OAUTH_ISSUER,
      canonicalUrl: process.env.MCP_OAUTH_CANONICAL_URL!,
      jwksUri: process.env.MCP_OAUTH_JWKS_URI,
      audience: process.env.MCP_OAUTH_AUDIENCE,
      scopesSupported: parseOAuthScopes(process.env.MCP_OAUTH_SCOPES),
    }
  : undefined;

// ----- Dynamic backend registry -----
let config: GatewayConfig = loadConfig();
const backends = new Map<string, Backend>();
const toolNameToBackend = new Map<string, Backend>();

async function reload(): Promise<void> {
  // Close out anything removed / reload all on every change.
  for (const b of backends.values()) await b.close();
  backends.clear();
  toolNameToBackend.clear();

  for (const cfg of config.backends) {
    const bearer = process.env[cfg.bearerEnv];
    if (!bearer) {
      console.error(`gateway: missing env ${cfg.bearerEnv} for backend ${cfg.name} — skipping`);
      continue;
    }
    const b = new Backend(cfg, bearer);
    backends.set(cfg.name, b);
  }

  // Discover tools from every backend (even disabled ones — admin UI
  // displays token cost per backend for "what would I save by disabling").
  await Promise.all(Array.from(backends.values()).map((b) => b.discoverTools()));

  rebuildRouting();
}

// Only enabled backends go into the routing map (name -> backend).
function rebuildRouting(): void {
  toolNameToBackend.clear();
  for (const b of backends.values()) {
    if (!b.cfg.enabled) continue;
    for (const t of b.tools) {
      if (toolNameToBackend.has(t.name)) {
        console.error(`gateway: WARN duplicate tool name '${t.name}' from ${b.cfg.name} — ignoring (first wins)`);
        continue;
      }
      toolNameToBackend.set(t.name, b);
    }
  }
}

// Re-attempt discovery for backends that errored (e.g. gateway booted
// before they were listening — the standard post-reboot race). Throttled
// per backend so hot paths (tools/list, /admin) stay cheap; also run on a
// timer so the gateway self-heals even with zero traffic.
const RETRY_MIN_INTERVAL_MS = 15_000;
let retryInFlight: Promise<void> | null = null;

function retryErroredBackends(): Promise<void> {
  if (retryInFlight) return retryInFlight;
  const now = Date.now();
  const stale = Array.from(backends.values()).filter(
    (b) => b.error !== null && now - b.lastAttemptMs >= RETRY_MIN_INTERVAL_MS,
  );
  if (stale.length === 0) return Promise.resolve();
  retryInFlight = (async () => {
    await Promise.all(stale.map((b) => b.discoverTools()));
    if (stale.some((b) => b.error === null)) rebuildRouting();
  })().finally(() => { retryInFlight = null; });
  return retryInFlight;
}

function advertisedTools(): BackendTool[] {
  return Array.from(backends.values())
    .filter((b) => b.cfg.enabled)
    .flatMap((b) => b.tools);
}

// ----- Dynamic client registration shim (RFC 7591) -----
//
// Authentik has no registration endpoint (goauthentik/authentik#8751), so
// DCR-only clients — codex, Claude Code, VS Code — abort before the browser
// flow ever opens: "Dynamic client registration not supported". The MCP spec
// lists pre-registered client info as a valid alternative, but those clients
// give you nowhere to put it.
//
// So the gateway answers /register itself, always handing back the same
// pre-created Authentik client. Nothing is really registered. The client
// then runs an ordinary authorization-code flow against Authentik, and
// Authentik's own login still gates every token that gets issued.
//
// MUST be a PUBLIC (PKCE, secretless) Authentik client: /register is
// unauthenticated and world-reachable, so anything returned here is public
// by definition. MCP_DCR_CLIENT_SECRET exists only for the confidential
// case and should stay unset.
//
// Unset MCP_DCR_CLIENT_ID and every route below disappears — the gateway
// reverts to advertising Authentik directly, exactly as before.
const dcrClientId = process.env.MCP_DCR_CLIENT_ID;
const dcrClientSecret = process.env.MCP_DCR_CLIENT_SECRET;
const registrationPath = "/register";
const asMetadataPath = "/.well-known/oauth-authorization-server";
let asMetadataCache: { at: number; doc: Record<string, any> } | null = null;

async function authServerMetadata(): Promise<Record<string, any>> {
  if (asMetadataCache && Date.now() - asMetadataCache.at < 600_000) return asMetadataCache.doc;
  const upstreamUrl = new URL(".well-known/openid-configuration", oauth!.issuer).toString();
  const r = await fetch(upstreamUrl);
  if (!r.ok) throw new Error(`upstream metadata ${r.status} from ${upstreamUrl}`);
  const upstream: Record<string, any> = await r.json();
  const doc = buildAuthorizationServerMetadata(
    upstream,
    oauth!.canonicalUrl,
    registrationPath,
    Boolean(dcrClientSecret),
  );
  asMetadataCache = { at: Date.now(), doc };
  return doc;
}

// ----- OAuth + bearer auth (same shape as mcp-common transport) -----
let jwks: JWTVerifyGetKey | null = null;
let protectedResourceMetadata: Record<string, any> | null = null;
const resourceMetadataPath = "/.well-known/oauth-protected-resource";

if (oauth) {
  const jwksUri = oauth.jwksUri ?? new URL("jwks/", oauth.issuer).toString();
  jwks = createRemoteJWKSet(new URL(jwksUri), { cacheMaxAge: 600_000, cooldownDuration: 30_000 });
  protectedResourceMetadata = {
    resource: oauth.canonicalUrl,
    // With the DCR shim on, point clients at ourselves so they discover the
    // metadata that advertises registration_endpoint.
    authorization_servers: [dcrClientId ? oauth.canonicalUrl : oauth.issuer],
    bearer_methods_supported: ["header"],
    scopes_supported: oauth.scopesSupported,
    resource_documentation: `${oauth.canonicalUrl}/health`,
  };
}

async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const auth = req.headers.authorization;
  if (!auth || !auth.toLowerCase().startsWith("bearer ")) return fail(res, "missing_token");
  const token = auth.slice(7).trim();
  if (token === MCP_BEARER_TOKEN) return true;
  if (oauth && jwks) {
    try {
      await jwtVerify(token, jwks, { issuer: oauth.issuer, audience: oauth.audience ?? oauth.canonicalUrl });
      return true;
    } catch { /* fall through */ }
  }
  return fail(res, "invalid_token");
}
function fail(res: ServerResponse, err: string): false {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (oauth) {
    headers["WWW-Authenticate"] = `Bearer error="${err}", resource_metadata="${oauth.canonicalUrl}${resourceMetadataPath}"`;
  } else {
    headers["WWW-Authenticate"] = `Bearer error="${err}"`;
  }
  res.writeHead(401, headers);
  res.end(JSON.stringify({ error: err }));
  return false;
}

// ----- MCP server factory (one per session) -----
const streamableTransports = new Map<string, StreamableHTTPServerTransport>();

function buildServer(): Server {
  const server = new Server(
    { name: "gateway-mcp", version: "0.1.0" },
    { capabilities: { tools: {} }, ...(MCP_INSTRUCTIONS ? { instructions: MCP_INSTRUCTIONS } : {}) },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await retryErroredBackends();
    return {
    tools: advertisedTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
    })),
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const backend = toolNameToBackend.get(name);
    if (!backend) {
      return { isError: true, content: [{ type: "text", text: `unknown tool: ${name}` }] };
    }
    try {
      const result = await backend.callTool(name, args);
      return result as any;
    } catch (e: any) {
      return { isError: true, content: [{ type: "text", text: `gateway: ${backend.cfg.name} failed: ${e.message ?? String(e)}` }] };
    }
  });

  return server;
}

// ----- Admin helpers -----
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function parseFormEnabled(body: string): Set<string> {
  const params = new URLSearchParams(body);
  return new Set(params.getAll("enabled"));
}

// Field inputs for existing backends are named `<field>__<backendName>` so a
// single flat form can edit every row without index bookkeeping. Backend
// names are simple identifiers (checked at add-time), so this can't collide
// with an embedded "__" in a legitimate field name.
function parseFieldEdits(body: string, field: string, names: string[]): Map<string, string> {
  const params = new URLSearchParams(body);
  const out = new Map<string, string>();
  for (const name of names) {
    const v = params.get(`${field}__${name}`);
    if (v !== null) out.set(name, v);
  }
  return out;
}

// ----- HTTP server -----
await reload();
console.log(`gateway-mcp booted — ${backends.size} backends configured`);

// Self-heal loop: pick up errored backends without waiting for traffic.
setInterval(() => { retryErroredBackends().catch(() => {}); }, 30_000).unref();

const httpServer = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  // Public endpoints (no auth from our side — CF Access gates /admin externally)
  if (url.pathname === "/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      ok: true,
      service: "gateway-mcp",
      backends: Array.from(backends.values()).map((b) => ({
        name: b.cfg.name,
        enabled: b.cfg.enabled,
        tools: b.tools.length,
        error: b.error,
      })),
    }));
  }
  if (oauth && url.pathname === resourceMetadataPath && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(protectedResourceMetadata));
  }

  // AS metadata + registration — public by necessity, DCR shim only.
  // Clients probe several well-known spellings (RFC 8414 path-insertion,
  // plain OIDC discovery), so match the family rather than one literal.
  if (
    oauth && dcrClientId && req.method === "GET" &&
    (url.pathname === asMetadataPath ||
      url.pathname.startsWith(`${asMetadataPath}/`) ||
      url.pathname === "/.well-known/openid-configuration")
  ) {
    try {
      const doc = await authServerMetadata();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(doc));
    } catch (e: any) {
      console.error(`gateway: AS metadata proxy failed: ${e.message}`);
      res.writeHead(502, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "upstream_metadata_unavailable" }));
    }
  }

  if (oauth && dcrClientId && url.pathname === registrationPath && req.method === "POST") {
    // RFC 7591 §3.2.1 wants the registered metadata echoed back, and codex
    // hard-fails without redirect_uris ("missing field `redirect_uris`").
    // We echo what was asked for — but nothing is really registered here, so
    // Authentik's own redirect-URI rules are what actually get enforced at
    // /authorize. Asking for a URI it rejects fails there, not here.
    const raw = await readBody(req);
    let requested: Record<string, any> = {};
    try {
      requested = JSON.parse(raw || "{}");
    } catch {
      /* malformed body — fall back to defaults below */
    }
    const redirectUris =
      Array.isArray(requested.redirect_uris) && requested.redirect_uris.length > 0
        ? requested.redirect_uris
        : ["http://127.0.0.1/callback"];
    const body: Record<string, any> = {
      client_id: dcrClientId,
      redirect_uris: redirectUris,
      client_name: requested.client_name ?? "gateway-mcp",
      client_id_issued_at: Math.floor(Date.now() / 1000),
      token_endpoint_auth_method: dcrClientSecret ? "client_secret_post" : "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: oauth.scopesSupported.join(" "),
    };
    if (dcrClientSecret) {
      body.client_secret = dcrClientSecret;
      body.client_secret_expires_at = 0; // never
    }
    res.writeHead(201, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(body));
  }

  // Admin UI — upstream auth (Cloudflare Access) is the gate. No bearer here.
  if (url.pathname === "/admin" && req.method === "GET") {
    await retryErroredBackends();
    const toolsByBackend = new Map<string, BackendTool[]>();
    const errorsByBackend = new Map<string, string | null>();
    for (const b of backends.values()) {
      toolsByBackend.set(b.cfg.name, b.tools);
      errorsByBackend.set(b.cfg.name, b.error);
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(renderAdminPage(config, toolsByBackend, errorsByBackend));
  }
  if (url.pathname === "/admin/save" && req.method === "POST") {
    const body = await readBody(req);
    const params = new URLSearchParams(body);
    const names = config.backends.map((b) => b.name);
    const enabled = parseFormEnabled(body);
    const urls = parseFieldEdits(body, "url", names);
    const bearerEnvs = parseFieldEdits(body, "bearerEnv", names);
    const transports = parseFieldEdits(body, "transport", names);
    const descriptions = parseFieldEdits(body, "description", names);

    // Validate the optional new-backend row FIRST, before mutating anything —
    // a rejected add must leave existing rows completely untouched rather
    // than half-applying their edits without saving/reloading.
    const newName = params.get("new_name")?.trim();
    let newBackend: BackendConfig | null = null;
    if (newName) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(newName)) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        return res.end(`invalid backend name "${newName}" — use lowercase letters, digits, hyphens only`);
      }
      if (config.backends.some((b) => b.name === newName)) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        return res.end(`backend "${newName}" already exists — edit its row instead of adding it again`);
      }
      const newUrl = params.get("new_url")?.trim();
      const newBearerEnv = params.get("new_bearerEnv")?.trim();
      if (!newUrl || !newBearerEnv) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        return res.end("new backend needs at least a url and a bearerEnv");
      }
      const newTransport = params.get("new_transport");
      newBackend = {
        name: newName,
        url: newUrl,
        transport: newTransport === "sse" ? "sse" : "mcp",
        bearerEnv: newBearerEnv,
        enabled: params.get("new_enabled") === "1",
        description: params.get("new_description")?.trim() || undefined,
      };
    }

    for (const b of config.backends) {
      b.enabled = enabled.has(b.name);
      const url = urls.get(b.name)?.trim();
      if (url) b.url = url;
      const bearerEnv = bearerEnvs.get(b.name)?.trim();
      if (bearerEnv) b.bearerEnv = bearerEnv;
      const transport = transports.get(b.name);
      if (transport === "mcp" || transport === "sse") b.transport = transport;
      const description = descriptions.get(b.name);
      if (description !== undefined) b.description = description;
    }
    if (newBackend) config.backends.push(newBackend);

    saveConfig(config);
    await reload();
    res.writeHead(303, { Location: "/admin" });
    return res.end();
  }

  // Everything past this point needs MCP auth.
  if (!(await authenticate(req, res))) return;

  if (url.pathname === "/mcp") {
    const sessionHeader = req.headers["mcp-session-id"];
    const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
    if (sessionId && streamableTransports.has(sessionId)) {
      await streamableTransports.get(sessionId)!.handleRequest(req, res);
      return;
    }
    if (req.method === "POST") {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (newSessionId) => {
          streamableTransports.set(newSessionId, transport);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) streamableTransports.delete(transport.sessionId);
      };
      const server = buildServer();
      await server.connect(transport);
      await transport.handleRequest(req, res);
      return;
    }
    res.writeHead(400, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "invalid /mcp request — initialise via POST" }));
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`gateway-mcp listening on 0.0.0.0:${PORT}`);
  console.log(`  health:   GET /health`);
  console.log(`  mcp:      POST /mcp (bearer or OAuth JWT)`);
  console.log(`  admin:    GET /admin (Cloudflare Access gated at the edge)`);
  if (oauth) {
    console.log(`  oauth:    issuer ${oauth.issuer}`);
    console.log(`  prm:      GET ${resourceMetadataPath} (public)`);
    if (dcrClientId) {
      console.log(`  dcr:      POST ${registrationPath} -> client ${dcrClientId} (${dcrClientSecret ? "confidential" : "public/PKCE"})`);
      console.log(`  asmeta:   GET ${asMetadataPath} (public)`);
    } else {
      console.log(`  dcr:      disabled (set MCP_DCR_CLIENT_ID to enable)`);
    }
  }
  console.log(`  backends: ${Array.from(backends.values()).map((b) => `${b.cfg.name}${b.cfg.enabled ? "" : "(off)"}`).join(", ")}`);
});

const shutdown = async () => {
  for (const b of backends.values()) await b.close();
  httpServer.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
