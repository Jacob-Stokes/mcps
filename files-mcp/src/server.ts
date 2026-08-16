// files-mcp — read-only access to a small, pre-approved set of named
// directories ("roots"). Deliberately narrow: no writes, no deletes, no
// arbitrary paths — only what's listed in FILES_ROOTS at deploy time.
//
// Built instead of wiring up the official (stdio-only) filesystem
// reference server because that one can't run as a standalone HTTP
// service — it's designed to be spawned as a local subprocess by a
// client like Claude Desktop, which doesn't fit a gateway-backend model.
// Same safety pattern (allowlisted roots, path containment), just native
// streamable HTTP so it slots in like every other MCP here.

import { startMcp } from "mcp-common";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";

const PORT = parseInt(process.env.PORT || "7015", 10);
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

// FILES_ROOTS: JSON object, name -> absolute path. e.g.
//   {"screenshots":"/screenshots","adventure-backups":"/backups-adv"}
// Each value must already be mounted into this container — this MCP never
// reaches outside its own filesystem.
const ROOTS: Record<string, string> = (() => {
  const raw = process.env.FILES_ROOTS;
  if (!raw) { console.error("FATAL: FILES_ROOTS env var required (JSON: {\"name\":\"/path\"})"); process.exit(1); }
  try {
    const parsed = JSON.parse(raw);
    for (const [name, p] of Object.entries(parsed)) {
      if (typeof p !== "string" || !path.isAbsolute(p)) {
        throw new Error(`root "${name}" must be an absolute path`);
      }
    }
    return parsed;
  } catch (e: any) {
    console.error(`FATAL: FILES_ROOTS is not valid: ${e.message}`);
    process.exit(1);
  }
})();

const MAX_BYTES = 5 * 1024 * 1024; // 5MB — plenty for a screenshot, a hard stop for anything else
const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;
const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };

const FILES_TOOL = {
  name: "files",
  description: [
    "Read-only access to a small set of pre-approved folders (configured at",
    "deploy time, not something you can point elsewhere). Actions:",
    "• list_roots — the named folders available and what they're for.",
    "• list — files in one root (name, size, modified time). Use a name from list_roots.",
    "• get — a file's contents by root + filename. Images (.png/.jpg/.jpeg/.webp/.gif)",
    "  come back as an image block and render inline in the conversation. Everything",
    "  else comes back as UTF-8 text. 5MB hard size cap either way.",
    "No write/delete/rename — this tool can only read what's already there.",
  ].join(" "),
} as const;

const FilesInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_roots") }),
  z.object({ action: z.literal("list"), root: z.string().min(1) }),
  z.object({ action: z.literal("get"), root: z.string().min(1), file: z.string().min(1) }),
]);

function rootPath(root: string): string {
  const p = ROOTS[root];
  if (!p) throw new Error(`unknown root "${root}" — call list_roots for the available names`);
  return p;
}

// Path containment: the whole defence against "../../etc/passwd". Resolve
// against the root, then verify the result is still inside it.
function resolveSafe(root: string, file: string): string {
  const base = rootPath(root);
  const target = path.resolve(base, file);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error(`invalid path: "${file}" resolves outside root "${root}"`);
  }
  return target;
}

async function handleFiles(input: z.infer<typeof FilesInput>) {
  switch (input.action) {
    case "list_roots": {
      return { roots: Object.entries(ROOTS).map(([name, dir]) => ({ name, path: dir })) };
    }

    case "list": {
      const base = rootPath(input.root);
      if (!fs.existsSync(base)) return { root: input.root, count: 0, files: [] };
      const files = fs
        .readdirSync(base)
        .filter((f) => !f.startsWith("."))
        .map((f) => {
          const st = fs.statSync(path.join(base, f));
          return { name: f, is_dir: st.isDirectory(), size: st.size, modified: st.mtime.toISOString() };
        })
        .sort((a, b) => (a.modified < b.modified ? 1 : -1)); // newest first
      return { root: input.root, count: files.length, files };
    }

    case "get": {
      const filePath = resolveSafe(input.root, input.file);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        throw new Error(`not found: ${input.file} in root "${input.root}"`);
      }
      const size = fs.statSync(filePath).size;
      if (size > MAX_BYTES) {
        throw new Error(`${input.file} is ${(size / 1024 / 1024).toFixed(1)}MB, over the ${MAX_BYTES / 1024 / 1024}MB cap`);
      }

      const ext = path.extname(filePath).toLowerCase();
      if (IMAGE_EXT.test(ext)) {
        const data = fs.readFileSync(filePath).toString("base64");
        return { content: [{ type: "image", data, mimeType: MIME[ext] }] };
      }
      return { file: input.file, root: input.root, size, content: fs.readFileSync(filePath, "utf-8") };
    }
  }
}

console.log(`files-mcp roots: ${Object.entries(ROOTS).map(([n, p]) => `${n} -> ${p}`).join(", ")}`);

await startMcp({
  name: "files-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  tools: [{ def: { ...FILES_TOOL, inputSchema: FilesInput }, handler: handleFiles }],
});
