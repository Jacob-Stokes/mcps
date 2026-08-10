import { z } from "zod";
import type { MoodleClient } from "../moodle-client.js";

export const COURSES_TOOL = {
  name: "moodle_courses",
  description:
    "Manage Moodle courses (admin surface). Create, update, duplicate, delete courses; list by " +
    "field; inspect a course's section/module content tree. For categories use moodle_categories, " +
    "for enrolling users use moodle_enrolments.",
} as const;

const CourseCreate = z.object({
  fullname: z.string().min(1),
  shortname: z.string().min(1),
  categoryid: z.number().int().positive(),
  idnumber: z.string().optional(),
  summary: z.string().optional(),
  summaryformat: z.number().int().min(0).max(4).default(1).describe("0=Moodle, 1=HTML, 2=plain text, 4=Markdown"),
  format: z.string().optional().describe("Course format: topics, weeks, social, singleactivity, tiles."),
  visible: z.number().int().min(0).max(1).optional(),
  startdate: z.number().int().optional().describe("Unix timestamp."),
  enddate: z.number().int().optional(),
  numsections: z.number().int().min(0).optional(),
});

const CourseUpdate = z.object({
  id: z.number().int().positive(),
  fullname: z.string().optional(),
  shortname: z.string().optional(),
  categoryid: z.number().int().positive().optional(),
  idnumber: z.string().optional(),
  summary: z.string().optional(),
  summaryformat: z.number().int().min(0).max(4).optional(),
  format: z.string().optional(),
  visible: z.number().int().min(0).max(1).optional(),
  startdate: z.number().int().optional(),
  enddate: z.number().int().optional(),
});

export const CoursesInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list").describe("List courses (optionally by field)."),
    field: z.enum(["ids", "category", "shortname", "idnumber"]).optional(),
    value: z.string().optional().describe("For field=ids: comma-separated list."),
    limit: z.number().int().min(1).max(500).default(100),
    offset: z.number().int().min(0).default(0),
  }),
  z.object({
    action: z.literal("get").describe("Fetch one course by id."),
    id: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("contents").describe("Fetch course section/module tree (activities and resources)."),
    id: z.number().int().positive(),
  }),
  z.object({
    action: z.literal("create").describe("Create one course."),
    course: CourseCreate,
  }),
  z.object({
    action: z.literal("bulk_create").describe("Create many courses."),
    courses: z.array(CourseCreate).min(1).max(50),
  }),
  z.object({
    action: z.literal("update").describe("Update fields on a course."),
    course: CourseUpdate,
  }),
  z.object({
    action: z.literal("delete").describe("Delete course(s) by id. Irreversible."),
    ids: z.array(z.number().int().positive()).min(1).max(50),
  }),
  z.object({
    action: z.literal("duplicate").describe("Duplicate an existing course into a new one."),
    courseid: z.number().int().positive(),
    fullname: z.string().min(1),
    shortname: z.string().min(1),
    categoryid: z.number().int().positive(),
    visible: z.number().int().min(0).max(1).default(1),
  }),
]);

export async function handleCourses(client: MoodleClient, input: z.infer<typeof CoursesInput>) {
  switch (input.action) {
    case "list": {
      if (input.field === "ids" && input.value) {
        const ids = input.value.split(",").map((s) => parseInt(s.trim(), 10)).filter(Boolean);
        const all = await client.call("core_course_get_courses", { options: { ids } });
        return sliceArr(all, input.offset, input.limit);
      }
      if (input.field && input.value) {
        const res = await client.call("core_course_get_courses_by_field", { field: input.field, value: input.value });
        return sliceArr(res?.courses ?? [], input.offset, input.limit);
      }
      const all = await client.call("core_course_get_courses", {});
      return sliceArr(all, input.offset, input.limit);
    }
    case "get": {
      const res = await client.call("core_course_get_courses_by_field", { field: "id", value: String(input.id) });
      const rows = Array.isArray(res?.courses) ? res.courses : [];
      return rows[0] || null;
    }
    case "contents":
      return client.call("core_course_get_contents", { courseid: input.id });
    case "create": {
      const res = await client.call("core_course_create_courses", { courses: [input.course] });
      return Array.isArray(res) ? res[0] : res;
    }
    case "bulk_create":
      return client.call("core_course_create_courses", { courses: input.courses });
    case "update":
      await client.call("core_course_update_courses", { courses: [input.course] });
      return { ok: true, id: input.course.id };
    case "delete":
      await client.call("core_course_delete_courses", { courseids: input.ids });
      return { ok: true, deleted: input.ids };
    case "duplicate":
      return client.call("core_course_duplicate_course", {
        courseid: input.courseid,
        fullname: input.fullname,
        shortname: input.shortname,
        categoryid: input.categoryid,
        visible: input.visible,
      });
  }
}

function sliceArr<T>(arr: T[], offset: number, limit: number): { total: number; items: T[] } {
  const safe = Array.isArray(arr) ? arr : [];
  return { total: safe.length, items: safe.slice(offset, offset + limit) };
}
