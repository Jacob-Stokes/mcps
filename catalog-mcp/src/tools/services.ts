import { z } from "zod";
import type { CatalogClient } from "../catalog-client.js";

// Catalog service records have a LOT of fields (status, urls, auth, networks,
// containers, paths, icons, access policies, etc.). Agents usually want a
// subset. We accept an optional `fields` array to let the agent pick what
// matters; default is a compact subset that's useful for most queries.

const COMPACT_FIELDS = [
  "name", "type", "category", "status", "host", "hostnames",
  "urls", "auth", "description", "tags",
] as const;

export const ServicesInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    host: z.string().optional().describe("Filter: only services on this host, e.g. 'resolution' or 'adventure'"),
    category: z.string().optional().describe("Filter: only services of this category, e.g. 'productivity', 'media', 'platform'"),
    type: z.enum(["app", "agent"]).optional().describe("Filter: only services of this kind"),
    include_internal: z.boolean().default(false).describe("Include services flagged internal (hidden from default listing)"),
    compact: z.boolean().default(true).describe("Return just {name, status, type, category, host, urls, auth} per service. Set false for full records."),
  }),
  z.object({
    action: z.literal("get"),
    name: z.string().describe("Service name, e.g. 'grimmory', 'obsidian', 'tg-thesys-data-bot'"),
    compact: z.boolean().default(false).describe("If true, return only the common-case fields (name, status, urls, auth, etc.). Full record otherwise."),
  }),
  z.object({
    action: z.literal("by_url"),
    hostname: z.string().describe("Public hostname to look up, e.g. 'service.example.com'"),
  }),
]);

export type ServicesInput = z.infer<typeof ServicesInput>;

export const SERVICES_TOOL = {
  name: "catalog_services",
  description:
    "Look up services in the homelab catalog. list returns all services (with optional filters); " +
    "get fetches one by name; by_url fetches the service at a given public hostname. " +
    "The catalog record includes urls (internal + public), auth (typed recipe: x-api-key/bearer/jwt-login/greader), " +
    "status (running/partial/stopped), host (resolution/adventure), and tags. " +
    "Use this BEFORE calling any homelab service directly — catalog is the SSOT for URLs and auth shapes.",
  inputSchema: ServicesInput,
};

export async function handleServices(client: CatalogClient, input: ServicesInput): Promise<any> {
  switch (input.action) {
    case "list": {
      const params = new URLSearchParams();
      if (input.host) params.set("host", input.host);
      if (input.category) params.set("category", input.category);
      if (input.include_internal) params.set("internal", "true");
      const qs = params.toString();
      const res = await client.get(`/api/services${qs ? "?" + qs : ""}`);
      let services = Array.isArray(res?.services) ? res.services : [];
      if (input.type) services = services.filter((s: any) => (s.type ?? "app") === input.type);
      return {
        count: services.length,
        builtAt: res?.builtAt,
        services: input.compact ? services.map(compact) : services,
      };
    }

    case "get": {
      const res = await client.get(`/api/services/${encodeURIComponent(input.name)}`);
      return input.compact ? compact(res) : res;
    }

    case "by_url": {
      return await client.get(`/api/by-url/${encodeURIComponent(input.hostname)}`);
    }
  }
}

function compact(s: any): any {
  if (!s || typeof s !== "object") return s;
  const out: any = {};
  for (const f of COMPACT_FIELDS) {
    if (s[f] !== undefined) out[f] = s[f];
  }
  // Trim access records — they're verbose; include gated flag only unless full requested.
  if (Array.isArray(s.access)) {
    out.gated = s.access.some((a: any) => a.gated);
  }
  return out;
}
