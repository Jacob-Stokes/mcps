import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { parsePost, serializePost, slugify, deepMerge } from "../frontmatter.js";

export const HUGO_CONTENT_TOOL = {
  name: "hugo_content",
  description: [
    "Manage blog posts on the Hugo site. Actions:",
    "• list_posts — title/date/tags/categories/draft for every post.",
    "• read_post — full front matter + body of one post by slug.",
    "• create_post — new post (title + body required; tags/categories/date/draft optional).",
    "  Slug is derived from the title. Triggers a site rebuild.",
    "• edit_post — change any subset of an existing post's fields by slug; anything omitted is",
    "  left as-is. Triggers a site rebuild.",
    "Use list_posts/read_post before edit_post so you know the current state.",
    "The rebuild runs synchronously — the call doesn't return until it finishes. Normally that's",
    "under a second (Hugo is fast), but it can take longer if the post has a lot of images, so don't",
    "assume a stall means something broke.",
  ].join(" "),
} as const;

const TagsField = z.array(z.string()).optional();

export const HugoContentInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_posts") }),
  z.object({
    action: z.literal("read_post"),
    slug: z.string().min(1),
  }),
  z.object({
    action: z.literal("create_post"),
    title: z.string().min(1),
    body: z.string().min(1),
    tags: TagsField,
    categories: TagsField,
    date: z.string().optional().describe("ISO date, e.g. '2026-08-11'. Defaults to now."),
    draft: z.boolean().default(false),
  }),
  z.object({
    action: z.literal("edit_post"),
    slug: z.string().min(1),
    title: z.string().optional(),
    body: z.string().optional(),
    tags: TagsField,
    categories: TagsField,
    date: z.string().optional(),
    draft: z.boolean().optional(),
  }),
]);

export interface ContentDeps {
  postsDir: string; // absolute path to content/posts
  rebuild: () => Promise<{ ok: boolean; output: string }>;
}

function postPath(postsDir: string, slug: string): string {
  const safeSlug = path.basename(slug).replace(/\.md$/, "");
  return path.join(postsDir, `${safeSlug}.md`);
}

function readAllPosts(postsDir: string): { slug: string; frontMatter: Record<string, any> }[] {
  if (!fs.existsSync(postsDir)) return [];
  return fs
    .readdirSync(postsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => {
      const raw = fs.readFileSync(path.join(postsDir, f), "utf-8");
      const { frontMatter } = parsePost(raw);
      return { slug: f.replace(/\.md$/, ""), frontMatter };
    });
}

export async function handleHugoContent(deps: ContentDeps, input: z.infer<typeof HugoContentInput>) {
  switch (input.action) {
    case "list_posts": {
      const posts = readAllPosts(deps.postsDir).map((p) => ({
        slug: p.slug,
        title: p.frontMatter.title,
        date: p.frontMatter.date,
        tags: p.frontMatter.tags ?? [],
        categories: p.frontMatter.categories ?? [],
        draft: !!p.frontMatter.draft,
      }));
      return { count: posts.length, posts };
    }

    case "read_post": {
      const filePath = postPath(deps.postsDir, input.slug);
      if (!fs.existsSync(filePath)) throw new Error(`not found: ${input.slug}`);
      const raw = fs.readFileSync(filePath, "utf-8");
      const { frontMatter, body } = parsePost(raw);
      return { slug: input.slug, frontMatter, body };
    }

    case "create_post": {
      const slug = slugify(input.title);
      const filePath = postPath(deps.postsDir, slug);
      if (fs.existsSync(filePath)) throw new Error(`a post with slug "${slug}" already exists — use edit_post instead`);

      const frontMatter: Record<string, any> = {
        title: input.title,
        date: input.date ?? new Date().toISOString().slice(0, 10),
        draft: input.draft,
      };
      if (input.tags?.length) frontMatter.tags = input.tags;
      if (input.categories?.length) frontMatter.categories = input.categories;

      fs.mkdirSync(deps.postsDir, { recursive: true });
      fs.writeFileSync(filePath, serializePost({ frontMatter, body: input.body }), "utf-8");

      const build = await deps.rebuild();
      return { slug, created: true, build };
    }

    case "edit_post": {
      const filePath = postPath(deps.postsDir, input.slug);
      if (!fs.existsSync(filePath)) throw new Error(`not found: ${input.slug}`);
      const raw = fs.readFileSync(filePath, "utf-8");
      const current = parsePost(raw);

      const fmPatch: Record<string, any> = {};
      if (input.title !== undefined) fmPatch.title = input.title;
      if (input.tags !== undefined) fmPatch.tags = input.tags;
      if (input.categories !== undefined) fmPatch.categories = input.categories;
      if (input.date !== undefined) fmPatch.date = input.date;
      if (input.draft !== undefined) fmPatch.draft = input.draft;

      const frontMatter = deepMerge(current.frontMatter, fmPatch);
      const body = input.body !== undefined ? input.body : current.body;

      fs.writeFileSync(filePath, serializePost({ frontMatter, body }), "utf-8");

      const build = await deps.rebuild();
      return { slug: input.slug, updated: true, build };
    }
  }
}
