// Tiny HTML admin page. Lists backends with checkboxes + token cost estimate.
// Gated at the network layer (Cloudflare Access on /admin/*), so this page
// itself has no auth beyond relying on that gate.

import type { GatewayConfig } from "./config.js";
import type { BackendTool } from "./backend-client.js";

/**
 * Very rough token estimate: 1 token ~= 4 chars of JSON schema + description.
 * Good enough for relative comparison ("how much will disabling X save me").
 */
function estimateTokens(tools: BackendTool[]): number {
  let chars = 0;
  for (const t of tools) {
    chars += t.name.length + t.description.length + JSON.stringify(t.inputSchema).length;
  }
  return Math.ceil(chars / 4);
}

export function renderAdminPage(
  cfg: GatewayConfig,
  toolsByBackend: Map<string, BackendTool[]>,
  errorsByBackend: Map<string, string | null>,
): string {
  const totalEnabledTokens = cfg.backends
    .filter((b) => b.enabled)
    .reduce((n, b) => n + estimateTokens(toolsByBackend.get(b.name) ?? []), 0);
  const totalAllTokens = cfg.backends
    .reduce((n, b) => n + estimateTokens(toolsByBackend.get(b.name) ?? []), 0);

  const rows = cfg.backends
    .map((b) => {
      const tools = toolsByBackend.get(b.name) ?? [];
      const tokens = estimateTokens(tools);
      const err = errorsByBackend.get(b.name);
      const status = err ? `<span class="err" title="${escapeAttr(err)}">error</span>` : `<span class="ok">${tools.length} tools</span>`;
      const toolList = tools.map((t) => `<code>${escapeHtml(t.name)}</code>`).join(" ") || "<em>no tools</em>";
      const key = escapeAttr(b.name);
      return `
        <tr>
          <td><input type="checkbox" name="enabled" value="${key}" ${b.enabled ? "checked" : ""}></td>
          <td>
            <strong>${escapeHtml(b.name)}</strong>
            <div class="field-grid">
              <label>url <input type="text" name="url__${key}" value="${escapeAttr(b.url)}"></label>
              <label>bearerEnv <input type="text" name="bearerEnv__${key}" value="${escapeAttr(b.bearerEnv)}"></label>
              <label>transport
                <select name="transport__${key}">
                  <option value="mcp" ${b.transport === "mcp" ? "selected" : ""}>mcp</option>
                  <option value="sse" ${b.transport === "sse" ? "selected" : ""}>sse</option>
                </select>
              </label>
              <label>description <input type="text" name="description__${key}" value="${escapeAttr(b.description ?? "")}"></label>
            </div>
          </td>
          <td class="status">${status}</td>
          <td class="tokens">~${tokens.toLocaleString()}</td>
          <td class="tools">${toolList}</td>
        </tr>`;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>MCP Gateway — Admin</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2em auto; padding: 0 1em; color: #222; }
  h1 { margin-bottom: 0.2em; }
  .summary { padding: 1em; background: #f3f4f6; border-radius: 8px; margin: 1em 0; display: flex; gap: 2em; }
  .summary .metric { display: flex; flex-direction: column; }
  .summary strong { font-size: 1.5em; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 0.75em 0.5em; text-align: left; vertical-align: top; }
  th { background: #f9fafb; font-weight: 600; }
  td.status, td.tokens { text-align: right; white-space: nowrap; }
  .ok { color: #15803d; }
  .err { color: #b91c1c; font-weight: 600; cursor: help; }
  code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; font-size: 0.85em; }
  .tools { font-size: 0.85em; color: #4b5563; }
  small { color: #6b7280; }
  button { background: #111; color: white; border: 0; padding: 0.6em 1.2em; font-size: 1em; border-radius: 5px; cursor: pointer; }
  button:hover { background: #333; }
  .footer { margin-top: 2em; color: #6b7280; font-size: 0.85em; }
  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.4em 0.8em; margin-top: 0.4em; }
  .field-grid label { display: flex; flex-direction: column; font-size: 0.75em; color: #6b7280; gap: 0.15em; }
  .field-grid input, .field-grid select, .add-grid input, .add-grid select { font: inherit; font-size: 0.85em; padding: 0.3em 0.4em; border: 1px solid #d1d5db; border-radius: 4px; }
  .add-backend { margin-top: 2em; padding: 1em; background: #f9fafb; border-radius: 8px; }
  .add-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.6em; align-items: end; }
  .add-grid label { display: flex; flex-direction: column; font-size: 0.75em; color: #6b7280; gap: 0.2em; }
</style>
</head>
<body>
<h1>MCP Gateway</h1>
<p>Tick backends to include them in the gateway's advertised tool set. Disabled backends drop out of the next <code>tools/list</code> response → fewer tokens in every LLM call.</p>

<div class="summary">
  <div class="metric"><small>Currently advertised</small><strong>~${totalEnabledTokens.toLocaleString()} tokens</strong></div>
  <div class="metric"><small>All backends</small><strong>~${totalAllTokens.toLocaleString()} tokens</strong></div>
  <div class="metric"><small>Savings</small><strong>${Math.max(0, totalAllTokens - totalEnabledTokens).toLocaleString()}</strong></div>
</div>

<form method="POST" action="/admin/save">
  <table>
    <thead>
      <tr><th>On</th><th>Backend</th><th>Status</th><th>~ Tokens</th><th>Tools</th></tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="add-backend">
    <strong>Add a new backend</strong>
    <div class="add-grid">
      <label>name <input type="text" name="new_name" placeholder="e.g. my-service"></label>
      <label>url <input type="text" name="new_url" placeholder="http://host:port/mcp"></label>
      <label>transport
        <select name="new_transport">
          <option value="mcp" selected>mcp</option>
          <option value="sse">sse</option>
        </select>
      </label>
      <label>bearerEnv <input type="text" name="new_bearerEnv" placeholder="MCP_FOO_BEARER_TOKEN"></label>
      <label>description <input type="text" name="new_description" placeholder="optional"></label>
    </div>
    <p><label><input type="checkbox" name="new_enabled" value="1" checked> enabled</label></p>
  </div>

  <p style="margin-top: 1em"><button type="submit">Save + reload</button></p>
</form>

<div class="footer">
  Endpoint: <code>/mcp</code> on this host's canonical URL — OAuth-gated via Authentik.<br/>
  Token estimate is rough (4 chars ≈ 1 token). Real cost depends on model + prompt caching.<br/>
  Config: <code>/data/gateway.json</code> in the container.
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, "&quot;");
}
