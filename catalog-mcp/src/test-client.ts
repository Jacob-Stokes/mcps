// Direct MCP PoC for catalog-mcp — exercises all 3 tools end-to-end.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const MCP_URL = process.env.MCP_URL || "http://localhost:7003";
const TOKEN = process.env.MCP_BEARER_TOKEN;
if (!TOKEN) { console.error("MCP_BEARER_TOKEN required"); process.exit(1); }

async function main() {
  const transport = new SSEClientTransport(new URL(`${MCP_URL}/sse`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as any), Authorization: `Bearer ${TOKEN}` } }) },
  });

  const client = new Client({ name: "catalog-mcp-test-client", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("✓ connected to", MCP_URL);

  const tools = await client.listTools();
  console.log(`✓ tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  // 1. List services, compact
  console.log("\n--- catalog_services { list, type: agent } ---");
  const list = await client.callTool({ name: "catalog_services", arguments: { action: "list", type: "agent" } });
  console.log(truncate(text(list), 500));

  // 2. Get one service
  console.log("\n--- catalog_services { get, grimmory } ---");
  const get = await client.callTool({ name: "catalog_services", arguments: { action: "get", name: "grimmory", compact: true } });
  console.log(truncate(text(get), 500));

  // 3. Glossary — lookup tasks
  console.log("\n--- catalog_glossary { lookup, tasks } ---");
  const tasks = await client.callTool({ name: "catalog_glossary", arguments: { action: "lookup", topic: "tasks" } });
  console.log(truncate(text(tasks), 400));

  // 4. Glossary — unknown topic should be handled gracefully
  console.log("\n--- catalog_glossary { lookup, unknown-topic } — expect found: false ---");
  const unk = await client.callTool({ name: "catalog_glossary", arguments: { action: "lookup", topic: "unknown-topic" } });
  console.log(truncate(text(unk), 400));

  // 5. Infrastructure (hosts only, no routes)
  console.log("\n--- catalog_infrastructure {} ---");
  const infra = await client.callTool({ name: "catalog_infrastructure", arguments: {} });
  console.log(truncate(text(infra), 500));

  // 6. Error path — missing required field
  console.log("\n--- catalog_services { get } (missing name) — expect error ---");
  const bad = await client.callTool({ name: "catalog_services", arguments: { action: "get" } });
  console.log(truncate(text(bad), 300));

  await client.close();
  console.log("\n✓ done");
}

function text(res: any): string {
  const blocks = res?.content ?? [];
  return blocks.map((b: any) => b.text ?? JSON.stringify(b)).join("\n");
}
function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "\n  ...[truncated]" : s;
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
