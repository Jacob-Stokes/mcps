// Minimal Infisical universal-auth client — caches access token for its TTL.
// Used by MCPs to fetch backend service secrets at boot. The universal-auth
// creds themselves (client id + secret + project + domain) come from env.

interface TokenState {
  token: string;
  expiresAt: number;
}

let authTokenCache: TokenState | null = null;

async function getAuthToken(): Promise<string> {
  const now = Date.now();
  if (authTokenCache && authTokenCache.expiresAt > now + 5000) return authTokenCache.token;

  const domain = process.env.INFISICAL_DOMAIN;
  const clientId = process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_ID;
  const clientSecret = process.env.INFISICAL_UNIVERSAL_AUTH_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret) {
    throw new Error("infisical: missing INFISICAL_DOMAIN / CLIENT_ID / CLIENT_SECRET env vars");
  }

  const res = await fetch(`${domain}/api/v1/auth/universal-auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!res.ok) throw new Error(`infisical login failed: HTTP ${res.status}`);
  const body = (await res.json()) as { accessToken: string; expiresIn?: number };
  const ttlMs = (body.expiresIn ?? 600) * 1000;
  authTokenCache = { token: body.accessToken, expiresAt: now + ttlMs };
  return body.accessToken;
}

export async function fetchSecret(keyName: string): Promise<string> {
  const token = await getAuthToken();
  const domain = process.env.INFISICAL_DOMAIN!;
  const workspaceId = process.env.INFISICAL_PROJECT_ID!;
  const url = `${domain}/api/v3/secrets/raw/${encodeURIComponent(keyName)}?environment=prod&workspaceId=${workspaceId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`infisical fetch ${keyName} failed: HTTP ${res.status}`);
  const body = (await res.json()) as { secret?: { secretValue?: string } };
  const val = body.secret?.secretValue;
  if (!val) throw new Error(`infisical: secret '${keyName}' has no value`);
  return val;
}
