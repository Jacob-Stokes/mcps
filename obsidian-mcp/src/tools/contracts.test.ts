import test from "node:test";
import assert from "node:assert/strict";
import { zodToJsonSchema } from "mcp-common";
import { GET_NOTE_TOOL, GetNoteInput, LIST_NOTES_TOOL, ListNotesInput, WRITE_NOTE_TOOL, WriteNoteInput,
  APPEND_NOTE_TOOL, AppendNoteInput, PATCH_NOTE_TOOL, PatchNoteInput, REPLACE_NOTE_TOOL, ReplaceNoteInput,
  MOVE_NOTE_TOOL, MoveNoteInput, DELETE_NOTE_TOOL, DeleteNoteInput } from "./notes.js";
import { SEARCH_NOTES_TOOL, SearchNotesInput } from "./search-notes.js";
import { FRONTMATTER_TOOL, FrontmatterInput, TAGS_TOOL, TagsInput, resolveTagsDryRun } from "./metadata.js";
import { LINKS_TOOL, LinksInput } from "./links.js";
import { BULK_TOOL, BulkInput } from "./bulk.js";
import { DAILY_TOOL, DailyInput } from "./daily.js";
import { ATTACHMENTS_TOOL, AttachmentsInput } from "./attachments.js";
import { STATUS_TOOL, StatusInput } from "./status.js";

const focused = [
  [GET_NOTE_TOOL, GetNoteInput], [LIST_NOTES_TOOL, ListNotesInput], [SEARCH_NOTES_TOOL, SearchNotesInput],
  [WRITE_NOTE_TOOL, WriteNoteInput], [APPEND_NOTE_TOOL, AppendNoteInput], [PATCH_NOTE_TOOL, PatchNoteInput],
  [REPLACE_NOTE_TOOL, ReplaceNoteInput], [MOVE_NOTE_TOOL, MoveNoteInput], [DELETE_NOTE_TOOL, DeleteNoteInput],
  [FRONTMATTER_TOOL, FrontmatterInput], [TAGS_TOOL, TagsInput], [LINKS_TOOL, LinksInput],
  [BULK_TOOL, BulkInput], [DAILY_TOOL, DailyInput], [ATTACHMENTS_TOOL, AttachmentsInput], [STATUS_TOOL, StatusInput],
] as const;

test("focused tool names are unique and every contract emits an object schema", () => {
  const names = focused.map(([tool]) => tool.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, 16);
  for (const [tool, schema] of focused) {
    assert.match(tool.name, /^obsidian_[a-z_]+$/);
    assert.ok(tool.description.length > 40);
    const json = zodToJsonSchema(schema);
    assert.equal(json.type, "object", tool.name);
    assert.equal(json.additionalProperties, false, tool.name);
  }
});

test("destructive contracts keep safe defaults", () => {
  assert.equal(DeleteNoteInput.parse({ path: "A.md" }).mode, "trash");
  assert.equal((AttachmentsInput.parse({ action: "delete", path: "image.png" }) as any).mode, "trash");
  assert.equal(WriteNoteInput.parse({ path: "A.md", content: "x" }).mode, "create");
});

test("tag mutation dry-run behavior is contextual and not misrepresented in JSON schema", () => {
  assert.equal(resolveTagsDryRun({ action: "add", path: "A.md" }), false);
  assert.equal(resolveTagsDryRun({ action: "remove", path: "A.md" }), false);
  assert.equal(resolveTagsDryRun({ action: "rename", path: "A.md" }), false);
  assert.equal(resolveTagsDryRun({ action: "rename", path: "Folder" }), true);
  assert.equal(resolveTagsDryRun({ action: "rename" }), true);
  assert.equal(resolveTagsDryRun({ action: "rename", dry_run: false }), false);
  assert.equal(resolveTagsDryRun({ action: "rename", path: "A.md", dry_run: true }), true);

  const tags = zodToJsonSchema(TagsInput);
  assert.equal("default" in tags.properties.dry_run, false);
  assert.match(TAGS_TOOL.description, /note-scoped rename execute/);
});

test("frontmatter records and numeric bounds survive schema conversion", () => {
  const frontmatter = zodToJsonSchema(FrontmatterInput);
  assert.equal(frontmatter.properties.fields.type, "object");
  assert.ok("additionalProperties" in frontmatter.properties.fields);
  const list = zodToJsonSchema(ListNotesInput);
  assert.equal(list.properties.limit.type, "integer");
  assert.equal(list.properties.limit.maximum, 2000);
});
