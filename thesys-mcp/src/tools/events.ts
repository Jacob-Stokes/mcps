import { z } from "zod";
import type { ThesysClient } from "../thesys-client.js";

// Calendar events — read-only from Jacob's side (Google Calendar is the
// source of truth; agents can read but edits happen in Google Calendar).

export const EventsInput = z.object({
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD (inclusive, user local tz)"),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("YYYY-MM-DD (inclusive)"),
  compact: z.boolean().default(true).describe("Trim event records to {title, startAt, endAt, allDay, location}."),
});

export type EventsInput = z.infer<typeof EventsInput>;

export const EVENTS_TOOL = {
  name: "thesys_events",
  description:
    "List calendar events in a date range. Source is Jacob's Google Calendar (synced into thesys). " +
    "Read-only from agent; create/edit events in Google Calendar directly. " +
    "Returns [] if no Google Calendar connected. " +
    "NOTE: this is the REST endpoint /api/calendar/events — the unrelated /api/events is an SSE stream and should not be called.",
  inputSchema: EventsInput,
};

export async function handleEvents(client: ThesysClient, input: EventsInput): Promise<any> {
  const params = new URLSearchParams({ start: input.start, end: input.end });
  const events = await client.get(`/calendar/events?${params}`);
  const list = Array.isArray(events) ? events : [];
  const trimmed = input.compact ? list.map(compactEvent) : list;
  return { count: list.length, events: trimmed };
}

function compactEvent(e: any) {
  return {
    id: e.id,
    title: e.title,
    startAt: e.startAt,
    endAt: e.endAt,
    allDay: e.allDay,
    location: e.location || undefined,
    status: e.status,
  };
}
