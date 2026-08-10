import { z } from "zod";
import type { GrimmoryClient } from "../grimmory-client.js";

export const SEARCH_TOOL = {
  name: "grimmory_search",
  description:
    "Full-text search across Jacob's ebook library. Matches title, author, series, description. " +
    "Optionally scope to one library (Fiction/Non-Fiction/Poetry/etc.). " +
    "For browsing (no query), use grimmory_books action=list instead.",
} as const;

export const SearchInput = z.object({
  query: z.string().min(1),
  library_id: z.string().optional().describe("Restrict to a single library."),
  limit: z.number().int().min(1).max(100).default(20),
});

export async function handleSearch(client: GrimmoryClient, input: z.infer<typeof SearchInput>) {
  const params = new URLSearchParams();
  params.set("q", input.query);
  params.set("size", String(input.limit));
  if (input.library_id) params.set("libraryId", input.library_id);
  return await client.get(`/api/v1/books/search?${params.toString()}`);
}
