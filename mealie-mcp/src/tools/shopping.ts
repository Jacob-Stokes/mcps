import { z } from "zod";
import type { MealieClient } from "../mealie-client.js";

export const SHOPPING_TOOL = {
  name: "mealie_shopping",
  description: [
    "Manage Jacob's Mealie shopping lists. Actions:",
    "• list_lists — all shopping lists (id, name).",
    "• get_list — one list with its items.",
    "• create_list — new named list.",
    "• delete_list — remove a list by ID.",
    "• add_item — add a freeform item (note) or a quantity+unit+food item to a list.",
    "• update_item — change quantity/note/checked state of an existing item.",
    "• remove_item — delete an item by ID.",
    "• add_recipe — add all of a recipe's ingredients to a list (use mealie_recipes to find recipe_id/slug first).",
    "• remove_recipe — remove a previously-added recipe's ingredients from a list.",
  ].join(" "),
} as const;

export const ShoppingInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_lists") }),
  z.object({
    action: z.literal("get_list"),
    list_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("create_list"),
    name: z.string().min(1),
  }),
  z.object({
    action: z.literal("delete_list"),
    list_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("add_item"),
    list_id: z.string().min(1),
    note: z.string().optional().describe("Freeform item text, e.g. 'paper towels'."),
    food_name: z.string().optional().describe("Structured ingredient name, e.g. 'tomatoes'."),
    unit_name: z.string().optional().describe("Structured unit name, e.g. 'cup'. Only used with food_name."),
    quantity: z.number().optional().default(1),
  }),
  z.object({
    action: z.literal("update_item"),
    item_id: z.string().min(1),
    note: z.string().optional(),
    quantity: z.number().optional(),
    checked: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("remove_item"),
    item_id: z.string().min(1),
  }),
  z.object({
    action: z.literal("add_recipe"),
    list_id: z.string().min(1),
    recipe_id: z.string().min(1).describe("Recipe UUID (from mealie_recipes action=get → .id, not the slug)."),
  }),
  z.object({
    action: z.literal("remove_recipe"),
    list_id: z.string().min(1),
    recipe_id: z.string().min(1),
  }),
]);

export async function handleShopping(client: MealieClient, input: z.infer<typeof ShoppingInput>) {
  switch (input.action) {
    case "list_lists": {
      const res = await client.get(`/api/households/shopping/lists`);
      const items = Array.isArray(res?.items) ? res.items : [];
      return { count: items.length, lists: items.map((l: any) => ({ id: l.id, name: l.name })) };
    }
    case "get_list": {
      const res = await client.get(`/api/households/shopping/lists/${encodeURIComponent(input.list_id)}`);
      return {
        id: res?.id,
        name: res?.name,
        items: (res?.listItems ?? []).map((i: any) => ({
          id: i.id,
          note: i.note,
          quantity: i.quantity,
          unit: i.unit?.name,
          food: i.food?.name,
          checked: i.checked,
        })),
      };
    }
    case "create_list":
      return await client.post(`/api/households/shopping/lists`, { name: input.name });
    case "delete_list":
      await client.delete(`/api/households/shopping/lists/${encodeURIComponent(input.list_id)}`);
      return { deleted: input.list_id };
    case "add_item": {
      const body: any = {
        shoppingListId: input.list_id,
        quantity: input.quantity,
      };
      if (input.note) body.note = input.note;
      if (input.food_name) body.food = { name: input.food_name };
      if (input.unit_name) body.unit = { name: input.unit_name };
      return await client.post(`/api/households/shopping/items`, body);
    }
    case "update_item": {
      // PUT is a full replacement (unset fields fall back to schema defaults,
      // not the item's current value), so fetch-then-merge rather than
      // sending just the changed fields.
      const current = await client.get(`/api/households/shopping/items/${encodeURIComponent(input.item_id)}`);
      const body: any = { ...current };
      if (input.note !== undefined) body.note = input.note;
      if (input.quantity !== undefined) body.quantity = input.quantity;
      if (input.checked !== undefined) body.checked = input.checked;
      return await client.put(`/api/households/shopping/items/${encodeURIComponent(input.item_id)}`, body);
    }
    case "remove_item":
      await client.delete(`/api/households/shopping/items/${encodeURIComponent(input.item_id)}`);
      return { deleted: input.item_id };
    case "add_recipe":
      return await client.post(
        `/api/households/shopping/lists/${encodeURIComponent(input.list_id)}/recipe/${encodeURIComponent(input.recipe_id)}`,
        {},
      );
    case "remove_recipe":
      await client.post(
        `/api/households/shopping/lists/${encodeURIComponent(input.list_id)}/recipe/${encodeURIComponent(input.recipe_id)}/delete`,
        {},
      );
      return { removed: input.recipe_id, from_list: input.list_id };
  }
}
