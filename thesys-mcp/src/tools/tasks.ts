import { z } from "zod";
import type { ThesysClient } from "../thesys-client.js";

// ─────────── Shapes ───────────

export const TaskStatus = z.enum(["todo", "done", "archived"]);

const CreateTaskInput = z.object({
  title: z.string().min(1),
  priority: z.number().int().min(0).max(5).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD (user's local timezone)"),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).optional().describe("HH:MM (24h)"),
  description: z.string().optional(),
  labels: z.array(z.string()).optional(),
});

const UpdateTaskFields = z.object({
  title: z.string().optional(),
  status: TaskStatus.optional(),
  priority: z.number().int().min(0).max(5).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueTime: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  description: z.string().optional(),
});

// ─────────── Tool schema ───────────

export const TasksInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    status: TaskStatus.optional().describe("Filter by status. Omit for all."),
    limit: z.number().int().positive().max(200).default(50),
  }),
  z.object({
    action: z.literal("get"),
    id: z.string().describe("Task id, e.g. task_XXXX"),
  }),
  z.object({
    action: z.literal("create"),
    task: CreateTaskInput,
  }),
  z.object({
    action: z.literal("update"),
    id: z.string(),
    fields: UpdateTaskFields,
  }),
  z.object({
    action: z.literal("delete"),
    id: z.string(),
  }),
  z.object({
    action: z.literal("bulk_create"),
    tasks: z.array(CreateTaskInput).min(1).max(50),
  }),
  z.object({
    action: z.literal("bulk_update"),
    updates: z.array(z.object({ id: z.string(), fields: UpdateTaskFields })).min(1).max(50),
  }),
  z.object({
    action: z.literal("bulk_delete"),
    ids: z.array(z.string()).min(1).max(50),
  }),
]);

export type TasksInput = z.infer<typeof TasksInput>;

export const TASKS_TOOL = {
  name: "thesys_tasks",
  description:
    "Manage Jacob's thesys tasks. Covers list/get/create/update/delete plus bulk_create/bulk_update/bulk_delete. " +
    "To mark done: update with {status:'done'}. To undo done: update with {status:'todo'}. " +
    "For free-text task creation ('buy milk tomorrow'), call thesys_parse first then create with the result.",
  inputSchema: TasksInput,
};

// ─────────── Handler ───────────

export async function handleTasks(client: ThesysClient, input: TasksInput): Promise<any> {
  switch (input.action) {
    case "list": {
      const params = new URLSearchParams();
      if (input.status) params.set("status", input.status);
      const qs = params.toString();
      const tasks = await client.get(`/tasks${qs ? "?" + qs : ""}`);
      const trimmed = Array.isArray(tasks) ? tasks.slice(0, input.limit).map(compactTask) : tasks;
      return { count: Array.isArray(tasks) ? tasks.length : 0, tasks: trimmed };
    }

    case "get":
      return await client.get(`/tasks/${encodeURIComponent(input.id)}`);

    case "create":
      return await client.post(`/tasks`, input.task);

    case "update":
      return await client.patch(`/tasks/${encodeURIComponent(input.id)}`, input.fields);

    case "delete":
      await client.delete(`/tasks/${encodeURIComponent(input.id)}`);
      return { deleted: input.id };

    case "bulk_create": {
      const results = await Promise.all(
        input.tasks.map(async (task) => {
          try {
            const res = await client.post(`/tasks`, task);
            return { ok: true, id: res?.id, title: task.title };
          } catch (e: any) {
            return { ok: false, title: task.title, error: e.message };
          }
        }),
      );
      return {
        total: results.length,
        created: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }

    case "bulk_update": {
      const results = await Promise.all(
        input.updates.map(async ({ id, fields }) => {
          try {
            const res = await client.patch(`/tasks/${encodeURIComponent(id)}`, fields);
            return { ok: true, id, title: res?.title };
          } catch (e: any) {
            return { ok: false, id, error: e.message };
          }
        }),
      );
      return {
        total: results.length,
        updated: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }

    case "bulk_delete": {
      const results = await Promise.all(
        input.ids.map(async (id) => {
          try {
            await client.delete(`/tasks/${encodeURIComponent(id)}`);
            return { ok: true, id };
          } catch (e: any) {
            return { ok: false, id, error: e.message };
          }
        }),
      );
      return {
        total: results.length,
        deleted: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }
  }
}

// Trim task records to what agents actually need, saves tokens per result.
function compactTask(t: any) {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    labels: t.labels,
    project: t.project?.title,
  };
}
