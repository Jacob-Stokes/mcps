import { z } from "zod";
import type { MoodleClient } from "../moodle-client.js";

export const SITE_TOOL = {
  name: "moodle_site",
  description:
    "Site-level info about the Moodle instance: authenticated user, site name, release/version, " +
    "available functions, mobile config. Good first call for discovery.",
} as const;

export const SiteInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("info").describe("Authenticated user + site metadata + list of callable WS functions."),
  }),
  z.object({
    action: z.literal("config").describe("Public mobile/config values (version, theme, etc.)."),
    section: z.string().optional().describe("Optional: filter a config section."),
  }),
]);

export async function handleSite(client: MoodleClient, input: z.infer<typeof SiteInput>) {
  switch (input.action) {
    case "info":
      return client.call("core_webservice_get_site_info", {});
    case "config":
      return client.call("tool_mobile_get_config", input.section ? { section: input.section } : {});
  }
}
