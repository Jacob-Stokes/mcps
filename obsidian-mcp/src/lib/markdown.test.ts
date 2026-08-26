import test from "node:test";
import assert from "node:assert/strict";
import {
  extractLinks,
  extractTags,
  joinFrontmatter,
  outline,
  patchTarget,
  replaceInContent,
  resolveLinkTarget,
  splitFrontmatter,
} from "./markdown.js";
import { normalizeVaultPath, sha256, VaultPolicy, writeNoteContent, type ToolContext } from "./vault.js";

test("frontmatter round-trips nested values without changing the body", () => {
  const source = "---\ntags:\n  - research\nproject:\n  status: active\n---\n# Note\n\nBody\n";
  const split = splitFrontmatter(source);
  assert.deepEqual(split.data, { tags: ["research"], project: { status: "active" } });
  assert.equal(split.body, "# Note\n\nBody\n");
  assert.equal(splitFrontmatter(joinFrontmatter(split.data, split.body)).body, split.body);
});

test("outline and heading patches respect section boundaries", () => {
  const source = "# Root\nintro\n## Methods\nold\n### Detail\nmore\n## Results\nkeep";
  assert.deepEqual(outline(source).map((item) => item.heading), ["Root", "Methods", "Detail", "Results"]);
  const updated = patchTarget(source, "heading", "Methods", "replace", "new methods");
  assert.equal(updated, "# Root\nintro\n## Methods\nnew methods\n## Results\nkeep");
});

test("block replacement preserves the block id", () => {
  const source = "Before\nOriginal block ^claim-1\nAfter";
  assert.equal(
    patchTarget(source, "block", "^claim-1", "replace", "Revised block"),
    "Before\nRevised block ^claim-1\nAfter",
  );
});

test("tag extraction excludes fenced and inline code", () => {
  const source = "---\ntags: [alpha, beta]\n---\n#gamma `#ignored`\n```\n#also-ignored\n```\n";
  assert.deepEqual(extractTags(source), {
    frontmatter: ["alpha", "beta"],
    inline: ["gamma"],
    all: ["alpha", "beta", "gamma"],
  });
});

test("wiki and relative markdown links resolve to vault paths", () => {
  const links = extractLinks("[[People/Ada|Ada]] and [plan](../Plans/Study.md)");
  assert.equal(links.length, 2);
  assert.equal(resolveLinkTarget("Notes/Index.md", links[0].target, ["People/Ada.md", "Plans/Study.md"]), "People/Ada.md");
});

test("replacement uses native capture, named-group and dollar semantics", () => {
  const numbered = replaceInContent("Ada Lovelace", "(Ada) (Lovelace)", "$2, $1", {
    regex: true, caseSensitive: true, replaceAll: true, maxReplacements: 10,
  });
  assert.deepEqual(numbered, { content: "Lovelace, Ada", replacements: 1 });
  const named = replaceInContent("tag: old", "tag: (?<tag>old)", "tag: $<tag>-new $$", {
    regex: true, caseSensitive: true, replaceAll: false, maxReplacements: 10,
  });
  assert.deepEqual(named, { content: "tag: old-new $", replacements: 1 });
});

test("vault paths reject traversal and private Obsidian configuration", () => {
  assert.throws(() => normalizeVaultPath("../secret.md"));
  const policy = new VaultPolicy();
  assert.throws(() => policy.assertRead(".obsidian/plugins.json"));
  assert.throws(() => policy.assertRead(".trash/deleted.md"));
  assert.equal(policy.assertWrite(".trash/deleted.md", { allowTrash: true }), ".trash/deleted.md");
});

test("dry-run writes return hashes without calling the backend", async () => {
  let calls = 0;
  const ctx = {
    client: { put: async () => { calls++; } },
    policy: new VaultPolicy(),
    dailyFolder: "Journal",
    timeZone: "UTC",
    maxAttachmentBytes: 1024,
  } as unknown as ToolContext;
  const existing = { path: "Projects/Test.md", content: "before", hash: sha256("before") };
  const result = await writeNoteContent(ctx, "Projects/Test.md", "after", {
    overwrite: true,
    expectedHash: existing.hash,
    dryRun: true,
    existing,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.afterHash, sha256("after"));
  assert.equal(calls, 0);
});
