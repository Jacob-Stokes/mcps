import { z } from "zod";
import fs from "node:fs";
import * as TOML from "smol-toml";
import { deepMerge } from "../frontmatter.js";

export const HUGO_CONFIG_TOOL = {
  name: "hugo_config",
  description: [
    "Read or change site-wide settings in hugo.toml (title, baseURL, menus, theme params — NOT",
    "content). Actions:",
    "• read — current config as JSON.",
    "• update — patch: send only the fields you want changed (e.g. {\"params\":{\"description\":\"...\"}}).",
    "  Nested objects merge; anything you don't mention is left untouched. Arrays (e.g. a menu) are",
    "  replaced wholesale if you provide one. Validated before writing — a broken patch is rejected",
    "  with an error rather than corrupting the file. Triggers a site rebuild (synchronous — the call",
    "  waits for it, normally under a second).",
    "Site config affects the WHOLE site — call read first, change only what you mean to.",
  ].join(" "),
} as const;

export const HugoConfigInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read") }),
  z.object({
    action: z.literal("update"),
    patch: z.record(z.string(), z.any()).describe("Partial config object — only the fields to change."),
  }),
]);

export interface ConfigDeps {
  configPath: string; // absolute path to hugo.toml
  rebuild: () => Promise<{ ok: boolean; output: string }>;
}

// TOML has no concept of null/undefined at all. smol-toml's stringify
// doesn't throw on them — it silently *drops* the key, which would have
// quietly deleted whatever was there before. Reject explicitly instead
// of relying on round-tripping to catch it (round-tripping a value that
// was silently dropped "succeeds" with no error, which is exactly how
// this was found).
function findNullish(value: any, keyPath: string): string | null {
  if (value === null || value === undefined) return keyPath;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findNullish(value[i], `${keyPath}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    for (const k of Object.keys(value)) {
      const hit = findNullish(value[k], keyPath ? `${keyPath}.${k}` : k);
      if (hit) return hit;
    }
  }
  return null;
}

export async function handleHugoConfig(deps: ConfigDeps, input: z.infer<typeof HugoConfigInput>) {
  const raw = fs.readFileSync(deps.configPath, "utf-8");
  const current = TOML.parse(raw);

  switch (input.action) {
    case "read":
      return current;

    case "update": {
      const merged = deepMerge(current, input.patch);

      const nullish = findNullish(merged, "");
      if (nullish) {
        throw new Error(
          `patch not written: "${nullish}" would be null/undefined, but TOML has no concept of null — ` +
          `omit the field entirely instead of setting it to null`,
        );
      }

      // Validate before writing anything — round-trip through the
      // serializer/parser so a malformed patch fails loudly here instead
      // of corrupting the live config.
      let serialized: string;
      try {
        serialized = TOML.stringify(merged as any);
        TOML.parse(serialized);
      } catch (e: any) {
        throw new Error(`patch would produce invalid TOML, not written: ${e?.message || e}`);
      }

      fs.writeFileSync(deps.configPath, serialized, "utf-8");
      const build = await deps.rebuild();
      return { updated: true, build };
    }
  }
}
