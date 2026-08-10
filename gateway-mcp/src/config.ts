// Gateway config: list of backend MCPs with enable/disable toggle.
// Persisted as JSON on disk so changes survive restarts. Admin UI writes
// this file; gateway reads it at boot + on SIGHUP-style reload requests.

import fs from "node:fs";
import path from "node:path";

export interface BackendConfig {
  /** Display name + key. Used in tool-list fallback and admin UI. */
  name: string;
  /** MCP endpoint — typically thesys-net internal, e.g. http://obsidian-mcp:7002/mcp */
  url: string;
  /** Transport the backend speaks — streamable HTTP ('mcp') or legacy SSE ('sse'). */
  transport: "mcp" | "sse";
  /** Bearer token env var name. Resolved at boot from process.env. */
  bearerEnv: string;
  /** When false, skipped at tool-list + rejected at tool-call. */
  enabled: boolean;
  /** Optional description shown in admin UI. */
  description?: string;
}

export interface GatewayConfig {
  backends: BackendConfig[];
}

const CONFIG_DIR = process.env.GATEWAY_CONFIG_DIR || "/data";
const CONFIG_PATH = path.join(CONFIG_DIR, "gateway.json");

/**
 * Default backends — seeded into config on first boot. Lists every MCP
 * currently registered on the homelab. Operator toggles via admin UI.
 */
const SEED: GatewayConfig = {
  backends: [
    {
      name: "thesys",
      url: "http://thesys-mcp:7001/mcp",
      transport: "mcp",
      bearerEnv: "MCP_THESYS_BEARER_TOKEN",
      enabled: true,
      description: "Jacob's everything-app: tasks, events, habits, shopping, parse",
    },
    {
      name: "obsidian",
      url: "http://obsidian-mcp:7002/mcp",
      transport: "mcp",
      bearerEnv: "MCP_OBSIDIAN_BEARER_TOKEN",
      enabled: true,
      description: "Obsidian vault: files, folders, search, daily notes",
    },
    {
      name: "catalog",
      url: "http://catalog-mcp:7003/mcp",
      transport: "mcp",
      bearerEnv: "MCP_CATALOG_BEARER_TOKEN",
      enabled: true,
      description: "Homelab service inventory, routing glossary, infrastructure",
    },
    {
      name: "ntfy",
      url: "http://ntfy-mcp:7005/mcp",
      transport: "mcp",
      bearerEnv: "MCP_NTFY_BEARER_TOKEN",
      enabled: true,
      description: "Push notifications to Jacob's phone",
    },
    {
      name: "anki",
      url: "http://anki-mcp:7006/mcp",
      transport: "mcp",
      bearerEnv: "MCP_ANKI_BEARER_TOKEN",
      enabled: true,
      description: "AnkiConnect wrapper: create/find/update/delete flashcards",
    },
    {
      name: "grimmory",
      url: "http://grimmory-mcp:7007/mcp",
      transport: "mcp",
      bearerEnv: "MCP_GRIMMORY_BEARER_TOKEN",
      enabled: true,
      description: "Ebook library: search, read progress",
    },
    {
      name: "mealie",
      url: "http://mealie-mcp:7008/mcp",
      transport: "mcp",
      bearerEnv: "MCP_MEALIE_BEARER_TOKEN",
      enabled: true,
      description: "Recipes + meal plan: search, import from URL, schedule meals",
    },
    {
      name: "freshrss",
      url: "http://freshrss-mcp:7009/mcp",
      transport: "mcp",
      bearerEnv: "MCP_FRESHRSS_BEARER_TOKEN",
      enabled: true,
      description: "RSS reader: feeds, unread/starred items, mark read",
    },
    {
      name: "linkding",
      url: "http://linkding-mcp:7010/mcp",
      transport: "mcp",
      bearerEnv: "MCP_LINKDING_BEARER_TOKEN",
      enabled: true,
      description: "Bookmarks: search, save, tag, archive",
    },
    {
      name: "monica",
      url: "http://monica-mcp:7011/mcp",
      transport: "mcp",
      bearerEnv: "MCP_MONICA_BEARER_TOKEN",
      enabled: true,
      description: "Personal CRM: contacts, activities (interactions), reminders",
    },
    {
      name: "zotero",
      url: "http://zotero-mcp:7012/mcp",
      transport: "mcp",
      bearerEnv: "MCP_ZOTERO_BEARER_TOKEN",
      enabled: true,
      description: "Zotero library: search/browse/create/update items + collections",
    },
    {
      name: "cost-tracker",
      url: "http://cost-tracker-mcp:7013/mcp",
      transport: "mcp",
      bearerEnv: "MCP_COST_TRACKER_BEARER_TOKEN",
      enabled: true,
      description: "LLM cost + subscription-quota observability: per-run spend stats, claude.ai + chatgpt.com utilization",
    },
    {
      name: "moodle",
      url: "http://moodle-mcp:7014/mcp",
      transport: "mcp",
      bearerEnv: "MCP_MOODLE_BEARER_TOKEN",
      enabled: true,
      description: "Moodle admin: users / courses / categories / enrolments / groups / site info (admin-scoped token)",
    },
  ],
};

export function loadConfig(): GatewayConfig {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  } catch {
    // non-fatal; write will fail loudly later if really broken
  }
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const raw = fs.readFileSync(CONFIG_PATH, "utf8");
      return JSON.parse(raw) as GatewayConfig;
    } catch (e: any) {
      console.error(`gateway: config parse failed at ${CONFIG_PATH}: ${e.message}; seeding defaults`);
    }
  }
  saveConfig(SEED);
  return SEED;
}

export function saveConfig(cfg: GatewayConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), "utf8");
}
