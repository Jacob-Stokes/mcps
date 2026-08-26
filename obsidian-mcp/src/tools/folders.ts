import { z } from "zod";
import { encodeVaultPath } from "../obsidian-client.js";
import type { ToolContext } from "../lib/vault.js";

export const FoldersInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    path: z.string().default("").describe("Folder path, empty string = vault root. e.g. 'Homelab', 'Homelab/Services', 'Journal'"),
  }),
  z.object({
    action: z.literal("tree"),
    depth: z.number().int().min(1).max(5).default(2).describe("How many levels deep to traverse"),
    path: z.string().optional().describe("Root path, omit for vault root"),
  }),
]);

export type FoldersInput = z.infer<typeof FoldersInput>;

export const FOLDERS_TOOL = {
  name: "obsidian_folders",
  description:
    "DEPRECATED compatibility tool; prefer obsidian_list_notes. Explore the vault structure. action=list returns children of a single folder with names + " +
    "modified dates + sizes. action=tree returns a nested overview up to N levels — use for " +
    "discovering what exists before writing.",
  inputSchema: FoldersInput,
};

export async function handleFolders(ctx: ToolContext, input: FoldersInput): Promise<any> {
  switch (input.action) {
    case "list": {
      const p = input.path || "";
      if (p) ctx.policy.assertBrowse(p);
      const encoded = p ? encodeVaultPath(p) : "";
      const res = await ctx.client.get(`/api/folders${encoded ? "/" + encoded : ""}`);
      // Obsidian-landing returns two different shapes:
      //   root  →  {dir, folders: ["path1","path2",...]}  (flat string paths)
      //   child →  {path, children: [{name, type, size, modified}]}
      // Normalize to a single shape for MCP consumers.
      let children: any[];
      if (Array.isArray(res?.children)) {
        children = res.children.map((c: any) => ({
          name: c.name,
          type: c.type ?? (c.children !== undefined ? "folder" : "file"),
          size: c.size,
          modified: c.modified,
        }));
      } else if (Array.isArray(res?.folders)) {
        // Root-level: synthesize child records from the flat path list.
        // Include top-level entries only (no slashes) to match "list this folder's children" semantics.
        children = res.folders
          .filter((f: string) => !f.includes("/"))
          .map((f: string) => ({ name: f, type: "folder" }));
      } else {
        children = [];
      }
      children = children.filter((child: any) => {
        const childPath = p ? `${p}/${child.name}` : child.name;
        return child.type === "folder" || child.type === "dir"
          ? ctx.policy.canSee(childPath)
          : ctx.policy.canRead(childPath);
      });
      return { path: p, count: children.length, children };
    }

    case "tree": {
      const params = new URLSearchParams({ depth: String(input.depth) });
      if (input.path) ctx.policy.assertBrowse(input.path);
      const p = input.path ? encodeVaultPath(input.path) : "";
      const res = await ctx.client.get(`/api/tree${p ? "/" + p : ""}?${params}`);
      return { ...res, tree: filterTree(res?.tree, ctx) };
    }
  }
}

function filterTree(nodes: unknown, ctx: ToolContext): any[] {
  if (!Array.isArray(nodes)) return [];
  return nodes.flatMap((node: any) => {
    if (!node || typeof node.path !== "string") return [];
    if (node.type === "dir" || node.type === "folder") {
      if (!ctx.policy.canSee(node.path)) return [];
      return [{ ...node, children: filterTree(node.children, ctx) }];
    }
    return ctx.policy.canRead(node.path) ? [node] : [];
  });
}
