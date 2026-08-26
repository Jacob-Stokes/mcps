import assert from "node:assert/strict";
import test from "node:test";
import { mapBackendTool } from "../dist/backend-client.js";

test("backend discovery preserves standard MCP tool annotations", () => {
  const annotations = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
  const mapped = mapBackendTool("obsidian", {
    name: "obsidian_get_note",
    description: "Read a note",
    inputSchema: { type: "object" },
    annotations,
  });
  assert.deepEqual(mapped.annotations, annotations);
});

test("unannotated legacy tools remain valid", () => {
  const mapped = mapBackendTool("legacy", {
    name: "legacy_tool",
    inputSchema: { type: "object" },
  });
  assert.equal("annotations" in mapped, false);
});
