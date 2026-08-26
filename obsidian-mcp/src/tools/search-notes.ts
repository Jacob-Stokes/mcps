import { z } from "zod";
import { extractTags, splitFrontmatter } from "../lib/markdown.js";
import { listMarkdownPaths, normalizeTag, type ToolContext } from "../lib/vault.js";

export const SearchNotesInput = z.object({
  mode: z.enum(["text", "regex", "path", "tag", "frontmatter"]).default("text"),
  query: z.string().default("").describe("Text/regex/path query or tag name. May be empty only for frontmatter existence checks."),
  path: z.string().optional().describe("Limit search to a vault subtree."),
  case_sensitive: z.boolean().default(false),
  frontmatter_field: z.string().optional().describe("Required for mode=frontmatter."),
  frontmatter_value: z.string().optional().describe("Optional string representation to compare; omit to find notes containing the field."),
  max_results: z.number().int().positive().max(500).default(50),
  max_scan: z.number().int().positive().max(5000).default(1000).describe("Maximum notes inspected for path/tag/frontmatter modes."),
});
export type SearchNotesInput = z.infer<typeof SearchNotesInput>;

export const SEARCH_NOTES_TOOL = {
  name: "obsidian_search_notes",
  description: "Search notes by full text, regex, path, tag, or frontmatter field. Text results include matching lines; metadata modes return matching paths and values. Narrow with path on large vaults.",
  inputSchema: SearchNotesInput,
};

export async function handleSearchNotes(ctx: ToolContext, input: SearchNotesInput) {
  if (["text", "regex", "path", "tag"].includes(input.mode) && !input.query) {
    throw new Error(`query is required for mode=${input.mode}`);
  }
  if (input.mode === "frontmatter" && !input.frontmatter_field) {
    throw new Error("frontmatter_field is required for mode=frontmatter");
  }

  if (input.mode === "text" || input.mode === "regex") {
    const params = new URLSearchParams({
      q: input.query,
      regex: String(input.mode === "regex"),
      case: String(input.case_sensitive),
    });
    if (input.path) params.set("path", ctx.policy.assertBrowse(input.path));
    const result = await ctx.client.get(`/api/search?${params}`);
    const all = Array.isArray(result?.results) ? result.results : [];
    const allowed = all.filter((item: any) => {
      try { ctx.policy.assertRead(item.path); return true; } catch { return false; }
    });
    return {
      mode: input.mode,
      query: input.query,
      path: input.path,
      total: allowed.length,
      truncated: allowed.length > input.max_results,
      results: allowed.slice(0, input.max_results).map((item: any) => ({
        path: item.path,
        matches: Array.isArray(item.matches) ? item.matches.slice(0, 10) : item.matches,
      })),
    };
  }

  const listed = await listMarkdownPaths(ctx, input.path ?? "", { limit: input.max_scan });
  if (input.mode === "path") {
    const needle = input.case_sensitive ? input.query : input.query.toLocaleLowerCase();
    const matches = listed.paths.filter((candidate) =>
      (input.case_sensitive ? candidate : candidate.toLocaleLowerCase()).includes(needle),
    );
    return {
      mode: input.mode,
      query: input.query,
      scanned: listed.paths.length,
      scanTruncated: listed.truncated,
      total: matches.length,
      truncated: matches.length > input.max_results,
      results: matches.slice(0, input.max_results).map((notePath) => ({ path: notePath })),
    };
  }

  const bulk = await ctx.client.post("/api/bulk/read", {
    paths: listed.paths,
    frontmatterOnly: input.mode === "frontmatter",
  });
  const results: any[] = [];
  const wantedTag = input.mode === "tag" ? normalizeTag(input.query) : "";
  for (const item of Array.isArray(bulk?.results) ? bulk.results : []) {
    if (typeof item?.content !== "string") continue;
    if (input.mode === "tag") {
      const tags = extractTags(item.content).all;
      if (tags.some((tag) => tag.toLocaleLowerCase() === wantedTag.toLocaleLowerCase())) {
        results.push({ path: item.path, tags });
      }
    } else {
      const frontmatter = splitFrontmatter(item.content).data;
      const field = input.frontmatter_field!;
      if (!(field in frontmatter)) continue;
      const value = frontmatter[field];
      if (input.frontmatter_value !== undefined && String(value) !== input.frontmatter_value) continue;
      results.push({ path: item.path, field, value });
    }
    if (results.length >= input.max_results) break;
  }
  return {
    mode: input.mode,
    query: input.query || undefined,
    path: input.path,
    scanned: listed.paths.length,
    scanTruncated: listed.truncated,
    count: results.length,
    results,
  };
}
