import { z } from "zod";
import type { NtfyClient } from "../ntfy-client.js";

export const PUBLISH_TOOL = {
  name: "ntfy_publish",
  description:
    "Send a push notification to Jacob's phone via ntfy. Use sparingly — don't spam. Good uses: 'deploy finished', 'daily briefing ready', 'task due soon', 'alert: host down'. Topic must be one Jacob's subscribed to on their device.",
} as const;

export const PublishInput = z.object({
  topic: z.string().min(1).describe("Topic name — must match one subscribed on the phone."),
  message: z.string().min(1).describe("Notification body."),
  title: z.string().optional(),
  priority: z.number().int().min(1).max(5).optional().describe("1=min, 3=default, 5=urgent. Higher bypasses DnD."),
  tags: z.array(z.string()).optional().describe("Emoji keywords (e.g. ['warning','fire']) rendered as prefix."),
  click: z.string().url().optional().describe("URL to open on tap."),
  icon: z.string().url().optional(),
  delay: z.string().optional().describe("Schedule future delivery: '30m', '1h', 'tomorrow 10am', or unix ts."),
  markdown: z.boolean().optional(),
});

export async function handlePublish(client: NtfyClient, input: z.infer<typeof PublishInput>) {
  return client.publish(input);
}

export const RECENT_TOOL = {
  name: "ntfy_recent",
  description: "Fetch recent notifications published to a topic. Use to audit what's been sent.",
} as const;

export const RecentInput = z.object({
  topic: z.string().min(1),
  since_seconds: z.number().int().min(1).default(3600),
  limit: z.number().int().min(1).max(500).default(50),
});

export async function handleRecent(client: NtfyClient, input: z.infer<typeof RecentInput>) {
  const messages = await client.recent(input.topic, input.since_seconds, input.limit);
  return { topic: input.topic, count: messages.length, messages };
}
