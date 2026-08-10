import { z } from "zod";
import type { MoodleClient } from "../moodle-client.js";

export const USERS_TOOL = {
  name: "moodle_users",
  description:
    "Manage Moodle user accounts (admin surface). Use to create accounts, update profile fields " +
    "or passwords, delete users, or look up users by username/email/id. For enrolment into courses, " +
    "use moodle_enrolments. For role assignment, moodle_enrolments action=assign_role.",
} as const;

const UserCreate = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  firstname: z.string().min(1),
  lastname: z.string().min(1),
  email: z.string().email(),
  auth: z.string().default("manual"),
  idnumber: z.string().optional(),
  lang: z.string().optional(),
  timezone: z.string().optional(),
  city: z.string().optional(),
  country: z.string().length(2).optional().describe("ISO 3166 alpha-2 country code."),
  description: z.string().optional(),
});

const UserUpdate = z.object({
  id: z.number().int().positive(),
  username: z.string().optional(),
  password: z.string().optional(),
  firstname: z.string().optional(),
  lastname: z.string().optional(),
  email: z.string().email().optional(),
  suspended: z.boolean().optional(),
  lang: z.string().optional(),
  timezone: z.string().optional(),
  description: z.string().optional(),
});

export const UsersInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list").describe("Search users by any field. Use 'search' for a generic keyword, or 'criteria' for exact matches on specific fields."),
    search: z.string().optional().describe("Case-insensitive substring match across firstname/lastname/email/username."),
    limit: z.number().int().min(1).max(500).default(50),
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    action: z.literal("get").describe("Look up a single user by id, username, or email."),
    field: z.enum(["id", "username", "email", "idnumber"]),
    value: z.string().min(1),
  }),
  z.object({
    action: z.literal("create").describe("Create one user."),
    user: UserCreate,
  }),
  z.object({
    action: z.literal("bulk_create").describe("Create many users atomically."),
    users: z.array(UserCreate).min(1).max(100),
  }),
  z.object({
    action: z.literal("update").describe("Update fields on an existing user (by id). Omit fields to leave them unchanged."),
    user: UserUpdate,
  }),
  z.object({
    action: z.literal("bulk_update").describe("Update many users."),
    users: z.array(UserUpdate).min(1).max(100),
  }),
  z.object({
    action: z.literal("delete").describe("Delete one or more users by id. Irreversible."),
    ids: z.array(z.number().int().positive()).min(1).max(100),
  }),
]);

export async function handleUsers(client: MoodleClient, input: z.infer<typeof UsersInput>) {
  switch (input.action) {
    case "list": {
      const criteria: Array<{ key: string; value: string }> = [];
      if (input.search) criteria.push({ key: "search", value: input.search });
      // core_user_get_users wants at least one criterion; fall back to a harmless one.
      if (criteria.length === 0) criteria.push({ key: "deleted", value: "0" });
      const res = await client.call("core_user_get_users", { criteria });
      const users = Array.isArray(res?.users) ? res.users : [];
      return {
        total: users.length,
        users: users.slice(input.offset, input.offset + input.limit),
      };
    }
    case "get": {
      const res = await client.call("core_user_get_users_by_field", {
        field: input.field,
        values: [input.value],
      });
      const users = Array.isArray(res) ? res : [];
      return users[0] || null;
    }
    case "create": {
      const res = await client.call("core_user_create_users", { users: [input.user] });
      return Array.isArray(res) ? res[0] : res;
    }
    case "bulk_create": {
      return client.call("core_user_create_users", { users: input.users });
    }
    case "update": {
      await client.call("core_user_update_users", { users: [input.user] });
      return { ok: true, id: input.user.id };
    }
    case "bulk_update": {
      await client.call("core_user_update_users", { users: input.users });
      return { ok: true, count: input.users.length };
    }
    case "delete": {
      await client.call("core_user_delete_users", { userids: input.ids });
      return { ok: true, deleted: input.ids };
    }
  }
}
