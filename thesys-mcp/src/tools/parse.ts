import { z } from "zod";
import type { ThesysClient } from "../thesys-client.js";

// Wraps thesys's /api/parse endpoint — LLM-backed free-text → structured task.
// Keep this as its own tool (not folded into thesys_tasks) because:
// 1. It's conceptually a utility, not a CRUD action
// 2. Separating it makes the tool's output shape clearer to agents
// 3. Agents may want to inspect the parse result before committing to a create

export const ParseInput = z.object({
  text: z.string().min(1).describe("Natural-language task description, e.g. 'buy milk tomorrow at 5pm !urgent'"),
});

export type ParseInput = z.infer<typeof ParseInput>;

export const PARSE_TOOL = {
  name: "thesys_parse",
  description:
    "Parse free-text into a structured task object. Use this when the user gives natural-language " +
    "task input ('remind me to call mum tomorrow') instead of hand-constructing a task payload. " +
    "Returns {kind, title, dueDate, dueTime, priority, labels}. Then call thesys_tasks with " +
    "action='create' to persist it (gives the user a chance to confirm the parse was right first).",
  inputSchema: ParseInput,
};

export async function handleParse(client: ThesysClient, input: ParseInput): Promise<any> {
  return await client.post(`/parse`, { text: input.text });
}
