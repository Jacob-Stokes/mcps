// Thin fetch wrapper around Mealie v3+ REST API. Auth is a long-lived
// API token (created in Mealie UI: Settings → API Tokens) presented as
// `Authorization: Bearer <token>`.
//
// Mealie's v3 API is paginated and household-scoped. This client keeps
// raw HTTP only — tools/*.ts add the Anthropic-shaped schema + semantics.

export class MealieError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly detail: any,
  ) {
    super(`${method} ${path} → ${status}`);
  }
}

export class MealieClient {
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
    // Buffer response body once — undici's Response is single-read, so the
    // classic try res.json() / catch res.text() pattern fails with "Body is
    // unusable" when the server returns non-JSON on error. Parse from text.
    const raw = res.status === 204 ? "" : await res.text();
    if (!res.ok) {
      let detail: any;
      try { detail = raw ? JSON.parse(raw) : ""; } catch { detail = raw; }
      throw new MealieError(method, path, res.status, detail);
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
