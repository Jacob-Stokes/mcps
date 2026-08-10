import { z } from "zod";
import type { ObsidianClient } from "../obsidian-client.js";

export const SearchInput = z.object({
  q: z.string().min(1).describe("Query string. Plain text unless regex=true."),
  path: z.string().optional().describe("Limit to a vault subtree, e.g. 'Homelab' or 'Journal'"),
  regex: z.boolean().default(false).describe("Treat q as a regex pattern"),
  case_sensitive: z.boolean().default(false),
  max_results: z.number().int().positive().max(100).default(30),
});

export type SearchInput = z.infer<typeof SearchInput>;

export const SEARCH_TOOL = {
  name: "obsidian_search",
  description:
    "Full-text search across vault content. Returns matching files with the lines that matched. " +
    "Narrow with `path` when you know which subtree to look in (faster, less noise). " +
    "Use regex=true for pattern matching (carefully — the whole q becomes the pattern).",
  inputSchema: SearchInput,
};

export async function handleSearch(client: ObsidianClient, input: SearchInput): Promise<any> {
  const params = new URLSearchParams({
    q: input.q,
    regex: String(input.regex),
    case: String(input.case_sensitive),
  });
  if (input.path) params.set("path", input.path);

  const res = await client.get(`/api/search?${params}`);
  const results = Array.isArray(res?.results) ? res.results : [];
  const trimmed = results.slice(0, input.max_results);
  return {
    query: input.q,
    path: input.path,
    count: results.length,
    results: trimmed.map((r: any) => ({
      path: r.path,
      matches: Array.isArray(r.matches) ? r.matches.slice(0, 5) : r.matches,
    })),
  };
}
