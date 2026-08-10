// Direct MCP client PoC — connects to the thesys-mcp SSE endpoint and exercises
// each of the 5 tools in isolation. No bot involvement. Useful for verifying
// every tool works end-to-end before we wire anything larger.
//
// Usage:
//   MCP_URL=http://localhost:7001 MCP_BEARER_TOKEN=<token> npm run test-client

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const MCP_URL = process.env.MCP_URL || "http://localhost:7001";
const TOKEN = process.env.MCP_BEARER_TOKEN;
if (!TOKEN) { console.error("MCP_BEARER_TOKEN required"); process.exit(1); }

async function main() {
  const transport = new SSEClientTransport(new URL(`${MCP_URL}/sse`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    // For POST /message the SDK reuses the same fetch; we need to ensure the
    // Authorization header is sent on those too.
    eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as any), Authorization: `Bearer ${TOKEN}` } }) },
  });

  const client = new Client({ name: "thesys-mcp-test-client", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("✓ connected to", MCP_URL);

  const tools = await client.listTools();
  console.log(`✓ tools advertised: ${tools.tools.map((t) => t.name).join(", ")}`);
  console.log(`  (${tools.tools.length} tools)`);

  // 1. List open tasks
  console.log("\n--- thesys_tasks { list, status: todo } ---");
  const tasksRes = await client.callTool({ name: "thesys_tasks", arguments: { action: "list", status: "todo", limit: 5 } });
  console.log(truncate(text(tasksRes), 600));

  // 2. Today's events
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n--- thesys_events { start: ${today}, end: ${today} } ---`);
  const eventsRes = await client.callTool({ name: "thesys_events", arguments: { start: today, end: today } });
  console.log(truncate(text(eventsRes), 600));

  // 3. Habits list
  console.log("\n--- thesys_habits { list } ---");
  const habitsRes = await client.callTool({ name: "thesys_habits", arguments: { action: "list" } });
  console.log(truncate(text(habitsRes), 600));

  // 4. Shopping list
  console.log("\n--- thesys_shopping { list, only_open: true } ---");
  const shoppingRes = await client.callTool({ name: "thesys_shopping", arguments: { action: "list", only_open: true } });
  console.log(truncate(text(shoppingRes), 600));

  // 5. Parse
  console.log("\n--- thesys_parse { text: 'mcp poc test: buy milk tomorrow 5pm !urgent' } ---");
  const parseRes = await client.callTool({ name: "thesys_parse", arguments: { text: "mcp poc test: buy milk tomorrow 5pm !urgent" } });
  console.log(truncate(text(parseRes), 600));

  // 6. Error path — malformed input should return isError with a clear message
  console.log("\n--- thesys_tasks { list, status: 'open' (invalid) } — expect error ---");
  const badRes = await client.callTool({ name: "thesys_tasks", arguments: { action: "list", status: "open" } });
  console.log(truncate(text(badRes), 400));

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

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
