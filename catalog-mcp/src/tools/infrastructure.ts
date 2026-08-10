import { z } from "zod";
import type { CatalogClient } from "../catalog-client.js";

// Infra surface — hosts (resolution/adventure), cloudflared tunnel routes,
// CF Access app policies. Useful for agent queries like "is adventure up",
// "how many hosts do I have", "which services are gated by CF Access".

export const InfrastructureInput = z.object({
  include_routes: z.boolean().default(false).describe("Include cloudflared tunnel routes (can be long — 30+ entries)"),
  include_access: z.boolean().default(false).describe("Include CF Access app policies (long)"),
});

export type InfrastructureInput = z.infer<typeof InfrastructureInput>;

export const INFRASTRUCTURE_TOOL = {
  name: "catalog_infrastructure",
  description:
    "Homelab infra-level data: hosts (resolution, adventure) with their agent version/IP/container count, " +
    "plus optionally the full cloudflared tunnel route table and CF Access app policies. Host descriptions " +
    "are included by default (from catalog's hosts.yml). Set include_routes / include_access to true only " +
    "if you actually need them — they're verbose.",
  inputSchema: InfrastructureInput,
};

export async function handleInfrastructure(client: CatalogClient, input: InfrastructureInput): Promise<any> {
  const res = await client.get(`/api/infrastructure`);
  const out: any = {
    builtAt: res?.builtAt,
    hosts: res?.hosts ?? [],
  };
  if (input.include_routes) out.cloudflared_routes = res?.cloudflared_routes ?? [];
  if (input.include_access) out.access_apps = res?.access_apps ?? [];
  return out;
}
