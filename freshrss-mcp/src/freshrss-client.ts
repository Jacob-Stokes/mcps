// FreshRSS Greader-compatible API client. Auth is a two-step dance:
//   1. POST /accounts/ClientLogin with (Email, Passwd=<api_password>) →
//      response body `Auth=<auth_token>\n...`
//   2. Future requests: `Authorization: GoogleLogin auth=<auth_token>`
//
// State-changing endpoints additionally need a short-lived CSRF-ish `T`
// token from GET /reader/api/0/token, passed as `T=<token>` in the POST.
//
// Docs: https://freshrss.github.io/FreshRSS/en/users/06_Mobile_access.html

export class FreshrssError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly status: number,
    public readonly detail: any,
  ) {
    super(`${method} ${path} → ${status}`);
  }
}

export class FreshrssClient {
  private authToken: string | null = null;
  private tToken: string | null = null;
  private tTokenFetchedAt = 0;

  constructor(
    private baseUrl: string,
    private user: string,
    private apiPassword: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async ensureAuth(): Promise<void> {
    if (this.authToken) return;
    const body = new URLSearchParams({ Email: this.user, Passwd: this.apiPassword });
    const res = await fetch(`${this.baseUrl}/api/greader.php/accounts/ClientLogin`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const txt = await res.text();
      throw new FreshrssError("POST", "/accounts/ClientLogin", res.status, txt);
    }
    const text = await res.text();
    const m = text.match(/^Auth=(.+)$/m);
    if (!m) throw new Error(`ClientLogin: missing Auth= line in response: ${text.slice(0,200)}`);
    this.authToken = m[1].trim();
  }

  private async ensureT(): Promise<string> {
    // T tokens are short-lived; refresh every 5 min to be safe.
    if (this.tToken && Date.now() - this.tTokenFetchedAt < 5 * 60 * 1000) return this.tToken;
    await this.ensureAuth();
    const res = await fetch(`${this.baseUrl}/api/greader.php/reader/api/0/token`, {
      headers: { Authorization: `GoogleLogin auth=${this.authToken}` },
    });
    if (!res.ok) throw new FreshrssError("GET", "/reader/api/0/token", res.status, await res.text());
    this.tToken = (await res.text()).trim();
    this.tTokenFetchedAt = Date.now();
    return this.tToken;
  }

  async ping(): Promise<void> {
    await this.ensureAuth();
  }

  async get<T = any>(path: string): Promise<T> {
    await this.ensureAuth();
    const sep = path.includes("?") ? "&" : "?";
    const url = `${this.baseUrl}/api/greader.php${path}${sep}output=json`;
    const res = await fetch(url, {
      headers: { Authorization: `GoogleLogin auth=${this.authToken}` },
    });
    if (!res.ok) throw new FreshrssError("GET", path, res.status, await safeBody(res));
    return await res.json() as T;
  }

  /** Form-encoded POST with T token appended. */
  async post(path: string, params: Record<string, string | string[]>): Promise<string> {
    const t = await this.ensureT();
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) for (const vv of v) body.append(k, vv);
      else body.append(k, v);
    }
    body.set("T", t);
    const res = await fetch(`${this.baseUrl}/api/greader.php${path}`, {
      method: "POST",
      headers: {
        Authorization: `GoogleLogin auth=${this.authToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    if (!res.ok) throw new FreshrssError("POST", path, res.status, await safeBody(res));
    return await res.text();
  }
}

async function safeBody(res: Response): Promise<any> {
  // Buffer once — undici Response bodies are single-read. The previous
  // try-json / catch-text pattern masked errors with "Body is unusable".
  let raw = "";
  try { raw = await res.text(); } catch { return ""; }
  if (!raw) return "";
  try { return JSON.parse(raw); } catch { return raw; }
}
