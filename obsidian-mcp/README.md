# Obsidian MCP

First-party remote MCP for a server-hosted Obsidian vault. It operates on Markdown and attachments without requiring Obsidian Desktop to be running. Desktop commands, UI state and plugin commands intentionally belong to a separate local companion.

## Focused tool contract

| Tool | Purpose |
| --- | --- |
| `obsidian_get_note` | Read a full note, body, frontmatter, outline, heading section or block reference |
| `obsidian_list_notes` | List notes in a folder or subtree |
| `obsidian_search_notes` | Search text, regex, paths, tags or frontmatter |
| `obsidian_write_note` | Create, overwrite or upsert a complete note |
| `obsidian_append_to_note` | Append to a note or heading section |
| `obsidian_patch_note` | Heading- and block-aware edits |
| `obsidian_replace_in_note` | Bounded literal or regex replacement |
| `obsidian_move_note` | Move or rename a note |
| `obsidian_delete_note` | Trash by default; confirmed permanent deletion when requested |
| `obsidian_manage_frontmatter` | Get, merge, replace or delete YAML metadata |
| `obsidian_manage_tags` | List, add, remove or rename frontmatter and inline tags |
| `obsidian_links` | Resolve outgoing links, embeds, backlinks and unresolved links |
| `obsidian_bulk` | Bounded batch reads and mutations with partial-failure reporting |
| `obsidian_daily` | Read, list or append correctly dated daily notes |
| `obsidian_attachments` | List, read, upload, move or trash binary attachments |
| `obsidian_status` | Discover health, limits, policies and remote capabilities |

`obsidian_files`, `obsidian_folders` and `obsidian_search` remain as deprecated compatibility tools for existing clients.

## Safety model

- Complete writes default to create-only.
- Moves refuse destination overwrite by default.
- Deletes move content into `.trash` by default.
- Permanent deletion requires explicit path confirmation.
- Broad tag renames default to dry-run.
- Mutations accept an `expected_hash` returned by note reads to prevent lost updates.
- Mutations support dry-run where it is meaningful.
- `.obsidian` is never exposed.
- Optional read/write prefix policies restrict the visible vault surface.
- Batch operations use bounded concurrency and report partial failures; they are not represented as atomic.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `OBSIDIAN_BASE_URL` | `http://obsidian-landing:3099` | Landing/API gateway |
| `OBSIDIAN_API_KEY` | Infisical fallback | Per-client backend key |
| `MCP_BEARER_TOKEN` | required | Static bearer for internal clients |
| `OBSIDIAN_DAILY_FOLDER` | `Journal` | Vault-relative daily-note folder |
| `OBSIDIAN_TIMEZONE` | `UTC` | IANA timezone used when a date is omitted |
| `OBSIDIAN_MAX_ATTACHMENT_BYTES` | `10485760` | Maximum remote attachment read/write size |
| `OBSIDIAN_READ_PATHS` | `*` | Comma-separated readable vault prefixes |
| `OBSIDIAN_WRITE_PATHS` | `*` | Comma-separated writable vault prefixes |

OAuth is optional for a directly exposed MCP. The central gateway can instead terminate OAuth and call this service over its private Docker network.

## Development

```sh
npm install
npm test
```
