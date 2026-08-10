import { z } from "zod";
import type { ThesysClient } from "../thesys-client.js";

const NewItem = z.object({
  name: z.string().min(1),
  quantity: z.number().int().positive().optional(),
  unit: z.string().optional(),
  shop: z.string().optional().describe("e.g. 'Aldi', 'Amazon' — should match an existing shop"),
  category: z.string().optional(),
});

export const ShoppingInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    only_open: z.boolean().default(true),
  }),
  z.object({
    action: z.literal("add"),
    item: NewItem,
  }),
  z.object({
    action: z.literal("bulk_add"),
    items: z.array(NewItem).min(1).max(30),
  }),
  z.object({
    action: z.literal("update"),
    id: z.string(),
    fields: z.object({
      name: z.string().optional(),
      quantity: z.number().int().positive().optional(),
      done: z.boolean().optional(),
      shop: z.string().optional(),
    }),
  }),
  z.object({
    action: z.literal("delete"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("clear_done"),
  }),
]);

export type ShoppingInput = z.infer<typeof ShoppingInput>;

export const SHOPPING_TOOL = {
  name: "thesys_shopping",
  description:
    "Manage Jacob's shopping list. list/add/update/delete with bulk_add for multi-item. " +
    "clear_done removes all checked items in one call. To mark an item bought: update with {done:true}.",
  inputSchema: ShoppingInput,
};

export async function handleShopping(client: ThesysClient, input: ShoppingInput): Promise<any> {
  switch (input.action) {
    case "list": {
      const items = await client.get(`/shopping`);
      const list = Array.isArray(items) ? items : [];
      const filtered = input.only_open ? list.filter((i: any) => !i.done) : list;
      return {
        count: filtered.length,
        items: filtered.map((i: any) => ({
          id: i.id,
          name: i.name,
          quantity: i.quantity,
          shop: i.shop,
          done: i.done,
        })),
      };
    }

    case "add":
      return await client.post(`/shopping`, input.item);

    case "bulk_add": {
      const results = await Promise.all(
        input.items.map(async (item) => {
          try {
            const res = await client.post(`/shopping`, item);
            return { ok: true, id: res?.id, name: item.name };
          } catch (e: any) {
            return { ok: false, name: item.name, error: e.message };
          }
        }),
      );
      return {
        total: results.length,
        added: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }

    case "update":
      return await client.patch(`/shopping/${encodeURIComponent(input.id)}`, input.fields);

    case "delete":
      await client.delete(`/shopping/${encodeURIComponent(input.id)}`);
      return { deleted: input.id };

    case "clear_done":
      return await client.post(`/shopping/clear-done`, {});
  }
}
