import { z } from "zod";

export const HUGO_SITE_TOOL = {
  name: "hugo_site",
  description: [
    "Rebuild the static site from current content + config. create_post/edit_post/hugo_config's",
    "update already trigger this automatically — use this directly only if you want to force a",
    "rebuild without changing anything (e.g. after a manual edit) or to check the site currently",
    "builds cleanly. Runs synchronously (the call waits for it) — normally under a second, longer if",
    "there are a lot of images to process.",
  ].join(" "),
} as const;

export const HugoSiteInput = z.object({
  action: z.literal("regenerate"),
});

export interface SiteDeps {
  rebuild: () => Promise<{ ok: boolean; output: string }>;
}

export async function handleHugoSite(deps: SiteDeps, _input: z.infer<typeof HugoSiteInput>) {
  return deps.rebuild();
}
