import { z } from "zod";
import type { MoodleClient } from "../moodle-client.js";

export const GROUPS_TOOL = {
  name: "moodle_groups",
  description:
    "Manage course groups (admin/teacher surface). Create, list, delete groups; add/remove members. " +
    "Groups are per-course (courseid scopes everything).",
} as const;

const GroupCreate = z.object({
  courseid: z.number().int().positive(),
  name: z.string().min(1),
  description: z.string().default(""),
  descriptionformat: z.number().int().min(0).max(4).default(1),
  idnumber: z.string().optional(),
  enrolmentkey: z.string().optional(),
});

export const GroupsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list_in_course").describe("List all groups in a course."),
    courseid: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("get").describe("Fetch one or more groups by id."),
    ids: z.array(z.number().int().positive()).min(1).max(50),
  }),
  z.object({
    action: z.literal("create").describe("Create one group."),
    group: GroupCreate,
  }),
  z.object({
    action: z.literal("bulk_create").describe("Create many groups."),
    groups: z.array(GroupCreate).min(1).max(50),
  }),
  z.object({
    action: z.literal("delete").describe("Delete groups by id."),
    ids: z.array(z.number().int().positive()).min(1).max(50),
  }),
  z.object({
    action: z.literal("list_members").describe("List members of one or more groups."),
    groupids: z.array(z.number().int().positive()).min(1).max(50),
  }),
  z.object({
    action: z.literal("add_members").describe("Add users to a group."),
    members: z.array(z.object({
      groupid: z.number().int().positive(),
      userid: z.number().int().positive(),
    })).min(1).max(500),
  }),
  z.object({
    action: z.literal("remove_members").describe("Remove users from a group."),
    members: z.array(z.object({
      groupid: z.number().int().positive(),
      userid: z.number().int().positive(),
    })).min(1).max(500),
  }),
]);

export async function handleGroups(client: MoodleClient, input: z.infer<typeof GroupsInput>) {
  switch (input.action) {
    case "list_in_course":
      return client.call("core_group_get_course_groups", { courseid: input.courseid });
    case "get":
      return client.call("core_group_get_groups", { groupids: input.ids });
    case "create": {
      const res = await client.call("core_group_create_groups", { groups: [input.group] });
      return Array.isArray(res) ? res[0] : res;
    }
    case "bulk_create":
      return client.call("core_group_create_groups", { groups: input.groups });
    case "delete":
      await client.call("core_group_delete_groups", { groupids: input.ids });
      return { ok: true, deleted: input.ids };
    case "list_members":
      return client.call("core_group_get_group_members", { groupids: input.groupids });
    case "add_members":
      await client.call("core_group_add_group_members", { members: input.members });
      return { ok: true, count: input.members.length };
    case "remove_members":
      await client.call("core_group_delete_group_members", { members: input.members });
      return { ok: true, count: input.members.length };
  }
}
