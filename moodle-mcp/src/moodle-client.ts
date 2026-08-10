export class MoodleError extends Error {
  constructor(public wsfunction: string, public exception: string, public message: string, public errorcode?: string) {
    super(`moodle ${wsfunction}: ${message}${errorcode ? ` [${errorcode}]` : ""}`);
  }
}

export class MoodleClient {
  /**
   * @param baseUrl   Internal URL to reach Moodle (e.g. http://moodle)
   * @param token     Web Services token
   * @param hostHeader  Optional Host: header override. Required when Moodle's
   *                    $CFG->wwwroot is a public HTTPS URL but we're dialing
   *                    an internal container name — otherwise Moodle 303s to
   *                    its canonical URL. Set to the site's public hostname.
   */
  constructor(private baseUrl: string, private token: string, private hostHeader?: string) {
    if (!baseUrl) throw new Error("MoodleClient: baseUrl required");
    if (!token) throw new Error("MoodleClient: token required");
  }

  /**
   * Invoke a Moodle Web Service function.
   *
   * Moodle encodes structured params as URL-encoded nested keys, e.g.
   * `courses[0][id]=1&courses[0][fullname]=Foo`. This flattener handles
   * arrays and objects recursively.
   */
  async call<T = any>(wsfunction: string, params: Record<string, any> = {}): Promise<T> {
    const body = new URLSearchParams();
    body.append("wstoken", this.token);
    body.append("wsfunction", wsfunction);
    body.append("moodlewsrestformat", "json");
    flatten(body, "", params);

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
    };
    if (this.hostHeader) {
      headers["Host"] = this.hostHeader;
      // Tell Moodle we reached it over HTTPS (it trusts this when reverseproxy
      // / sslproxy is on; otherwise it just suppresses the wwwroot redirect).
      headers["X-Forwarded-Proto"] = "https";
      headers["X-Forwarded-Host"] = this.hostHeader;
    }
    const res = await fetch(`${this.baseUrl}/webservice/rest/server.php`, {
      method: "POST",
      headers,
      body: body.toString(),
    });

    const text = await res.text();
    if (!res.ok) {
      throw new MoodleError(wsfunction, `HTTP ${res.status}`, text.slice(0, 500));
    }
    let data: any;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      throw new MoodleError(wsfunction, "parse_error", text.slice(0, 500));
    }
    // Moodle returns {"exception":"...","errorcode":"...","message":"..."} on failure, HTTP 200.
    if (data && typeof data === "object" && !Array.isArray(data) && "exception" in data) {
      throw new MoodleError(wsfunction, data.exception, data.message, data.errorcode);
    }
    return data as T;
  }
}

function flatten(out: URLSearchParams, prefix: string, value: any): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(out, prefix ? `${prefix}[${i}]` : String(i), v));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      flatten(out, prefix ? `${prefix}[${k}]` : k, v);
    }
    return;
  }
  if (typeof value === "boolean") {
    out.append(prefix, value ? "1" : "0");
    return;
  }
  out.append(prefix, String(value));
}
