import { z } from "zod";
import type { MoodleClient } from "../moodle-client.js";

export const ENROLMENTS_TOOL = {
  name: "moodle_enrolments",
  description:
    "Enrol/unenrol users in courses and assign roles (admin surface). Requires 'manual' enrolment " +
    "method to be enabled on the course. Role IDs: 3=editingteacher, 4=teacher, 5=student, 1=manager " +
    "(site-wide). Use list_in_course to audit who's enrolled where.",
} as const;

const Enrolment = z.object({
  userid: z.number().int().positive(),
  courseid: z.number().int().positive(),
  roleid: z.number().int().positive().default(5).describe("Default 5 = student."),
  timestart: z.number().int().optional(),
  timeend: z.number().int().optional(),
  suspend: z.number().int().min(0).max(1).optional(),
});

const RoleAssign = z.object({
  userid: z.number().int().positive(),
  roleid: z.number().int().positive(),
  contextid: z.number().int().positive().optional().describe("Explicit context id (e.g. a category). Prefer contextlevel+instanceid for course/system contexts."),
  contextlevel: z.enum(["system", "user", "coursecat", "course", "module", "block"]).optional(),
  instanceid: z.number().int().optional().describe("For contextlevel=course, the courseid. For system, any."),
});

export const EnrolmentsInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list_in_course").describe("List enrolled users in a course."),
    courseid: z.number().int().positive(),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    action: z.literal("list_courses_of_user").describe("List courses a user is enrolled in."),
    userid: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("enrol_user").describe("Enrol one user in one course (manual plugin)."),
    enrolment: Enrolment,
  }),
  z.object({
    action: z.literal("bulk_enrol").describe("Enrol many users at once."),
    enrolments: z.array(Enrolment).min(1).max(500),
  }),
  z.object({
    action: z.literal("unenrol_user").describe("Remove one user from one course."),
    userid: z.number().int().positive(),
    courseid: z.number().int().positive(),
    roleid: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal("bulk_unenrol").describe("Remove many enrolments at once."),
    enrolments: z.array(z.object({
      userid: z.number().int().positive(),
      courseid: z.number().int().positive(),
      roleid: z.number().int().positive().optional(),
    })).min(1).max(500),
  }),
  z.object({
    action: z.literal("assign_role").describe("Assign a role to a user in a given context (course by default)."),
    assignments: z.array(RoleAssign).min(1).max(100),
  }),
  z.object({
    action: z.literal("unassign_role").describe("Remove role assignments."),
    assignments: z.array(RoleAssign).min(1).max(100),
  }),
]);

export async function handleEnrolments(client: MoodleClient, input: z.infer<typeof EnrolmentsInput>) {
  switch (input.action) {
    case "list_in_course": {
      const users = await client.call("core_enrol_get_enrolled_users", { courseid: input.courseid });
      const safe = Array.isArray(users) ? users : [];
      return { total: safe.length, users: safe.slice(input.offset, input.offset + input.limit) };
    }
    case "list_courses_of_user":
      return client.call("core_enrol_get_users_courses", { userid: input.userid });
    case "enrol_user":
      await client.call("enrol_manual_enrol_users", { enrolments: [input.enrolment] });
      return { ok: true };
    case "bulk_enrol":
      await client.call("enrol_manual_enrol_users", { enrolments: input.enrolments });
      return { ok: true, count: input.enrolments.length };
    case "unenrol_user":
      await client.call("enrol_manual_unenrol_users", {
        enrolments: [{ userid: input.userid, courseid: input.courseid, roleid: input.roleid }],
      });
      return { ok: true };
    case "bulk_unenrol":
      await client.call("enrol_manual_unenrol_users", { enrolments: input.enrolments });
      return { ok: true, count: input.enrolments.length };
    case "assign_role":
      await client.call("core_role_assign_roles", { assignments: input.assignments });
      return { ok: true, count: input.assignments.length };
    case "unassign_role":
      await client.call("core_role_unassign_roles", { unassignments: input.assignments });
      return { ok: true, count: input.assignments.length };
  }
}
