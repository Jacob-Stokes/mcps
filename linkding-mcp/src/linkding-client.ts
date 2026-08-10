// Thin fetch wrapper around linkding's REST API. Auth is a long-lived
// token (Settings → Integrations → REST API in the UI, or via the
// bookmarks.models.ApiToken Django model) presented as
// `Authorization: Token <token>`.
//
// linkding docs: https://github.com/sissbruecker/linkding/blob/master/docs/API.md

export class LinkdingError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly detail: any,
  ) {
    super(`${method} ${path} → ${status}`);
  }
}

export class LinkdingClient {
  constructor(private baseUrl: string, private token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async req<T = any>(method: string, path: string, body?: any, attempt = 0): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Token ${this.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    // Buffer the body ONCE — undici's Response body is single-read. Previous
    // impl called res.json() then res.text() on the same response, which
    // surfaced as "Body is unusable: Body has already been read" whenever
    // the server returned non-JSON (e.g. a Django 500 page under SQLite
    // contention), masking the real error.
    const raw = res.status === 204 ? "" : await res.text();

    if (!res.ok) {
      // Linkding runs on SQLite — concurrent writes can 500 with
      // "database is locked". Retry once on 5xx with small jitter before
      // giving up, so bulk ops don't spuriously half-fail.
      if (res.status >= 500 && attempt < 2) {
        await sleep(100 + Math.random() * 200);
        return this.req<T>(method, path, body, attempt + 1);
      }
      let detail: any;
      try { detail = raw ? JSON.parse(raw) : ""; } catch { detail = raw; }
      throw new LinkdingError(method, path, res.status, detail);
    }

    if (!raw) return undefined as any;
    const ct = res.headers.get("content-type") ?? "";
    return ct.includes("application/json") ? JSON.parse(raw) : (raw as any);
  }

  get<T = any>(path: string) { return this.req<T>("GET", path); }
  post<T = any>(path: string, body?: any) { return this.req<T>("POST", path, body ?? {}); }
  put<T = any>(path: string, body?: any) { return this.req<T>("PUT", path, body); }
  patch<T = any>(path: string, body?: any) { return this.req<T>("PATCH", path, body); }
  delete<T = any>(path: string) { return this.req<T>("DELETE", path); }
}

function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }
