// Thin HTTP client over thesys's REST API. All our tool handlers go through
// this — one place for auth, retries, timeout, error shaping.

const TIMEOUT_MS = 10_000;

export class ThesysClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  async call(method: string, path: string, body?: unknown): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method,
        headers: {
          "X-API-Key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (res.status === 204) return null;
      const text = await res.text();
      if (!res.ok) {
        // Try to parse thesys error body; fall back to plain text.
        let detail: any;
        try { detail = JSON.parse(text); } catch { detail = text; }
        throw new ThesysError(res.status, detail, method, path);
      }
      return text ? JSON.parse(text) : null;
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === "AbortError") {
        throw new ThesysError(0, `timeout after ${TIMEOUT_MS}ms`, method, path);
      }
      throw e;
    }
  }

  get(path: string): Promise<any> { return this.call("GET", path); }
  post(path: string, body?: unknown): Promise<any> { return this.call("POST", path, body); }
  patch(path: string, body?: unknown): Promise<any> { return this.call("PATCH", path, body); }
  delete(path: string): Promise<any> { return this.call("DELETE", path); }
}

export class ThesysError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: any,
    public readonly method: string,
    public readonly path: string,
  ) {
    const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail);
    super(`thesys ${method} ${path} → ${status}: ${detailStr}`);
  }
}
