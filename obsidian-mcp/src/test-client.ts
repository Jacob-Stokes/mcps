// Direct MCP PoC for obsidian-mcp — exercises all 4 tools end-to-end.
//
// Usage:
//   MCP_URL=http://localhost:7002 MCP_BEARER_TOKEN=<token> npm run test-client

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const MCP_URL = process.env.MCP_URL || "http://localhost:7002";
const TOKEN = process.env.MCP_BEARER_TOKEN;
if (!TOKEN) { console.error("MCP_BEARER_TOKEN required"); process.exit(1); }

async function main() {
  const transport = new SSEClientTransport(new URL(`${MCP_URL}/sse`), {
    requestInit: { headers: { Authorization: `Bearer ${TOKEN}` } },
    eventSourceInit: { fetch: (u, init) => fetch(u, { ...init, headers: { ...(init?.headers as any), Authorization: `Bearer ${TOKEN}` } }) },
  });

  const client = new Client({ name: "obsidian-mcp-test-client", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  console.log("✓ connected to", MCP_URL);

  const tools = await client.listTools();
  console.log(`✓ tools: ${tools.tools.map((t) => t.name).join(", ")}`);

  // 1. Folders — list vault root
  console.log("\n--- obsidian_folders { list, '' (vault root) } ---");
  const fList = await client.callTool({ name: "obsidian_folders", arguments: { action: "list", path: "" } });
  console.log(truncate(text(fList), 400));

  // 2. Files — read Home.md
  console.log("\n--- obsidian_files { read, Home.md } ---");
  const read = await client.callTool({ name: "obsidian_files", arguments: { action: "read", path: "Home.md" } });
  console.log(truncate(text(read), 500));

  // 3. Daily — latest 3
  console.log("\n--- obsidian_daily { latest, limit: 3 } ---");
  const daily = await client.callTool({ name: "obsidian_daily", arguments: { action: "latest", limit: 3 } });
  console.log(truncate(text(daily), 400));

  // 4. Search — something that should match
  console.log("\n--- obsidian_search { q: 'homelab', path: 'Homelab', max_results: 3 } ---");
  const search = await client.callTool({ name: "obsidian_search", arguments: { q: "homelab", path: "Homelab", max_results: 3 } });
  console.log(truncate(text(search), 600));

  // 5. Write — PoC note to Scratch/
  const probePath = `Scratch/mcp-poc-${Date.now()}.md`;
  console.log(`\n--- obsidian_files { write, ${probePath} } ---`);
  const write = await client.callTool({
    name: "obsidian_files",
    arguments: { action: "write", path: probePath, content: "# PoC\n\nWritten by obsidian-mcp test-client.\n" },
  });
  console.log(truncate(text(write), 300));

  // 6. Delete the probe
  console.log(`\n--- obsidian_files { delete, ${probePath} } ---`);
  const del = await client.callTool({ name: "obsidian_files", arguments: { action: "delete", path: probePath } });
  console.log(truncate(text(del), 200));

  // 7. Error path — bad input
  console.log("\n--- obsidian_files { read } (missing path) — expect error ---");
  const bad = await client.callTool({ name: "obsidian_files", arguments: { action: "read" } });
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

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
