export const DEFAULT_OAUTH_SCOPES = [
  "openid",
  "email",
  "profile",
  "offline_access",
] as const;

export function parseOAuthScopes(value: string | undefined): string[] {
  const scopes = value?.trim()
    ? value.trim().split(/\s+/)
    : [...DEFAULT_OAUTH_SCOPES];
  return [...new Set(scopes)];
}

export function buildAuthorizationServerMetadata(
  upstream: Record<string, any>,
  canonicalUrl: string,
  registrationPath: string,
  hasClientSecret: boolean,
): Record<string, any> {
  const requiredAuthMethod = hasClientSecret ? "client_secret_post" : "none";
  const tokenEndpointAuthMethods = [
    ...new Set([
      ...(Array.isArray(upstream.token_endpoint_auth_methods_supported)
        ? upstream.token_endpoint_auth_methods_supported
        : []),
      requiredAuthMethod,
    ]),
  ];

  return {
    ...upstream,
    // The gateway is the discovery issuer. Authorization and token endpoints
    // remain upstream, but clients must discover registration through us.
    issuer: canonicalUrl,
    registration_endpoint: `${canonicalUrl}${registrationPath}`,
    code_challenge_methods_supported:
      upstream.code_challenge_methods_supported ?? ["S256"],
    // Authentik's generic discovery document omits `none`, even when the
    // configured provider is a public PKCE client. The DCR shim must advertise
    // the same client-auth method that it returns from /register.
    token_endpoint_auth_methods_supported: tokenEndpointAuthMethods,
  };
}
