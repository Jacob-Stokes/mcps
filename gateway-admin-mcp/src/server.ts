// gateway-admin-mcp — lets an agent read documentation about this
// gateway/server straight from a mounted folder. Deliberately thin right
// now (list + read over /documentation) — more admin capabilities get
// added here later as this server grows.

import { startMcp } from "mcp-common";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const PORT = parseInt(process.env.PORT || "7020", 10);
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }
const DOCS_PATH = process.env.DOCS_PATH || "/documentation";

const GATEWAY_ADMIN_TOOL = {
  name: "gateway_admin",
  description: [
    "Read documentation about this server/gateway itself — what it's for, what's",
    "running on it, what's planned. Actions:",
    "• list_docs — names of every documentation file available.",
    "• read_doc — full text of one file (use a name from list_docs).",
    "Start with list_docs, then read_doc on whatever looks relevant.",
  ].join(" "),
} as const;

const GatewayAdminInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_docs") }),
  z.object({
    action: z.literal("read_doc"),
    file: z.string().min(1).describe("Filename from list_docs, e.g. 'welcome.txt'."),
  }),
]);

function resolveSafe(file: string): string {
  const target = path.resolve(DOCS_PATH, file);
  const root = path.resolve(DOCS_PATH);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`invalid file path: ${file}`);
  }
  return target;
}

async function handleGatewayAdmin(input: z.infer<typeof GatewayAdminInput>) {
  switch (input.action) {
    case "list_docs": {
      const files = fs.existsSync(DOCS_PATH)
        ? fs.readdirSync(DOCS_PATH).filter((f) => !f.startsWith("."))
        : [];
      return { count: files.length, files };
    }
    case "read_doc": {
      const filePath = resolveSafe(input.file);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`not found: ${input.file}`);
      }
      return { file: input.file, content: fs.readFileSync(filePath, "utf-8") };
    }
  }
}

await startMcp({
  name: "gateway-admin-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  tools: [
    { def: { ...GATEWAY_ADMIN_TOOL, inputSchema: GatewayAdminInput }, handler: handleGatewayAdmin },
  ],
});
