export class NtfyError extends Error {
  constructor(public status: number, public body: string) {
    super(`ntfy HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

export interface PublishOptions {
  topic: string;
  message: string;
  title?: string;
  priority?: number;
  tags?: string[];
  click?: string;
  icon?: string;
  delay?: string;
  markdown?: boolean;
}

export class NtfyClient {
  constructor(private baseUrl: string) {
    if (!baseUrl) throw new Error("NtfyClient: baseUrl required");
  }

  async publish(opts: PublishOptions): Promise<any> {
    const headers: Record<string, string> = { "Content-Type": "text/plain" };
    if (opts.title) headers["Title"] = opts.title;
    if (opts.priority) headers["Priority"] = String(opts.priority);
    if (opts.tags && opts.tags.length) headers["Tags"] = opts.tags.join(",");
    if (opts.click) headers["Click"] = opts.click;
    if (opts.icon) headers["Icon"] = opts.icon;
    if (opts.delay) headers["At"] = opts.delay;
    if (opts.markdown) headers["Markdown"] = "yes";
    const res = await fetch(`${this.baseUrl}/${encodeURIComponent(opts.topic)}`, {
      method: "POST",
      headers,
      body: opts.message,
    });
    const text = await res.text();
    if (!res.ok) throw new NtfyError(res.status, text);
    try { return JSON.parse(text); } catch { return { topic: opts.topic, ok: true }; }
  }

  async recent(topic: string, sinceSeconds = 3600, limit = 50): Promise<any[]> {
    const url = `${this.baseUrl}/${encodeURIComponent(topic)}/json?poll=1&since=${sinceSeconds}s`;
    const res = await fetch(url);
    if (!res.ok) throw new NtfyError(res.status, await res.text());
    const text = await res.text();
    const lines = text.split("\n").filter(Boolean);
    return lines.slice(-limit).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  }
}
