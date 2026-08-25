import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAuthorizationServerMetadata,
  parseOAuthScopes,
} from "../dist/oauth-metadata.js";

test("default OAuth scopes include refresh-token consent", () => {
  assert.deepEqual(parseOAuthScopes(undefined), [
    "openid",
    "email",
    "profile",
    "offline_access",
  ]);
});

test("explicit OAuth scopes are trimmed and deduplicated", () => {
  assert.deepEqual(
    parseOAuthScopes(" openid  profile offline_access profile "),
    ["openid", "profile", "offline_access"],
  );
});

test("public DCR metadata advertises secretless token authentication", () => {
  const metadata = buildAuthorizationServerMetadata(
    {
      issuer: "https://auth.example.test/application/o/gateway/",
      token_endpoint_auth_methods_supported: [
        "client_secret_post",
        "client_secret_basic",
      ],
      code_challenge_methods_supported: ["S256"],
    },
    "https://mcp.example.test",
    "/register",
    false,
  );

  assert.equal(metadata.issuer, "https://mcp.example.test");
  assert.equal(
    metadata.registration_endpoint,
    "https://mcp.example.test/register",
  );
  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, [
    "client_secret_post",
    "client_secret_basic",
    "none",
  ]);
});

test("confidential DCR metadata keeps client_secret_post", () => {
  const metadata = buildAuthorizationServerMetadata(
    { token_endpoint_auth_methods_supported: ["client_secret_basic"] },
    "https://mcp.example.test",
    "/register",
    true,
  );

  assert.deepEqual(metadata.token_endpoint_auth_methods_supported, [
    "client_secret_basic",
    "client_secret_post",
  ]);
});
