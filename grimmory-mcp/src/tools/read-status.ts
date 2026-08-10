import { z } from "zod";
import type { GrimmoryClient } from "../grimmory-client.js";

export const READ_STATUS_TOOL = {
  name: "grimmory_read_status",
  description: [
    "Update read progress / status on a book. Actions:",
    "• update — one book. Set status (unread/in_progress/read) and/or progress (0.0–1.0).",
    "• bulk_update — up to 50 books in one call (good for marking a whole series).",
  ].join(" "),
} as const;

const StatusEnum = z.enum(["unread", "in_progress", "read"]);

const BookUpdate = z.object({
  book_id: z.string().min(1),
  status: StatusEnum.optional(),
  progress: z.number().min(0).max(1).optional(),
});

export const ReadStatusInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("update"),
    book_id: z.string().min(1),
    status: StatusEnum.optional(),
    progress: z.number().min(0).max(1).optional().describe("0.0 to 1.0"),
  }),
  z.object({
    action: z.literal("bulk_update"),
    updates: z.array(BookUpdate).min(1).max(50),
  }),
]);

export async function handleReadStatus(client: GrimmoryClient, input: z.infer<typeof ReadStatusInput>) {
  switch (input.action) {
    case "update":
      return await client.put(`/api/v1/books/${encodeURIComponent(input.book_id)}/read-progress`, {
        status: input.status,
        progress: input.progress,
      });
    case "bulk_update": {
      // Grimmory is small, concurrency 4 is ample.
      const updates = input.updates;
      const results: Array<{ ok: boolean; book_id: string; error?: string }> = [];
      let cursor = 0;
      async function worker() {
        while (cursor < updates.length) {
          const i = cursor++;
          const u = updates[i];
          try {
            await client.put(`/api/v1/books/${encodeURIComponent(u.book_id)}/read-progress`, {
              status: u.status, progress: u.progress,
            });
            results[i] = { ok: true, book_id: u.book_id };
          } catch (e: any) {
            results[i] = { ok: false, book_id: u.book_id, error: e?.message ?? String(e) };
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, updates.length) }, worker));
      return {
        total: results.length,
        updated: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }
  }
}
