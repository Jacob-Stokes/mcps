import { z } from "zod";
import type { AnkiClient } from "../anki-client.js";

export const SYNC_TOOL = {
  name: "anki_sync",
  description: "Trigger Anki → AnkiWeb sync. No input.",
} as const;

export const SyncInput = z.object({});

export async function handleSync(client: AnkiClient, _input: z.infer<typeof SyncInput>) {
  await client.invoke("sync");
  return { ok: true, synced: true };
}
