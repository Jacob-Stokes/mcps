import { startMcp, fetchSecret } from "mcp-common";
import { MonicaClient, MonicaError } from "./monica-client.js";
import { CONTACTS_TOOL, ContactsInput, handleContacts } from "./tools/contacts.js";
import { ACTIVITIES_TOOL, ActivitiesInput, handleActivities } from "./tools/activities.js";
import { REMINDERS_TOOL, RemindersInput, handleReminders } from "./tools/reminders.js";

const PORT = parseInt(process.env.PORT || "7011", 10);
const MONICA_BASE_URL = process.env.MONICA_BASE_URL || "http://monica";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

const apiToken = process.env.MONICA_API_TOKEN
  ? (console.log("monica api token: from env"), process.env.MONICA_API_TOKEN)
  : (console.log("monica api token: fetching from Infisical"), await fetchSecret("MONICA_API_TOKEN"));

const client = new MonicaClient(MONICA_BASE_URL, apiToken);
try {
  const me = await client.get<{ data: { email: string } }>(`/api/me`);
  console.log(`monica connectivity: ok (${MONICA_BASE_URL}, user=${me.data.email})`);
} catch (e: any) {
  console.error(`monica connectivity FAILED at ${MONICA_BASE_URL}:`, e.message);
  process.exit(1);
}

const oauth = process.env.MCP_OAUTH_ISSUER
  ? {
      issuer: process.env.MCP_OAUTH_ISSUER,
      canonicalUrl: process.env.MCP_OAUTH_CANONICAL_URL!,
      audience: process.env.MCP_OAUTH_AUDIENCE,
      scopesSupported: (process.env.MCP_OAUTH_SCOPES || "openid email profile").split(/\s+/),
    }
  : undefined;

await startMcp({
  name: "monica-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...CONTACTS_TOOL, inputSchema: ContactsInput }, handler: (i) => handleContacts(client, i) },
    { def: { ...ACTIVITIES_TOOL, inputSchema: ActivitiesInput }, handler: (i) => handleActivities(client, i) },
    { def: { ...REMINDERS_TOOL, inputSchema: RemindersInput }, handler: (i) => handleReminders(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof MonicaError) {
      return `monica error: ${e.method} ${e.path} → HTTP ${e.status}: ${JSON.stringify(e.detail).slice(0, 200)}`;
    }
    return null;
  },
});
