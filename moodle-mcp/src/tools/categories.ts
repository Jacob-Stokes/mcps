import { z } from "zod";
import type { MoodleClient } from "../moodle-client.js";

export const CATEGORIES_TOOL = {
  name: "moodle_categories",
  description:
    "Manage Moodle course categories (admin surface). List the tree, create/update/delete " +
    "categories, reorder via parent/sortorder.",
} as const;

const CategoryCreate = z.object({
  name: z.string().min(1),
  parent: z.number().int().min(0).default(0).describe("0 = top-level."),
  idnumber: z.string().optional(),
  description: z.string().optional(),
  descriptionformat: z.number().int().min(0).max(4).default(1),
});

const CategoryUpdate = z.object({
  id: z.number().int().positive(),
  name: z.string().optional(),
  parent: z.number().int().min(0).optional(),
  idnumber: z.string().optional(),
  description: z.string().optional(),
  descriptionformat: z.number().int().min(0).max(4).optional(),
  visible: z.number().int().min(0).max(1).optional(),
});

export const CategoriesInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list").describe("List categories, optionally filtered by parent id or id."),
    parent: z.number().int().min(0).optional(),
    id: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal("create").describe("Create one category."),
    category: CategoryCreate,
  }),
  z.object({
    action: z.literal("bulk_create").describe("Create many categories."),
    categories: z.array(CategoryCreate).min(1).max(50),
  }),
  z.object({
    action: z.literal("update").describe("Update a category."),
    category: CategoryUpdate,
  }),
  z.object({
    action: z.literal("delete").describe("Delete categories."),
    ids: z.array(z.number().int().positive()).min(1).max(50),
    recursive: z.boolean().default(false).describe("Also delete all contained courses/subcategories."),
  }),
]);

export async function handleCategories(client: MoodleClient, input: z.infer<typeof CategoriesInput>) {
  switch (input.action) {
    case "list": {
      const criteria: Array<{ key: string; value: string }> = [];
      if (input.id) criteria.push({ key: "id", value: String(input.id) });
      if (input.parent !== undefined) criteria.push({ key: "parent", value: String(input.parent) });
      return client.call("core_course_get_categories", { criteria });
    }
    case "create": {
      const res = await client.call("core_course_create_categories", { categories: [input.category] });
      return Array.isArray(res) ? res[0] : res;
    }
    case "bulk_create":
      return client.call("core_course_create_categories", { categories: input.categories });
    case "update":
      await client.call("core_course_update_categories", { categories: [input.category] });
      return { ok: true, id: input.category.id };
    case "delete": {
      const categories = input.ids.map((id) => ({ id, recursive: input.recursive ? 1 : 0 }));
      await client.call("core_course_delete_categories", { categories });
      return { ok: true, deleted: input.ids };
    }
  }
}
