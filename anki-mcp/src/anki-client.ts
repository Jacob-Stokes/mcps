// AnkiConnect client — thin wrapper around the JSON-RPC-ish API.
// API reference: https://foosoft.net/projects/anki-connect/
// All requests are POSTs to a single endpoint with a body like:
//   { action: "deckNames", version: 6, key: "<apiKey>", params: {...} }
// Response: { result: <any>, error: <string|null> }.

export class AnkiError extends Error {
  constructor(public action: string, public detail: string) {
    super(`AnkiConnect ${action}: ${detail}`);
  }
}

export class AnkiClient {
  constructor(private baseUrl: string, private apiKey?: string) {
    if (!baseUrl) throw new Error("AnkiClient: baseUrl required");
  }

  async invoke<T = any>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const body: any = { action, version: 6, params };
    if (this.apiKey) body.key = this.apiKey;
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new AnkiError(action, `HTTP ${res.status}`);
    const json = (await res.json()) as { result?: T; error?: string | null };
    if (json.error) throw new AnkiError(action, json.error);
    return json.result as T;
  }
}
