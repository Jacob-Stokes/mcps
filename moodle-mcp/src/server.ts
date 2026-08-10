import { startMcp } from "mcp-common";
import { MoodleClient, MoodleError } from "./moodle-client.js";
import { USERS_TOOL, UsersInput, handleUsers } from "./tools/users.js";
import { COURSES_TOOL, CoursesInput, handleCourses } from "./tools/courses.js";
import { CATEGORIES_TOOL, CategoriesInput, handleCategories } from "./tools/categories.js";
import { ENROLMENTS_TOOL, EnrolmentsInput, handleEnrolments } from "./tools/enrolments.js";
import { GROUPS_TOOL, GroupsInput, handleGroups } from "./tools/groups.js";
import { SITE_TOOL, SiteInput, handleSite } from "./tools/site.js";

const PORT = parseInt(process.env.PORT || "7014", 10);
const MOODLE_BASE_URL = process.env.MOODLE_BASE_URL || "http://moodle";
const MOODLE_HOST_HEADER = process.env.MOODLE_HOST_HEADER;
const MOODLE_API_TOKEN = process.env.MOODLE_API_TOKEN;
const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN;

if (!MCP_BEARER_TOKEN) { console.error("FATAL: MCP_BEARER_TOKEN env var required"); process.exit(1); }
if (!MOODLE_API_TOKEN) { console.error("FATAL: MOODLE_API_TOKEN env var required"); process.exit(1); }

const client = new MoodleClient(MOODLE_BASE_URL, MOODLE_API_TOKEN, MOODLE_HOST_HEADER);

try {
  const info = await client.call<any>("core_webservice_get_site_info", {});
  console.log(`moodle connectivity: ok — site="${info?.sitename}" as user="${info?.username}" (id=${info?.userid}), release=${info?.release}`);
} catch (e: any) {
  console.error(`moodle connectivity FAILED at ${MOODLE_BASE_URL}:`, e.message);
  process.exit(1);
}

const oauth = process.env.MCP_OAUTH_ISSUER
  ? {
      issuer: process.env.MCP_OAUTH_ISSUER,
      canonicalUrl: process.env.MCP_OAUTH_CANONICAL_URL!,
      jwksUri: process.env.MCP_OAUTH_JWKS_URI,
      audience: process.env.MCP_OAUTH_AUDIENCE,
      scopesSupported: (process.env.MCP_OAUTH_SCOPES || "openid email profile").split(/\s+/),
    }
  : undefined;

await startMcp({
  name: "moodle-mcp",
  port: PORT,
  bearerToken: MCP_BEARER_TOKEN,
  oauth,
  tools: [
    { def: { ...USERS_TOOL,       inputSchema: UsersInput },       handler: (i) => handleUsers(client, i) },
    { def: { ...COURSES_TOOL,     inputSchema: CoursesInput },     handler: (i) => handleCourses(client, i) },
    { def: { ...CATEGORIES_TOOL,  inputSchema: CategoriesInput },  handler: (i) => handleCategories(client, i) },
    { def: { ...ENROLMENTS_TOOL,  inputSchema: EnrolmentsInput },  handler: (i) => handleEnrolments(client, i) },
    { def: { ...GROUPS_TOOL,      inputSchema: GroupsInput },      handler: (i) => handleGroups(client, i) },
    { def: { ...SITE_TOOL,        inputSchema: SiteInput },        handler: (i) => handleSite(client, i) },
  ],
  onBackendError: (e) => {
    if (e instanceof MoodleError) return `moodle error in ${e.wsfunction}: ${e.message}${e.errorcode ? ` [${e.errorcode}]` : ""}`;
    return null;
  },
});
