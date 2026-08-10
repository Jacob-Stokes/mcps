// hugo-mcp — manage a Hugo static site: posts (with tags/categories), site
// config, and rebuilding. The Hugo binary is baked into this same image
// (see Dockerfile) rather than run in a separate container — there's
// exactly one consumer of it (this process), so splitting it out would
// only mean either mounting the Docker socket (a much bigger privilege
// grant than this needs) or standing up a second bespoke service just to
// relay "run this one command."

import { startMcp } from "mcp-common";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { HUGO_CONTENT_TOOL, HugoContentInput, handleHugoContent } from "./tools/content.js";
import { HUGO_CONFIG_TOOL, HugoConfigInput, handleHugoConfig } from "./tools/config.js";
import { HUGO_SITE_TOOL, HugoSiteInput, handleHugoSite } from "./tools/site.js";

const execFileAsync = promisify(execFile);

const PORT = parseInt(process.env.PORT || "7030", 10);
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const SITE_ROOT = process.env.SITE_ROOT || "/site";
const POSTS_DIR = path.join(SITE_ROOT, "content", "posts");
const CONFIG_PATH = path.join(SITE_ROOT, "hugo.toml");

async function rebuild(): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execFileAsync("hugo", ["--minify"], { cwd: SITE_ROOT, timeout: 60_000 });
    return { ok: true, output: (stdout + stderr).trim() };
  } catch (e: any) {
    return { ok: false, output: (e?.stdout ?? "") + (e?.stderr ?? e?.message ?? String(e)) };
  }
}

await startMcp({
  name: "hugo-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  tools: [
    {
      def: { ...HUGO_CONTENT_TOOL, inputSchema: HugoContentInput },
      handler: (i) => handleHugoContent({ postsDir: POSTS_DIR, rebuild }, i),
    },
    {
      def: { ...HUGO_CONFIG_TOOL, inputSchema: HugoConfigInput },
      handler: (i) => handleHugoConfig({ configPath: CONFIG_PATH, rebuild }, i),
    },
    {
      def: { ...HUGO_SITE_TOOL, inputSchema: HugoSiteInput },
      handler: (i) => handleHugoSite({ rebuild }, i),
    },
  ],
});
