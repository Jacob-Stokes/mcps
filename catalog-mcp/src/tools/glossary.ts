import { z } from "zod";
import type { CatalogClient } from "../catalog-client.js";

// The glossary is the "where does X live" routing map — given a user topic
// like 'tasks' or 'books', which service owns it + which MCP tool to use.
// Also includes host descriptions (resolution / adventure).

export const GlossaryInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("all"),
  }),
  z.object({
    action: z.literal("lookup"),
    topic: z.string().describe("Topic to look up, e.g. 'tasks', 'books', 'articles', 'notes', 'journal', 'events'. Returns null if no routing entry matches."),
  }),
]);

export type GlossaryInput = z.infer<typeof GlossaryInput>;

export const GLOSSARY_TOOL = {
  name: "catalog_glossary",
  description:
    "The homelab glossary — Jacob's 'where does X live' routing map. Given a topic (tasks, books, " +
    "articles, notes, journal, events, etc.), returns the primary service that owns it, which MCP " +
    "tool to use (if any), and a disambiguation note. Use 'all' to fetch the whole map (useful at " +
    "the start of a query to understand available topics); use 'lookup' for a single topic when you " +
    "know exactly what you need.",
  inputSchema: GlossaryInput,
};

export async function handleGlossary(client: CatalogClient, input: GlossaryInput): Promise<any> {
  const res = await client.get(`/api/glossary`);
  if (input.action === "all") {
    return {
      topic_count: res?.routing ? Object.keys(res.routing).length : 0,
      routing: res?.routing ?? {},
      hosts: res?.hosts ?? {},
    };
  }
  // action === "lookup"
  const entry = res?.routing?.[input.topic];
  if (!entry) {
    // Also check if the topic is a known alias by exact-match scan
    const available = Object.keys(res?.routing ?? {});
    return {
      topic: input.topic,
      found: false,
      available_topics: available,
    };
  }
  return { topic: input.topic, found: true, ...entry };
}
