import { startMcp, fetchSecret } from "mcp-common";
import { MealieClient, MealieError } from "./mealie-client.js";
import { RECIPES_TOOL, RecipesInput, handleRecipes } from "./tools/recipes.js";
import { MEALPLAN_TOOL, MealplanInput, handleMealplan } from "./tools/mealplan.js";
import { SHOPPING_TOOL, ShoppingInput, handleShopping } from "./tools/shopping.js";
import { ORGANIZERS_TOOL, OrganizersInput, handleOrganizers } from "./tools/organizers.js";

const PORT = parseInt(process.env.PORT || "7008", 10);
const MEALIE_BASE_URL = process.env.MEALIE_BASE_URL || "http://mealie:9000";
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;
if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }

// Long-lived API token from Mealie user settings → API Tokens. Fetched
// from Infisical at boot unless set directly in env.
const apiToken = process.env.MEALIE_API_TOKEN
  ? (console.log("mealie api token: from env"), process.env.MEALIE_API_TOKEN)
  : (console.log("mealie api token: fetching from Infisical"), await fetchSecret("MEALIE_API_TOKEN"));

const client = new MealieClient(MEALIE_BASE_URL, apiToken);
let selfUserId: string;
try {
  const about = await client.get<{ version: string }>(`/api/app/about`);
  console.log(`mealie connectivity: ok (${MEALIE_BASE_URL}, v${about.version})`);
  const self = await client.get<{ id: string }>(`/api/users/self`);
  selfUserId = self.id;
} catch (e: any) {
  console.error(`mealie connectivity FAILED at ${MEALIE_BASE_URL}:`, e.message);
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
  name: "mealie-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...RECIPES_TOOL, inputSchema: RecipesInput }, handler: (i) => handleRecipes(client, i, selfUserId) },
    { def: { ...MEALPLAN_TOOL, inputSchema: MealplanInput }, handler: (i) => handleMealplan(client, i) },
    { def: { ...SHOPPING_TOOL, inputSchema: ShoppingInput }, handler: (i) => handleShopping(client, i) },
    { def: { ...ORGANIZERS_TOOL, inputSchema: OrganizersInput }, handler: (i) => handleOrganizers(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof MealieError) {
      return `mealie error: ${e.method} ${e.path} → HTTP ${e.status}: ${JSON.stringify(e.detail).slice(0, 200)}`;
    }
    return null;
  },
});
