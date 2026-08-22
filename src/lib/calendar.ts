import { google } from "googleapis";
import { CALENDAR_SCOPE, googleClient, grantedScopes, isGmailConfigured } from "./gmail";

// Your calendar, on the same Google connection as your mail.
//
// Read and write events only — the scope asked for is calendar.events, not
// full calendar access, so Axis can see and change appointments but cannot
// create, share or delete whole calendars.

function requireCalendar(): void {
  if (!isGmailConfigured()) {
    throw new Error("Google isn't connected yet, sir — authorize it in Settings first.");
  }
  if (!grantedScopes().includes(CALENDAR_SCOPE)) {
    throw new Error(
      "Your Google connection was made before I could read your calendar, sir. " +
        "Open Settings, disconnect Google, and connect it again — the consent screen will ask for the calendar this time."
    );
  }
}

async function calendarApi() {
  requireCalendar();
  return google.calendar({ version: "v3", auth: await googleClient() });
}

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  /** True for a day-long event, which has a date but no time. */
  allDay: boolean;
  location: string | null;
  attendees: string[];
  link: string | null;
}

function toEvent(raw: {
  id?: string | null;
  summary?: string | null;
  location?: string | null;
  htmlLink?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  attendees?: { email?: string | null }[] | null;
}): CalendarEvent {
  const startTime = raw.start?.dateTime ?? raw.start?.date ?? "";
  const endTime = raw.end?.dateTime ?? raw.end?.date ?? "";
  return {
    id: raw.id ?? "",
    summary: raw.summary ?? "(no title)",
    start: startTime,
    end: endTime,
    allDay: Boolean(raw.start?.date && !raw.start?.dateTime),
    location: raw.location ?? null,
    attendees: (raw.attendees ?? []).map((a) => a.email ?? "").filter(Boolean),
    link: raw.htmlLink ?? null,
  };
}

export interface ListOptions {
  /** ISO instant. Defaults to now. */
  from?: string;
  /** ISO instant. Defaults to seven days after `from`. */
  to?: string;
  /** Free-text search across titles, descriptions and attendees. */
  query?: string;
  max?: number;
}

export async function listEvents(options: ListOptions = {}): Promise<CalendarEvent[]> {
  const api = await calendarApi();

  const from = options.from ? new Date(options.from) : new Date();
  const to = options.to
    ? new Date(options.to)
    : new Date(from.getTime() + 7 * 24 * 60 * 60 * 1000);

  const res = await api.events.list({
    calendarId: "primary",
    timeMin: from.toISOString(),
    timeMax: to.toISOString(),
    // Recurring events come back as their individual occurrences, which is
    // what "what's on Tuesday" means.
    singleEvents: true,
    orderBy: "startTime",
    maxResults: Math.max(1, Math.min(Math.floor(options.max ?? 10), 50)),
    ...(options.query?.trim() ? { q: options.query.trim() } : {}),
  });

  return (res.data.items ?? []).map(toEvent);
}

export interface NewEvent {
  title: string;
  /** ISO instant, or YYYY-MM-DD for a day-long event. */
  start: string;
  /** ISO instant. Defaults to an hour after the start. */
  end?: string;
  location?: string;
  description?: string;
  attendees?: string[];
}

/** A date with no time is a day-long event; anything else is an instant. */
function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

export async function createEvent(event: NewEvent): Promise<CalendarEvent> {
  const api = await calendarApi();

  const title = event.title.trim();
  if (!title) throw new Error("An event needs a title, sir.");

  const start = event.start.trim();
  if (!start) throw new Error("An event needs a start time, sir.");

  let startField: { date: string } | { dateTime: string };
  let endField: { date: string } | { dateTime: string };

  if (isDateOnly(start)) {
    const endDate = event.end?.trim() && isDateOnly(event.end.trim()) ? event.end.trim() : start;
    // Google treats the end date of an all-day event as exclusive, so a
    // one-day event ends on the following day.
    const exclusive = new Date(`${endDate}T00:00:00Z`);
    exclusive.setUTCDate(exclusive.getUTCDate() + 1);
    startField = { date: start };
    endField = { date: exclusive.toISOString().slice(0, 10) };
  } else {
    const startsAt = new Date(start);
    if (Number.isNaN(startsAt.getTime())) {
      throw new Error(`I couldn't read "${event.start}" as a date and time, sir.`);
    }
    const endsAt = event.end?.trim()
      ? new Date(event.end)
      : new Date(startsAt.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(endsAt.getTime())) {
      throw new Error(`I couldn't read "${event.end}" as an end time, sir.`);
    }
    startField = { dateTime: startsAt.toISOString() };
    endField = { dateTime: endsAt.toISOString() };
  }

  const res = await api.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: title,
      start: startField,
      end: endField,
      ...(event.location?.trim() ? { location: event.location.trim() } : {}),
      ...(event.description?.trim() ? { description: event.description.trim() } : {}),
      ...(event.attendees?.length
        ? { attendees: event.attendees.map((email) => ({ email })) }
        : {}),
    },
  });

  return toEvent(res.data);
}
