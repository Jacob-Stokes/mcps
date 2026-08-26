import { parse, stringify } from "yaml";
import path from "node:path";

export type FrontmatterSplit = {
  data: Record<string, unknown>;
  body: string;
  hasFrontmatter: boolean;
};

export function splitFrontmatter(content: string): FrontmatterSplit {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) {
    return { data: {}, body: content, hasFrontmatter: false };
  }
  const newline = content.startsWith("---\r\n") ? "\r\n" : "\n";
  const marker = `${newline}---`;
  const end = content.indexOf(marker, 3);
  if (end === -1) return { data: {}, body: content, hasFrontmatter: false };
  const yamlText = content.slice(3 + newline.length, end);
  const parsed = parse(yamlText) ?? {};
  if (typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("frontmatter must be a YAML mapping");
  let body = content.slice(end + marker.length);
  if (body.startsWith(newline)) body = body.slice(newline.length);
  return { data: parsed as Record<string, unknown>, body, hasFrontmatter: true };
}

export function joinFrontmatter(data: Record<string, unknown>, body: string): string {
  if (Object.keys(data).length === 0) return body;
  const yamlText = stringify(data, { lineWidth: 0 }).trimEnd();
  return `---\n${yamlText}\n---\n${body}`;
}

export function outline(content: string) {
  return content.split(/\r?\n/).flatMap((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    return match ? [{ level: match[1].length, heading: match[2], line: index + 1 }] : [];
  });
}

type Section = { start: number; bodyStart: number; end: number; heading: string; level: number };

export function findHeadingSection(content: string, heading: string, occurrence = 1): Section | null {
  const lines = content.split("\n");
  const wanted = normalizeHeading(heading);
  let seen = 0;
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match || normalizeHeading(match[2]) !== wanted) continue;
    seen++;
    if (seen !== occurrence) continue;
    const level = match[1].length;
    let end = lines.length;
    for (let next = index + 1; next < lines.length; next++) {
      const nextHeading = lines[next].match(/^(#{1,6})\s+/);
      if (nextHeading && nextHeading[1].length <= level) { end = next; break; }
    }
    return { start: index, bodyStart: index + 1, end, heading: match[2], level };
  }
  return null;
}

export function extractHeadingSection(content: string, heading: string, occurrence = 1): string | null {
  const section = findHeadingSection(content, heading, occurrence);
  if (!section) return null;
  return content.split("\n").slice(section.start, section.end).join("\n");
}

export function findBlockLine(content: string, blockId: string): { line: number; text: string } | null {
  const wanted = blockId.replace(/^\^/, "");
  const lines = content.split("\n");
  const pattern = new RegExp(`(?:^|\\s)\\^${escapeRegex(wanted)}\\s*$`);
  for (let index = 0; index < lines.length; index++) {
    if (pattern.test(lines[index])) return { line: index, text: lines[index] };
  }
  return null;
}

export function patchTarget(
  content: string,
  targetType: "heading" | "block",
  target: string,
  operation: "replace" | "append" | "prepend" | "delete" | "insert_before" | "insert_after",
  replacement = "",
  occurrence = 1,
): string {
  const lines = content.split("\n");
  let start: number;
  let bodyStart: number;
  let end: number;
  if (targetType === "heading") {
    const section = findHeadingSection(content, target, occurrence);
    if (!section) throw new Error(`heading not found: ${target}`);
    ({ start, bodyStart, end } = section);
  } else {
    const block = findBlockLine(content, target);
    if (!block) throw new Error(`block reference not found: ${target}`);
    start = block.line;
    bodyStart = start;
    end = start + 1;
  }

  const inserted = replacement ? replacement.split("\n") : [];
  switch (operation) {
    case "replace":
      if (targetType === "heading") lines.splice(bodyStart, end - bodyStart, ...inserted);
      else {
        const id = target.replace(/^\^/, "");
        const withId = replacement.match(new RegExp(`\\^${escapeRegex(id)}\\s*$`))
          ? replacement
          : `${replacement.replace(/\s+$/, "")} ^${id}`;
        lines.splice(start, 1, ...withId.split("\n"));
      }
      break;
    case "append":
      lines.splice(end, 0, ...inserted);
      break;
    case "prepend":
      lines.splice(targetType === "heading" ? bodyStart : start, 0, ...inserted);
      break;
    case "delete":
      lines.splice(start, end - start);
      break;
    case "insert_before":
      lines.splice(start, 0, ...inserted);
      break;
    case "insert_after":
      lines.splice(end, 0, ...inserted);
      break;
  }
  return lines.join("\n");
}

export function extractTags(content: string): { frontmatter: string[]; inline: string[]; all: string[] } {
  const { data, body } = splitFrontmatter(content);
  const raw = data.tags;
  const frontmatter = (Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[ ,]+/) : [])
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.replace(/^#/, ""))
    .filter(Boolean);
  const withoutCode = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`]*`/g, "");
  const inline = [...withoutCode.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((match) => match[2]);
  const unique = (values: string[]) => [...new Set(values)].sort();
  return { frontmatter: unique(frontmatter), inline: unique(inline), all: unique([...frontmatter, ...inline]) };
}

export type NoteLink = {
  target: string;
  alias?: string;
  embed: boolean;
  kind: "wiki" | "markdown";
};

export function extractLinks(content: string): NoteLink[] {
  const links: NoteLink[] = [];
  const wiki = /(!)?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?\]\]/g;
  for (const match of content.matchAll(wiki)) {
    links.push({ target: match[2].trim(), alias: match[3]?.trim(), embed: !!match[1], kind: "wiki" });
  }
  const markdown = /(!)?\[([^\]]*)\]\((?!https?:|mailto:|obsidian:)([^)#]+)(?:#[^)]+)?\)/g;
  for (const match of content.matchAll(markdown)) {
    links.push({ target: decodeURIComponent(match[3].trim()), alias: match[2] || undefined, embed: !!match[1], kind: "markdown" });
  }
  return links;
}

export function replaceInContent(
  content: string,
  find: string,
  replacement: string,
  options: { regex: boolean; caseSensitive: boolean; replaceAll: boolean; maxReplacements: number },
): { content: string; replacements: number } {
  const flags = `${options.replaceAll ? "g" : ""}${options.caseSensitive ? "" : "i"}`;
  let expression: RegExp;
  try {
    expression = new RegExp(options.regex ? find : escapeRegex(find), flags);
  } catch (error: any) {
    throw new Error(`invalid regular expression: ${error.message}`);
  }
  const countingFlags = expression.flags.includes("g") ? expression.flags : `${expression.flags}g`;
  const countingExpression = new RegExp(expression.source, countingFlags);
  const replacements = [...content.matchAll(countingExpression)].length;
  const effectiveReplacements = options.replaceAll ? replacements : Math.min(replacements, 1);
  if (effectiveReplacements === 0) throw new Error("find pattern did not match the note");
  if (effectiveReplacements > options.maxReplacements) {
    throw new Error(`refusing ${effectiveReplacements} replacements; max_replacements is ${options.maxReplacements}`);
  }
  return { content: content.replace(expression, replacement), replacements: effectiveReplacements };
}

export function resolveLinkTarget(sourcePath: string, target: string, notePaths: string[]): string | null {
  const clean = target.replace(/\.md$/i, "");
  const exact = `${clean}.md`;
  const sourceDir = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
  const relative = path.posix.normalize(sourceDir ? `${sourceDir}/${exact}` : exact).replace(/^\.\//, "");
  const candidates = notePaths.filter((candidate) =>
    candidate === target || candidate === exact || candidate === relative || candidate.replace(/\.md$/i, "").endsWith(`/${clean}`),
  );
  return candidates.length === 1 ? candidates[0] : candidates.find((candidate) => candidate === relative) ?? null;
}

function normalizeHeading(value: string): string {
  return value.replace(/^#+\s*/, "").trim().toLocaleLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
