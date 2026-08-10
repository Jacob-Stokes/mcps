// Grimmory HTTP client with JWT login flow.
export class GrimmoryError extends Error {
  constructor(public status: number, public method: string, public path: string, public detail: unknown) {
    super(`grimmory ${method} ${path}: ${status}`);
  }
}

export class GrimmoryClient {
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(private baseUrl: string, private username: string, private password: string) {
    if (!baseUrl || !username || !password) throw new Error("GrimmoryClient: baseUrl/username/password required");
  }

  private async ensureToken() {
    if (this.token && this.tokenExpiry > Date.now() + 30000) return;
    const res = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    if (!res.ok) throw new GrimmoryError(res.status, "POST", "/api/v1/auth/login", await res.text());
    const body: any = await res.json();
    this.token = body.accessToken || body.access_token || body.token;
    // Assume ~30 min TTL (grimmory spec doesn't document, refresh often).
    this.tokenExpiry = Date.now() + 25 * 60 * 1000;
  }

  async request<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    await this.ensureToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.token}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      // Token might have expired earlier than expected — retry once after refresh.
      this.token = null;
      await this.ensureToken();
      const retry = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.token}`,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      if (!retry.ok) throw new GrimmoryError(retry.status, method, path, await retry.text());
      const text = await retry.text();
      return text ? JSON.parse(text) : (undefined as T);
    }
    if (!res.ok) throw new GrimmoryError(res.status, method, path, await res.text());
    const text = await res.text();
    return text ? JSON.parse(text) : (undefined as T);
  }

  get<T = any>(path: string) { return this.request<T>("GET", path); }
  post<T = any>(path: string, body: unknown) { return this.request<T>("POST", path, body); }
  put<T = any>(path: string, body: unknown) { return this.request<T>("PUT", path, body); }
  delete<T = any>(path: string) { return this.request<T>("DELETE", path); }
}
