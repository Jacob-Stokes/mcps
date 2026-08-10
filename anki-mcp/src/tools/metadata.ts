import { z } from "zod";
import type { AnkiClient } from "../anki-client.js";

export const METADATA_TOOL = {
  name: "anki_metadata",
  description: [
    "Discover Anki deck / note-type metadata. Actions:",
    "• list_decks — every deck name.",
    "• list_models — every note-type name.",
    "• model_fields — fields on a given note type (use this before anki_notes action=add).",
  ].join(" "),
} as const;

export const MetadataInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_decks") }),
  z.object({ action: z.literal("list_models") }),
  z.object({
    action: z.literal("model_fields"),
    model_name: z.string(),
  }),
]);

export async function handleMetadata(client: AnkiClient, input: z.infer<typeof MetadataInput>) {
  switch (input.action) {
    case "list_decks":
      return { decks: await client.invoke<string[]>("deckNames") };
    case "list_models":
      return { models: await client.invoke<string[]>("modelNames") };
    case "model_fields":
      return {
        model: input.model_name,
        fields: await client.invoke<string[]>("modelFieldNames", { modelName: input.model_name }),
      };
  }
}
