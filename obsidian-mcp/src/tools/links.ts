import { z } from "zod";
import { extractLinks, resolveLinkTarget } from "../lib/markdown.js";
import { listMarkdownPaths, readNote, type ToolContext } from "../lib/vault.js";

export const LinksInput = z.object({
  path: z.string().min(1).describe("Vault-relative note path ending in .md."),
  include_backlinks: z.boolean().default(true),
  include_unresolved: z.boolean().default(true),
  max_scan: z.number().int().positive().max(5000).default(1500).describe("Maximum notes scanned to find backlinks."),
});
export type LinksInput = z.infer<typeof LinksInput>;
export const LINKS_TOOL = {
  name: "obsidian_links",
  description: "Inspect a note's Obsidian wiki links, embeds and relative Markdown links, resolve them to vault paths where possible, and optionally scan for backlinks and unresolved targets.",
  inputSchema: LinksInput,
};

export async function handleLinks(ctx: ToolContext, input: LinksInput) {
  const source = await readNote(ctx, input.path);
  const listed = await listMarkdownPaths(ctx, "", { limit: input.max_scan });
  const outgoing = extractLinks(source.content).map((link) => ({
    ...link,
    resolvedPath: resolveLinkTarget(source.path, link.target, listed.paths),
  }));

  let backlinks: Array<{ path: string; links: Array<{ target: string; alias?: string; embed: boolean; kind: string }> }> = [];
  if (input.include_backlinks) {
    const bulk = await ctx.client.post("/api/bulk/read", { paths: listed.paths.filter((candidate) => candidate !== source.path) });
    for (const item of Array.isArray(bulk?.results) ? bulk.results : []) {
      if (typeof item?.content !== "string") continue;
      const matches = extractLinks(item.content).filter((link) =>
        resolveLinkTarget(item.path, link.target, listed.paths) === source.path,
      );
      if (matches.length) backlinks.push({ path: item.path, links: matches });
    }
  }

  return {
    path: source.path,
    hash: source.hash,
    scanTruncated: listed.truncated,
    outgoing: outgoing.filter((link) => input.include_unresolved || link.resolvedPath),
    backlinks,
    unresolved: input.include_unresolved ? outgoing.filter((link) => !link.resolvedPath) : undefined,
  };
}
