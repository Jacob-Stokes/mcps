// mcp-common — shared infrastructure for per-service MCP sidecars.
//
// Each MCP (thesys-mcp, obsidian-mcp, catalog-mcp, etc.) imports from
// this package for:
//   - Infisical secret fetching (at boot)
//   - zod → JSON Schema conversion (Anthropic-compatible, flattens
//     discriminated unions)
//   - HTTP+SSE transport with bearer auth + /health endpoint
//   - Tool registration + dispatch with zod runtime validation
//
// Shipped as a workspace package inside the source/ monorepo (file: dep).
// Not published to npm; consumed only by sibling MCPs.

export { fetchSecret } from "./infisical.js";
export { zodToJsonSchema, isDefaulted } from "./schema.js";
export { startMcp } from "./transport.js";
export type { ToolDefinition, ToolRegistration, StartMcpOptions, OAuthOptions } from "./transport.js";
