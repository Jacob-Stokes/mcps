import { z } from "zod";
import type { MealieClient } from "../mealie-client.js";

// Mealie meal plan entries have entryType ∈ {breakfast, lunch, dinner, side}
// and either a recipeId (planned from library) or a freeform title+text
// (for "eat out" / "leftovers" entries without a recipe).

const DateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD");
const EntryType = z.enum(["breakfast", "lunch", "dinner", "side"]);
const RuleDay = z.enum(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "unset"]);
const RuleEntryType = z.enum(["breakfast", "lunch", "dinner", "side", "snack", "drink", "dessert", "unset"]);

export const MEALPLAN_TOOL = {
  name: "mealie_mealplan",
  description: [
    "Manage Jacob's meal plan. Actions:",
    "• list — entries in a date range.",
    "• add — schedule a recipe (recipe_id) or a freeform entry (title + optional text).",
    "• bulk_add — schedule many entries in one call (preferred for 'plan the week'). Up to 30 entries.",
    "• delete — remove an entry by ID.",
    "• random — ask Mealie for a random recipe of a given meal type (useful for 'what's for dinner').",
    "• rule_list — list meal-plan automation rules (e.g. 'always suggest a dessert category on Sundays').",
    "• rule_add — create a rule: pin a day/meal-slot to a recipe filter (queryFilterString, Mealie's",
    "  filter syntax, e.g. \"tags.name = 'quick'\").",
    "• rule_delete — remove a rule by ID.",
    "Meal entries can come from Mealie's recipe library (recipe_id) or be freeform text for 'takeout' / 'leftovers'.",
  ].join(" "),
} as const;

const MealplanEntry = z.object({
  date: DateString,
  entry_type: EntryType,
  recipe_id: z.string().optional().describe("UUID of the recipe. Omit for freeform."),
  title: z.string().optional(),
  text: z.string().optional(),
});

export const MealplanInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    start_date: DateString,
    end_date: DateString,
  }),
  z.object({
    action: z.literal("add"),
    date: DateString,
    entry_type: EntryType,
    recipe_id: z.string().optional().describe("UUID of the recipe (use mealie_recipes → .id). Omit for freeform."),
    title: z.string().optional().describe("Freeform title (when no recipe_id), e.g. 'Takeout'."),
    text: z.string().optional().describe("Freeform notes."),
  }),
  z.object({
    action: z.literal("bulk_add"),
    entries: z.array(MealplanEntry).min(1).max(30),
  }),
  z.object({
    action: z.literal("delete"),
    id: z.number().int().describe("Meal-plan entry ID (from action=list .id)."),
  }),
  z.object({
    action: z.literal("random"),
    entry_type: EntryType.optional().describe("Filter by meal slot."),
  }),
  z.object({
    action: z.literal("rule_list"),
  }),
  z.object({
    action: z.literal("rule_add"),
    day: RuleDay.default("unset").describe("Day the rule applies to, or 'unset' for every day."),
    entry_type: RuleEntryType.default("unset").describe("Meal slot the rule applies to, or 'unset' for any."),
    query_filter: z.string().default("").describe("Mealie recipe filter string, e.g. \"tags.name = 'quick'\"."),
  }),
  z.object({
    action: z.literal("rule_delete"),
    id: z.string().min(1).describe("Rule ID (from action=rule_list .id)."),
  }),
]);

export async function handleMealplan(client: MealieClient, input: z.infer<typeof MealplanInput>) {
  switch (input.action) {
    case "list": {
      const params = new URLSearchParams({ start_date: input.start_date, end_date: input.end_date });
      const res = await client.get(`/api/households/mealplans?${params}`);
      const items = Array.isArray(res?.items) ? res.items : [];
      return {
        count: items.length,
        entries: items.map((e: any) => ({
          id: e.id,
          date: e.date,
          entry_type: e.entryType,
          title: e.title,
          text: e.text,
          recipe: e.recipe ? { id: e.recipe.id, slug: e.recipe.slug, name: e.recipe.name } : null,
        })),
      };
    }
    case "add": {
      const body: any = {
        date: input.date,
        entryType: input.entry_type,
      };
      if (input.recipe_id) body.recipeId = input.recipe_id;
      if (input.title) body.title = input.title;
      if (input.text) body.text = input.text;
      return await client.post(`/api/households/mealplans`, body);
    }
    case "bulk_add": {
      // Mealie has no batch endpoint — fan out with bounded concurrency.
      // Postgres so concurrency is less painful than linkding/SQLite, but
      // 4 is plenty.
      const results = await runBounded(input.entries, 4, async (e) => {
        const body: any = { date: e.date, entryType: e.entry_type };
        if (e.recipe_id) body.recipeId = e.recipe_id;
        if (e.title) body.title = e.title;
        if (e.text) body.text = e.text;
        const r = await client.post(`/api/households/mealplans`, body);
        return { id: r?.id, date: e.date, entry_type: e.entry_type };
      });
      const succeeded = results.filter((r) => r.ok);
      const failed = results.filter((r) => !r.ok);
      return {
        total: results.length,
        succeeded: succeeded.length,
        failed: failed.length,
        results: succeeded.map((r) => r.result),
        failures: failed.map((r) => ({ entry: r.item, error: r.error })),
      };
    }
    case "delete":
      await client.delete(`/api/households/mealplans/${input.id}`);
      return { deleted: input.id };
    case "random": {
      const params = new URLSearchParams();
      if (input.entry_type) params.set("entryType", input.entry_type);
      const qs = params.toString();
      return await client.get(`/api/households/mealplans/random${qs ? "?" + qs : ""}`);
    }
    case "rule_list": {
      const res = await client.get(`/api/households/mealplans/rules`);
      const items = Array.isArray(res?.items) ? res.items : [];
      return {
        count: items.length,
        rules: items.map((r: any) => ({
          id: r.id,
          day: r.day,
          entry_type: r.entryType,
          query_filter: r.queryFilterString,
        })),
      };
    }
    case "rule_add":
      return await client.post(`/api/households/mealplans/rules`, {
        day: input.day,
        entryType: input.entry_type,
        queryFilterString: input.query_filter,
      });
    case "rule_delete":
      await client.delete(`/api/households/mealplans/rules/${encodeURIComponent(input.id)}`);
      return { deleted: input.id };
  }
}

// Bounded-concurrency fan-out helper. Each iteration gets its own fetch,
// avoiding the Response-reuse trap that bit linkding. Shared by bulk ops
// across mealie tools.
export async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: boolean; item: T; result?: R; error?: string }>> {
  const out: Array<{ ok: boolean; item: T; result?: R; error?: string }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = { ok: true, item: items[i], result: await fn(items[i]) };
      } catch (e: any) {
        out[i] = { ok: false, item: items[i], error: e?.message ?? String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
