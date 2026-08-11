import type { CalDavSettings } from "./types";

// Pure-fetch CalDAV client for the background service worker. No external
// CalDAV/XML library: the surface used here (REPORT calendar-query, PUT) is
// narrow enough that a hand-rolled regex-based XML/iCalendar reader keeps
// well under the size a dependency would add, and MV3 service workers have
// no DOMParser to lean on anyway.

export type CalDavEvent = {
	href: string;
	etag: string | null;
	icsText: string;
};

export type ParsedCalDavEvent = CalDavEvent & {
	summary: string | null;
	location: string | null;
	description: string | null;
	dtstartMs: number | null;
	dtendMs: number | null;
};

const xmlUnescape = (value: string): string =>
	value
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");

const authHeader = (settings: CalDavSettings): string =>
	`Basic ${btoa(`${settings.username}:${settings.appPassword}`)}`;

// CalDAV time-range filters want basic-format UTC: YYYYMMDDTHHMMSSZ.
const toCalDavTimestamp = (ms: number): string =>
	new Date(ms)
		.toISOString()
		.replace(/[-:]/g, "")
		.replace(/\.\d{3}Z$/, "Z");

const extractTag = (block: string, tag: string): string | null => {
	const pattern = new RegExp(
		`<[^:>]*:?${tag}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${tag}>`,
		"i",
	);
	const match = block.match(pattern);
	return match ? match[1] : null;
};

const splitResponses = (xml: string): string[] => {
	const pattern = /<[^:>]*:?response[^>]*>([\s\S]*?)<\/[^:>]*:?response>/gi;
	const out: string[] = [];
	let match: RegExpExecArray | null = pattern.exec(xml);
	while (match !== null) {
		out.push(match[1]);
		match = pattern.exec(xml);
	}
	return out;
};

// Runs a time-range REPORT/calendar-query against the single configured
// calendar collection and returns every VEVENT resource whose window
// overlaps [windowStartMs, windowEndMs].
export const queryEventsInWindow = async (
	settings: CalDavSettings,
	windowStartMs: number,
	windowEndMs: number,
): Promise<CalDavEvent[]> => {
	const body = `<?xml version="1.0" encoding="utf-8" ?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${toCalDavTimestamp(windowStartMs)}" end="${toCalDavTimestamp(windowEndMs)}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;

	const response = await fetch(settings.serverUrl, {
		method: "REPORT",
		headers: {
			Authorization: authHeader(settings),
			"Content-Type": "application/xml; charset=utf-8",
			Depth: "1",
		},
		body,
	});

	if (!response.ok) {
		throw new Error(`CalDAV REPORT failed: ${response.status}`);
	}

	const xml = await response.text();
	const events: CalDavEvent[] = [];
	for (const block of splitResponses(xml)) {
		const href = extractTag(block, "href");
		const icsRaw = extractTag(block, "calendar-data");
		if (!href || !icsRaw) continue;
		const etagRaw = extractTag(block, "getetag");
		events.push({
			href: xmlUnescape(href).trim(),
			etag: etagRaw ? xmlUnescape(etagRaw).trim() : null,
			icsText: xmlUnescape(icsRaw),
		});
	}
	return events;
};

// RFC5545 line-unfolding: continuation lines start with a single space/tab.
const unfoldIcs = (ics: string): string[] => {
	const rawLines = ics.split(/\r\n|\n|\r/);
	const lines: string[] = [];
	for (const line of rawLines) {
		if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
			lines[lines.length - 1] += line.slice(1);
		} else {
			lines.push(line);
		}
	}
	return lines;
};

const getIcsField = (lines: string[], name: string): string | null => {
	for (const line of lines) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const keyName = line.slice(0, colonIdx).split(";")[0]?.toUpperCase();
		if (keyName === name) {
			return line.slice(colonIdx + 1);
		}
	}
	return null;
};

// Interprets DATE-TIME values as UTC regardless of whether they carry a Z or
// a floating/local-tz suffix — matching here only needs to be accurate to
// within the generous time-window padding the caller already applies, not
// exact-timezone-correct.
const parseIcsDate = (value: string | null): number | null => {
	if (!value) return null;
	const match = value.match(
		/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/,
	);
	if (!match) return null;
	const [, y, mo, d, h = "0", mi = "0", s = "0"] = match;
	return Date.UTC(
		Number(y),
		Number(mo) - 1,
		Number(d),
		Number(h),
		Number(mi),
		Number(s),
	);
};

export const parseEvent = (event: CalDavEvent): ParsedCalDavEvent => {
	// A single .ics resource can contain more than one VEVENT text block only
	// in the recurrence-override case; the query already scopes each resource
	// to the requested window, so reading the first VEVENT's fields is enough
	// for matching purposes here.
	const lines = unfoldIcs(event.icsText);
	return {
		...event,
		summary: getIcsField(lines, "SUMMARY"),
		location: getIcsField(lines, "LOCATION"),
		description: getIcsField(lines, "DESCRIPTION"),
		dtstartMs: parseIcsDate(getIcsField(lines, "DTSTART")),
		dtendMs: parseIcsDate(getIcsField(lines, "DTEND")),
	};
};

export type AttachResult = "attached" | "conflict";

// Appends an ATTACH;VALUE=URI line for the Cap share link just before
// END:VEVENT and PUTs the modified .ics back with If-Match on the etag from
// the REPORT response. A 412 means the event changed since it was read
// (Stalwart's concurrent-edit guard) — treated as "skip, don't clobber"
// rather than retried.
export const attachShareLinkToEvent = async (
	settings: CalDavSettings,
	event: CalDavEvent,
	shareUrl: string,
): Promise<AttachResult> => {
	const lines = event.icsText.split(/\r\n|\n|\r/);
	const endIdx = lines.findIndex(
		(line) => line.trim().toUpperCase() === "END:VEVENT",
	);
	if (endIdx === -1) {
		throw new Error("CalDAV event .ics is missing END:VEVENT");
	}
	const nextLines = [...lines];
	nextLines.splice(endIdx, 0, `ATTACH;VALUE=URI:${shareUrl}`);
	const nextIcs = nextLines.join("\r\n");

	const headers: Record<string, string> = {
		Authorization: authHeader(settings),
		"Content-Type": "text/calendar; charset=utf-8",
	};
	if (event.etag) headers["If-Match"] = event.etag;

	const url = new URL(event.href, settings.serverUrl).toString();
	const response = await fetch(url, {
		method: "PUT",
		headers,
		body: nextIcs,
	});

	if (response.status === 412) return "conflict";
	if (!response.ok) {
		throw new Error(`CalDAV PUT failed: ${response.status}`);
	}
	return "attached";
};
