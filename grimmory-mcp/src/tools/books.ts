import { z } from "zod";
import type { GrimmoryClient } from "../grimmory-client.js";

export const BOOKS_TOOL = {
  name: "grimmory_books",
  description: [
    "Browse / fetch books in Jacob's ebook library. Actions:",
    "• list — recent books, optionally filtered by library, sorted by added/title/etc.",
    "• get — full details for a specific book ID.",
    "• list_libraries — all available libraries (Fiction, Non-Fiction, Poetry, ...).",
    "For keyword search, use grimmory_search instead.",
  ].join(" "),
} as const;

export const BooksInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("list"),
    library_id: z.string().optional(),
    limit: z.number().int().min(1).max(100).default(20),
    sort: z.string().optional().describe("e.g. 'added:desc', 'title:asc'"),
  }),
  z.object({
    action: z.literal("get"),
    book_id: z.string().min(1),
  }),
  z.object({ action: z.literal("list_libraries") }),
]);

export async function handleBooks(client: GrimmoryClient, input: z.infer<typeof BooksInput>) {
  switch (input.action) {
    case "list": {
      const params = new URLSearchParams();
      params.set("size", String(input.limit));
      if (input.library_id) params.set("libraryId", input.library_id);
      if (input.sort) params.set("sort", input.sort);
      return await client.get(`/api/v1/books?${params.toString()}`);
    }
    case "get":
      return await client.get(`/api/v1/books/${encodeURIComponent(input.book_id)}`);
    case "list_libraries":
      return await client.get("/api/v1/libraries");
  }
}
