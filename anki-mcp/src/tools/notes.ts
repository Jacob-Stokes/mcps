import { z } from "zod";
import type { AnkiClient } from "../anki-client.js";

export const NOTES_TOOL = {
  name: "anki_notes",
  description: [
    "CRUD on Anki flashcard notes. Actions:",
    "• add — create a note. Requires deck_name, model_name, fields {Front, Back, ...}, optional tags.",
    "• bulk_add — create up to 50 notes in one call (preferred over looping add — AnkiConnect has a native batch endpoint).",
    "• find — search notes with Anki search syntax (e.g. 'deck:Default tag:todo').",
    "• get_info — full details (fields, cards, tags, modelName) for specific note IDs.",
    "• update — edit fields of an existing note.",
    "• bulk_update — edit fields on up to 50 notes in one call (each gets its own {note_id, fields} patch).",
    "• delete — remove notes by ID.",
    "Use anki_metadata to discover decks/models/field names first.",
  ].join(" "),
} as const;

const NoteSpec = z.object({
  deck_name: z.string().describe("Target deck."),
  model_name: z.string().describe("Note type (e.g. 'Basic', 'Cloze')."),
  fields: z.record(z.string()).describe("Map of field name → content. Must match the model's fields."),
  tags: z.array(z.string()).optional(),
});

export const NotesInput = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    deck_name: z.string().describe("Target deck (created if missing when allow_duplicate=true)."),
    model_name: z.string().describe("Note type (e.g. 'Basic', 'Cloze'). Use anki_metadata action=list_models to discover."),
    fields: z.record(z.string()).describe("Map of field name → content. Must match the model's fields."),
    tags: z.array(z.string()).optional(),
    allow_duplicate: z.boolean().optional().describe("If true, create deck if missing + allow duplicate fronts."),
  }),
  z.object({
    action: z.literal("bulk_add"),
    notes: z.array(NoteSpec).min(1).max(50),
    allow_duplicate: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("find"),
    query: z.string().describe("Anki search syntax — see https://docs.ankiweb.net/searching.html"),
  }),
  z.object({
    action: z.literal("get_info"),
    note_ids: z.array(z.number()).min(1),
  }),
  z.object({
    action: z.literal("update"),
    note_id: z.number(),
    fields: z.record(z.string()),
  }),
  z.object({
    action: z.literal("bulk_update"),
    updates: z.array(z.object({
      note_id: z.number(),
      fields: z.record(z.string()),
    })).min(1).max(50),
  }),
  z.object({
    action: z.literal("delete"),
    note_ids: z.array(z.number()).min(1),
  }),
]);

export async function handleNotes(client: AnkiClient, input: z.infer<typeof NotesInput>) {
  switch (input.action) {
    case "add": {
      const note = {
        deckName: input.deck_name,
        modelName: input.model_name,
        fields: input.fields,
        tags: input.tags ?? [],
        options: {
          allowDuplicate: !!input.allow_duplicate,
          duplicateScope: "deck",
          duplicateScopeOptions: {
            deckName: input.deck_name,
            checkChildren: false,
            checkAllModels: false,
          },
        },
      };
      const id = await client.invoke<number>("addNote", { note });
      return { note_id: id, deck: input.deck_name, model: input.model_name };
    }
    case "bulk_add": {
      // AnkiConnect has a native addNotes — sends one request, returns
      // [id|null, ...] with nulls for failed notes. Faster and cleaner than
      // looping addNote.
      const notes = input.notes.map((n) => ({
        deckName: n.deck_name,
        modelName: n.model_name,
        fields: n.fields,
        tags: n.tags ?? [],
        options: {
          allowDuplicate: !!input.allow_duplicate,
          duplicateScope: "deck",
          duplicateScopeOptions: {
            deckName: n.deck_name,
            checkChildren: false,
            checkAllModels: false,
          },
        },
      }));
      const ids = await client.invoke<Array<number | null>>("addNotes", { notes });
      const results = ids.map((id, i) => ({
        ok: id !== null,
        note_id: id,
        deck: input.notes[i].deck_name,
        model: input.notes[i].model_name,
      }));
      return {
        total: results.length,
        succeeded: results.filter((r) => r.ok).length,
        failed: results.filter((r) => !r.ok).length,
        results,
      };
    }
    case "find":
      return { note_ids: await client.invoke<number[]>("findNotes", { query: input.query }) };
    case "get_info":
      return { notes: await client.invoke<any[]>("notesInfo", { notes: input.note_ids }) };
    case "update":
      await client.invoke("updateNoteFields", { note: { id: input.note_id, fields: input.fields } });
      return { ok: true, note_id: input.note_id };
    case "bulk_update": {
      // AnkiConnect has no multi-note update; fan out sequentially
      // (Anki's local HTTP doesn't love high concurrency — 4 is safe).
      const updates = input.updates;
      const results: Array<{ ok: boolean; note_id: number; error?: string }> = [];
      let cursor = 0;
      async function worker() {
        while (cursor < updates.length) {
          const i = cursor++;
          const { note_id, fields } = updates[i];
          try {
            await client.invoke("updateNoteFields", { note: { id: note_id, fields } });
            results[i] = { ok: true, note_id };
          } catch (e: any) {
            results[i] = { ok: false, note_id, error: e?.message ?? String(e) };
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
    case "delete":
      await client.invoke("deleteNotes", { notes: input.note_ids });
      return { deleted: input.note_ids.length };
  }
}
