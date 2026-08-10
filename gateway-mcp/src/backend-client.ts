// Thin MCP client that connects to a backend MCP (streamable HTTP or legacy
// SSE) on thesys-net, using the static bearer as auth. Reuses one persistent
// connection per backend. On first tools/list, caches the result.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { BackendConfig } from "./config.js";

export interface BackendTool {
  backend: string;        // backend name (e.g. "obsidian")
  name: string;           // tool name as advertised by backend (e.g. "obsidian_files")
  description: string;
  inputSchema: any;       // raw JSON schema (already Anthropic-compatible — backends produce it that way)
}

export class Backend {
  private client: Client;
  private ready: Promise<void> | null = null;
  public tools: BackendTool[] = [];
  public error: string | null = null;
  public lastAttemptMs = 0;

  constructor(public readonly cfg: BackendConfig, private bearer: string) {
    this.client = new Client(
      { name: "gateway-mcp", version: "0.1.0" },
      { capabilities: {} },
    );
  }

  private async ensureConnected(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.connect().catch((e) => {
      // A failed connect must not poison future attempts — clear the cached
      // promise so the next call rebuilds the client and tries again.
      // (This was the post-reboot bug: gateway booted before backends,
      // cached 13 rejected promises, and stayed errored until restarted.)
      this.ready = null;
      throw e;
    });
    return this.ready;
  }

  private async connect(): Promise<void> {
    // Fresh Client per attempt — the SDK client isn't reusable after a
    // failed or closed connection.
    this.client = new Client(
      { name: "gateway-mcp", version: "0.1.0" },
      { capabilities: {} },
    );
    const authHeader = { Authorization: `Bearer ${this.bearer}` };
    const transport =
      this.cfg.transport === "sse"
        ? new SSEClientTransport(new URL(this.cfg.url), {
            requestInit: { headers: authHeader },
            eventSourceInit: {
              // Node's EventSource doesn't support setting headers natively,
              // so we use the fetch-based client transport.
              fetch: (url: any, init: any) =>
                fetch(url, { ...init, headers: { ...init?.headers, ...authHeader } }),
            } as any,
          })
        : new StreamableHTTPClientTransport(new URL(this.cfg.url), {
            requestInit: { headers: authHeader },
          });
    await this.client.connect(transport);
  }

  async discoverTools(): Promise<void> {
    this.error = null;
    this.lastAttemptMs = Date.now();
    try {
      await this.ensureConnected();
      const res = await this.client.listTools();
      this.tools = res.tools.map((t) => ({
        backend: this.cfg.name,
        name: t.name,
        description: t.description ?? "",
        inputSchema: t.inputSchema,
      }));
      console.log(`gateway: ${this.cfg.name} → ${this.tools.length} tools`);
    } catch (e: any) {
      this.error = e.message ?? String(e);
      this.tools = [];
      console.error(`gateway: ${this.cfg.name} connect/list failed: ${this.error}`);
    }
  }

  async callTool(name: string, args: any): Promise<any> {
    try {
      await this.ensureConnected();
      return await this.client.callTool({ name, arguments: args });
    } catch (e) {
      // Connection may be stale (backend restarted underneath us) —
      // drop it, reconnect once, retry once. Second failure propagates.
      await this.close();
      await this.ensureConnected();
      return await this.client.callTool({ name, arguments: args });
    }
  }

  async close(): Promise<void> {
    try { await this.client.close(); } catch {}
    this.ready = null;
  }
}
