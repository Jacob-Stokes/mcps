// Monica v4 REST API client. Auth is a Passport-issued personal access
// token (JWT) from `POST /oauth/personal-access-tokens` (or the User::createToken
// PHP helper). Present as `Authorization: Bearer <jwt>`.
//
// API docs: https://www.monicahq.com/api

export class MonicaError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly detail: any,
  ) {
    super(`${method} ${path} → ${status}`);
  }
}

export class MonicaClient {
  constructor(private baseUrl: string, private token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async req<T = any>(method: string, path: string, body?: any): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        Accept: "application/json",
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    // Single-read body to avoid the undici double-read trap.
    const raw = res.status === 204 ? "" : await res.text();
    if (!res.ok) {
      let detail: any;
      try { detail = raw ? JSON.parse(raw) : ""; } catch { detail = raw; }
      throw new MonicaError(method, path, res.status, detail);
    }
    if (!raw) return undefined as any;
    const ct = res.headers.get("content-type") ?? "";
    return ct.includes("application/json") ? JSON.parse(raw) : (raw as any);
  }

  get<T = any>(path: string) { return this.req<T>("GET", path); }
  post<T = any>(path: string, body?: any) { return this.req<T>("POST", path, body ?? {}); }
  put<T = any>(path: string, body?: any) { return this.req<T>("PUT", path, body ?? {}); }
  patch<T = any>(path: string, body?: any) { return this.req<T>("PATCH", path, body ?? {}); }
  delete<T = any>(path: string) { return this.req<T>("DELETE", path); }
}

// Bounded-concurrency fan-out helper for bulk actions across tools.
// Fresh fetch per iteration = no Response reuse.
export async function runBounded<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ ok: boolean; item: T; result?: R; error?: string }>> {
  const out: Array<{ ok: boolean; item: T; result?: R; error?: string }> = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        out[i] = { ok: true, item: items[i], result: await fn(items[i]) };
      } catch (e: any) {
        out[i] = { ok: false, item: items[i], error: e?.message ?? String(e) };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}
