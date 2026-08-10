export class CostTrackerError extends Error {
  constructor(public status: number, public body: string) {
    super(`cost-tracker HTTP ${status}: ${body.slice(0, 200)}`);
  }
}

export class CostTrackerClient {
  constructor(private baseUrl: string, private apiKey: string) {
    if (!baseUrl) throw new Error("CostTrackerClient: baseUrl required");
    if (!apiKey) throw new Error("CostTrackerClient: apiKey required");
  }

  private async req<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      headers: { "x-api-key": this.apiKey, "Accept": "application/json" },
    });
    const raw = res.status === 204 ? "" : await res.text();
    if (!res.ok) throw new CostTrackerError(res.status, raw);
    try { return raw ? JSON.parse(raw) : ({} as T); } catch { throw new CostTrackerError(res.status, raw); }
  }

  stats(params: { since?: string; until?: string; agent?: string; model?: string }) {
    const qs = buildQs(params);
    return this.req<any>(`/api/stats${qs}`);
  }

  timeseries(days: number) {
    return this.req<any>(`/api/stats/timeseries?days=${days}`);
  }

  runs(params: { agent?: string; model?: string; since?: string; until?: string; limit?: number; offset?: number }) {
    const qs = buildQs(params);
    return this.req<any>(`/api/runs${qs}`);
  }

  agentStats(agent: string, limit = 10, offset = 0) {
    return this.req<any>(`/api/agent-stats/${encodeURIComponent(agent)}?limit=${limit}&offset=${offset}`);
  }

  filters() {
    return this.req<any>(`/api/filters`);
  }

  claudeUsage(force = false) {
    return this.req<any>(`/api/claude-usage${force ? "?force=true" : ""}`);
  }

  codexUsage(force = false) {
    return this.req<any>(`/api/codex-usage${force ? "?force=true" : ""}`);
  }

  claudeSnapshots(hours = 24) {
    return this.req<any[]>(`/api/claude-usage/snapshots?hours=${hours}`);
  }

  codexSnapshots(hours = 24) {
    return this.req<any[]>(`/api/codex-usage/snapshots?hours=${hours}`);
  }
}

function buildQs(params: Record<string, any>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  if (!entries.length) return "";
  return "?" + entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
}
