// HTTP wrapper over the catalog service's REST API. Catalog is the homelab's
// meta-service — it joins Beszel container state, cloudflared routes, CF
// Access policies, and per-service catalog.yml hints, plus serves the
// glossary. All our tool handlers go through this single client.

const TIMEOUT_MS = 10_000;

export class CatalogClient {
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
        let detail: any;
        try { detail = JSON.parse(text); } catch { detail = text; }
        throw new CatalogError(res.status, detail, method, path);
      }
      return text ? JSON.parse(text) : null;
    } catch (e: any) {
      clearTimeout(timeout);
      if (e.name === "AbortError") {
        throw new CatalogError(0, `timeout after ${TIMEOUT_MS}ms`, method, path);
      }
      throw e;
    }
  }

  get(path: string): Promise<any> { return this.call("GET", path); }
}

export class CatalogError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: any,
    public readonly method: string,
    public readonly path: string,
  ) {
    const detailStr = typeof detail === "string" ? detail : JSON.stringify(detail);
    super(`catalog ${method} ${path} → ${status}: ${detailStr}`);
  }
}
