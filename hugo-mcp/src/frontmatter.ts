// Parse/serialize Hugo's YAML front matter block ("---\n...\n---\nbody").
// Kept separate from the tools that use it since both posts.ts and any
// future content type need the same read/write logic.

import { load as yamlLoad, dump as yamlDump } from "js-yaml";

export interface ParsedPost {
  frontMatter: Record<string, any>;
  body: string;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parsePost(raw: string): ParsedPost {
  const m = raw.match(FM_RE);
  if (!m) return { frontMatter: {}, body: raw };
  const frontMatter = (yamlLoad(m[1]) as Record<string, any>) ?? {};
  return { frontMatter, body: m[2].replace(/^\n/, "") };
}

export function serializePost(p: ParsedPost): string {
  const fm = yamlDump(p.frontMatter, { lineWidth: -1, noRefs: true }).trimEnd();
  return `---\n${fm}\n---\n\n${p.body.trimStart()}\n`;
}

// "My Post Title!" -> "my-post-title". NFKD + stripping the combining
// diacritical marks block (U+0300-U+036F) turns e.g. "café" into "cafe"
// before the general character filter runs.
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

// Deep merge for patch-style edits: plain objects merge key-by-key,
// anything else (arrays, scalars, type mismatches) is replaced wholesale
// by the patch value. Matches the semantics already used for mealie's
// `update` action and hugo_config's patches.
export function deepMerge(base: any, patch: any): any {
  if (
    patch && base &&
    typeof patch === "object" && typeof base === "object" &&
    !Array.isArray(patch) && !Array.isArray(base)
  ) {
    const out: Record<string, any> = { ...base };
    for (const k of Object.keys(patch)) {
      out[k] = deepMerge(base[k], patch[k]);
    }
    return out;
  }
  return patch === undefined ? base : patch;
}
