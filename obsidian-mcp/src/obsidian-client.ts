// HTTP wrapper around the obsidian-landing API (the public proxy in front of
// the backend obsidian-api). All tool handlers go through this — one place
// for auth, timeout, error shaping, path encoding.
//
// Note: we talk to obsidian-LANDING (port 3099), NOT obsidian-api directly.
// Landing validates per-client OBSIDIAN_API_KEY values and swaps to the
// backend admin key internally. Agents never need the backend admin key.

const TIMEOUT_MS = 10_000;

export class ObsidianClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async call(method: string, path: string, body?: unknown, contentType = "application/json"): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": contentType,
        },
        body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.status === 204) return null;
      const text = await res.text();
      if (!res.ok) {
        let detail: any;
        try { detail = JSON.parse(text); } catch { detail = text; }
        throw new ObsidianError(res.status, detail, method, path);
      }
      // Some endpoints return non-JSON (file content as text). Try JSON first.
      try { return text ? JSON.parse(text) : null; }
      catch { return text; }
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === "AbortError") {
        throw new ObsidianError(0, `timeout after ${TIMEOUT_MS}ms`, method, path);
      }
      throw e;
    }
  }

  get(path: string): Promise<any> { return this.call("GET", path); }
  post(path: string, body?: unknown): Promise<any> { return this.call("POST", path, body); }
  put(path: string, body?: unknown): Promise<any> { return this.call("PUT", path, body); }
  delete(path: string): Promise<any> { return this.call("DELETE", path); }
}

// URL-encode a vault path while preserving forward slashes (obsidian-landing's
// routing uses path segments). Each segment is encoded individually.
export function encodeVaultPath(p: string): string {
  return p.split("/").map(encodeURIComponent).join("/");
}

export class ObsidianError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: any,
    public readonly method: string,
    public readonly path: string,
  ) {
    const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail);
    super(`obsidian ${method} ${path} → ${status}: ${detailStr}`);
  }
}
