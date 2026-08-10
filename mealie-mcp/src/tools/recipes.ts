import { z } from "zod";
import type { MealieClient } from "../mealie-client.js";
import { runBounded } from "./mealplan.js";

export const RECIPES_TOOL = {
  name: "mealie_recipes",
  description: [
    "Query and manage Jacob's Mealie recipe collection. Actions:",
    "• search — full-text search across recipe titles / descriptions / ingredients.",
    "• list — browse paginated with optional category/tag filters + sort.",
    "• get — full recipe (ingredients, instructions, nutrition, tags) by slug.",
    "• import_url — scrape a recipe from a URL (Mealie handles the extraction).",
    "• bulk_import_url — scrape many URLs in one call (up to 20). Failures reported per-URL.",
    "• create — make a blank recipe from just a name (returns a slug to then `update`).",
    "• update — partial patch of an existing recipe by slug (name, description, recipeIngredient,",
    "  recipeInstructions, notes, tags, recipeCategory, etc. — call action=get first to see the shape,",
    "  then send only the fields you want changed).",
    "• duplicate — copy an existing recipe, optionally under a new name.",
    "• delete — remove by slug.",
    "• rate — set Jacob's star rating (0-5) and/or favorite flag on a recipe.",
    "• last_made — record when a recipe was last cooked (defaults to now).",
    "• parse_ingredient — turn a raw ingredient line of text into structured quantity/unit/food.",
    "For meal-planning use mealie_mealplan once you have a recipe.",
  ].join(" "),
} as const;

export const RecipesInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("search"),
    query: z.string().min(1),
    per_page: z.number().int().min(1).max(100).default(20),
    page: z.number().int().min(1).default(1),
  }),
  z.object({
    action: z.literal("list"),
    per_page: z.number().int().min(1).max(100).default(20),
    page: z.number().int().min(1).default(1),
    categories: z.array(z.string()).optional().describe("Filter by category slug(s)."),
    tags: z.array(z.string()).optional().describe("Filter by tag slug(s)."),
    order_by: z.string().optional().describe("e.g. 'created_at', 'name', 'rating'"),
    order_direction: z.enum(["asc", "desc"]).optional(),
  }),
  z.object({
    action: z.literal("get"),
    slug: z.string().min(1).describe("Recipe slug, e.g. 'tomato-pasta'"),
  }),
  z.object({
    action: z.literal("import_url"),
    url: z.string().url().describe("Recipe URL to scrape. Mealie extracts title, ingredients, instructions, etc."),
    include_tags: z.boolean().default(true).describe("Mealie will infer tags if true."),
  }),
  z.object({
    action: z.literal("bulk_import_url"),
    urls: z.array(z.string().url()).min(1).max(20),
    include_tags: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("delete"),
    slug: z.string().min(1),
  }),
  z.object({
    action: z.literal("create"),
    name: z.string().min(1).describe("Recipe name. Mealie creates a blank recipe and returns its slug."),
  }),
  z.object({
    action: z.literal("update"),
    slug: z.string().min(1),
    patch: z.record(z.string(), z.any()).describe(
      "Partial recipe fields to change, matching Mealie's recipe schema " +
      "(e.g. name, description, recipeIngredient, recipeInstructions, notes, tags, recipeCategory, " +
      "recipeYield, prepTime, cookTime). Fetch action=get first to see current values and shapes " +
      "for array fields like recipeIngredient/recipeInstructions.",
    ),
  }),
  z.object({
    action: z.literal("duplicate"),
    slug: z.string().min(1),
    name: z.string().optional().describe("Name for the copy. Defaults to Mealie's own naming (usually '<name> (copy)')."),
  }),
  z.object({
    action: z.literal("rate"),
    slug: z.string().min(1),
    rating: z.number().min(0).max(5).optional(),
    favorite: z.boolean().optional().describe("Set/unset as a favorite recipe."),
  }),
  z.object({
    action: z.literal("last_made"),
    slug: z.string().min(1),
    timestamp: z.string().optional().describe("ISO 8601 datetime. Defaults to now."),
  }),
  z.object({
    action: z.literal("parse_ingredient"),
    text: z.string().min(1).describe("Raw ingredient line, e.g. '2 cups chopped tomatoes'."),
  }),
]);

export async function handleRecipes(
  client: MealieClient,
  input: z.infer<typeof RecipesInput>,
  selfUserId: string,
) {
  switch (input.action) {
    case "search": {
      const params = new URLSearchParams();
      params.set("search", input.query);
      params.set("perPage", String(input.per_page));
      params.set("page", String(input.page));
      const res = await client.get(`/api/recipes?${params}`);
      return compactList(res);
    }
    case "list": {
      const params = new URLSearchParams();
      params.set("perPage", String(input.per_page));
      params.set("page", String(input.page));
      if (input.order_by) params.set("orderBy", input.order_by);
      if (input.order_direction) params.set("orderDirection", input.order_direction);
      for (const c of input.categories ?? []) params.append("categories", c);
      for (const t of input.tags ?? []) params.append("tags", t);
      const res = await client.get(`/api/recipes?${params}`);
      return compactList(res);
    }
    case "get":
      return await client.get(`/api/recipes/${encodeURIComponent(input.slug)}`);
    case "import_url":
      // Mealie 3.x path is /api/recipes/create/url (the legacy
      // /api/recipes/create-url was removed in 3.x — returns 405).
      return await client.post(`/api/recipes/create/url`, {
        url: input.url,
        includeTags: input.include_tags,
      });
    case "bulk_import_url": {
      // Scraping is the slow bit (external HTTP + extraction in Mealie),
      // so low concurrency keeps memory / rate-limit risk down.
      const results = await runBounded(input.urls, 3, async (url) => {
        const slug = await client.post(`/api/recipes/create/url`, {
          url,
          includeTags: input.include_tags,
        });
        return { url, slug };
      });
      const ok = results.filter((r) => r.ok);
      const bad = results.filter((r) => !r.ok);
      return {
        total: results.length,
        succeeded: ok.length,
        failed: bad.length,
        results: ok.map((r) => r.result),
        failures: bad.map((r) => ({ url: r.item, error: r.error })),
      };
    }
    case "delete":
      await client.delete(`/api/recipes/${encodeURIComponent(input.slug)}`);
      return { deleted: input.slug };
    case "create":
      return await client.post(`/api/recipes`, { name: input.name });
    case "update":
      return await client.patch(`/api/recipes/${encodeURIComponent(input.slug)}`, input.patch);
    case "duplicate":
      return await client.post(`/api/recipes/${encodeURIComponent(input.slug)}/duplicate`, {
        name: input.name ?? null,
      });
    case "rate":
      return await client.post(
        `/api/users/${encodeURIComponent(selfUserId)}/ratings/${encodeURIComponent(input.slug)}`,
        { rating: input.rating ?? null, isFavorite: input.favorite ?? null },
      );
    case "last_made":
      return await client.patch(`/api/recipes/${encodeURIComponent(input.slug)}/last-made`, {
        timestamp: input.timestamp ?? new Date().toISOString(),
      });
    case "parse_ingredient":
      return await client.post(`/api/parser/ingredient`, { ingredient: input.text, parser: "nlp" });
  }
}

// Mealie's paginated recipe response is verbose — compact to the fields
// agents actually use for browsing (full details come via action=get).
function compactList(res: any) {
  const items = Array.isArray(res?.items) ? res.items : [];
  return {
    page: res?.page,
    per_page: res?.per_page,
    total: res?.total,
    total_pages: res?.total_pages,
    count: items.length,
    recipes: items.map((r: any) => ({
      slug: r.slug,
      name: r.name,
      description: r.description,
      rating: r.rating,
      tags: (r.tags ?? []).map((t: any) => t.name ?? t.slug),
      categories: (r.recipeCategory ?? []).map((c: any) => c.name ?? c.slug),
    })),
  };
}
