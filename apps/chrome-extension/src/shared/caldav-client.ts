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
	uid: string | null;
	summary: string | null;
	location: string | null;
	description: string | null;
	dtstartMs: number | null;
	dtendMs: number | null;
};

// Named entities plus decimal/hex numeric character references. CalDAV
// servers commonly encode the <calendar-data> body's CRLFs as &#13;&#10;
// rather than emitting them literally; leaving those undecoded collapses the
// whole ICS onto one line and the VEVENT parser below finds nothing.
const xmlUnescape = (value: string): string =>
	value
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		)
		.replace(/&#(\d+);/g, (_, dec: string) =>
			String.fromCodePoint(Number.parseInt(dec, 10)),
		)
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&amp;/g, "&");

const authHeader = (settings: CalDavSettings): string =>
	`Basic ${btoa(`${settings.username}:${settings.appPassword}`)}`;

// Never send Basic-auth credentials (app password) over a plaintext channel.
const isHttpsUrl = (value: string): boolean => {
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
};

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
	if (!isHttpsUrl(settings.serverUrl)) {
		throw new Error("CalDAV server URL must use https");
	}

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

const lineFieldName = (line: string): string | undefined => {
	const colonIdx = line.indexOf(":");
	if (colonIdx === -1) return undefined;
	return line.slice(0, colonIdx).split(";")[0]?.toUpperCase();
};

// Returns both the value and any `;PARAM=value` pairs on the property line
// (e.g. TZID on DTSTART/DTEND), since date parsing needs the zone alongside
// the raw value.
const getIcsLine = (
	lines: string[],
	name: string,
): { value: string; params: Record<string, string> } | null => {
	for (const line of lines) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;
		const head = line.slice(0, colonIdx);
		const segments = head.split(";");
		if (segments[0]?.toUpperCase() !== name) continue;
		const params: Record<string, string> = {};
		for (const segment of segments.slice(1)) {
			const eqIdx = segment.indexOf("=");
			if (eqIdx === -1) continue;
			params[segment.slice(0, eqIdx).toUpperCase()] = segment.slice(eqIdx + 1);
		}
		return { value: line.slice(colonIdx + 1), params };
	}
	return null;
};

const getIcsField = (lines: string[], name: string): string | null =>
	getIcsLine(lines, name)?.value ?? null;

// Offset (ms) of `timeZone` at the instant `epochMs`, computed via
// Intl.DateTimeFormat — no external tz-database dependency needed for a
// service worker that already has ICU built in.
const tzOffsetMs = (timeZone: string, epochMs: number): number => {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	}).formatToParts(new Date(epochMs));
	const get = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value ?? "0");
	const asUtc = Date.UTC(
		get("year"),
		get("month") - 1,
		get("day"),
		get("hour"),
		get("minute"),
		get("second"),
	);
	return asUtc - epochMs;
};

// Converts a wall-clock date/time in `timeZone` to an epoch ms. Two-pass:
// the first offset guess can be wrong right at a DST transition, so refine
// once against the corrected instant.
const zonedTimeToUtcMs = (
	y: number,
	mo: number,
	d: number,
	h: number,
	mi: number,
	s: number,
	timeZone: string,
): number | null => {
	try {
		const utcGuess = Date.UTC(y, mo, d, h, mi, s);
		const offset = tzOffsetMs(timeZone, utcGuess);
		const refinedOffset = tzOffsetMs(timeZone, utcGuess - offset);
		return utcGuess - refinedOffset;
	} catch {
		return null;
	}
};

// Interprets a DATE-TIME value per RFC5545: trailing Z is UTC, an explicit
// numeric offset is honored, a TZID param resolves the zone's offset at that
// instant, and otherwise (floating, or an unresolvable TZID) the value is
// interpreted in the runtime's local zone.
const parseIcsDate = (
	value: string | null,
	tzid: string | null,
): number | null => {
	if (!value) return null;
	const match = value.match(
		/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{2}:?\d{2})?)?/,
	);
	if (!match) return null;
	const [, y, mo, d, h = "0", mi = "0", s = "0", marker] = match;
	const Y = Number(y);
	const MO = Number(mo) - 1;
	const D = Number(d);
	const H = Number(h);
	const MI = Number(mi);
	const S = Number(s);

	if (marker === "Z") {
		return Date.UTC(Y, MO, D, H, MI, S);
	}
	if (marker) {
		const sign = marker[0] === "-" ? -1 : 1;
		const digits = marker.slice(1).replace(":", "");
		const offsetMs =
			sign *
			(Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) *
			60000;
		return Date.UTC(Y, MO, D, H, MI, S) - offsetMs;
	}
	if (tzid) {
		const resolved = zonedTimeToUtcMs(Y, MO, D, H, MI, S, tzid);
		if (resolved !== null) return resolved;
	}
	return new Date(Y, MO, D, H, MI, S).getTime();
};

// Parses ISO-8601 durations of the form used by DURATION: P#D and/or
// T#H#M#S components (e.g. PT1H, P1DT2H30M).
const parseIsoDuration = (value: string | null): number | null => {
	if (!value) return null;
	const match = value.match(
		/^([+-])?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
	);
	if (!match) return null;
	const [, sign, days, hours, minutes, seconds] = match;
	if (sign === "-") return null;
	if (!days && !hours && !minutes && !seconds) return null;
	return (
		(Number(days ?? 0) * 86400 +
			Number(hours ?? 0) * 3600 +
			Number(minutes ?? 0) * 60 +
			Number(seconds ?? 0)) *
		1000
	);
};

export const parseEvent = (event: CalDavEvent): ParsedCalDavEvent => {
	// A single .ics resource can contain more than one VEVENT text block only
	// in the recurrence-override case; the query already scopes each resource
	// to the requested window, so reading the first VEVENT's fields is enough
	// for matching purposes here.
	const lines = unfoldIcs(event.icsText);
	const dtstart = getIcsLine(lines, "DTSTART");
	const dtend = getIcsLine(lines, "DTEND");
	const dtstartMs = parseIcsDate(dtstart?.value ?? null, dtstart?.params.TZID ?? null);
	let dtendMs = parseIcsDate(dtend?.value ?? null, dtend?.params.TZID ?? null);
	if (dtendMs === null && dtstartMs !== null) {
		const durationMs = parseIsoDuration(getIcsField(lines, "DURATION"));
		if (durationMs !== null) dtendMs = dtstartMs + durationMs;
	}
	return {
		...event,
		uid: getIcsField(lines, "UID"),
		summary: getIcsField(lines, "SUMMARY"),
		location: getIcsField(lines, "LOCATION"),
		description: getIcsField(lines, "DESCRIPTION"),
		dtstartMs,
		dtendMs,
	};
};

export type AttachResult =
	| "attached"
	| "conflict"
	| "blocked-off-origin"
	| "blocked-off-path"
	| "blocked-no-etag"
	| "blocked-insecure";

export type AttachTarget = CalDavEvent & { uid?: string | null };

// Finds the index of the END:VEVENT line to insert ATTACH before: the block
// whose UID matches the matched event's UID when available (so a
// recurrence-override resource lands the ATTACH on the right occurrence),
// falling back to the first END:VEVENT otherwise.
const findAttachInsertIndex = (lines: string[], uid: string | null): number => {
	if (uid) {
		let blockStart = -1;
		for (let i = 0; i < lines.length; i++) {
			const trimmed = lines[i]?.trim().toUpperCase();
			if (trimmed === "BEGIN:VEVENT") {
				blockStart = i;
				continue;
			}
			if (trimmed === "END:VEVENT") {
				if (blockStart !== -1) {
					const blockUid = lines
						.slice(blockStart, i)
						.find((line) => lineFieldName(line) === "UID");
					if (
						blockUid &&
						blockUid.slice(blockUid.indexOf(":") + 1).trim() === uid
					) {
						return i;
					}
				}
				blockStart = -1;
			}
		}
	}
	return lines.findIndex((line) => line.trim().toUpperCase() === "END:VEVENT");
};

// Appends an ATTACH;VALUE=URI line for the Cap share link just before the
// matched VEVENT's END:VEVENT and PUTs the modified .ics back with If-Match
// on the etag from the REPORT response. A 412 means the event changed since
// it was read (Stalwart's concurrent-edit guard) — treated as "skip, don't
// clobber" rather than retried. Also skipped (never PUT): the resolved PUT
// target is off the configured server's origin (event.href was absolute and
// pointed elsewhere), the server gave no etag to condition on, or the server
// URL isn't https — best-effort enrichment must never clobber or leak
// credentials.
export const attachShareLinkToEvent = async (
	settings: CalDavSettings,
	event: AttachTarget,
	shareUrl: string,
): Promise<AttachResult> => {
	if (!isHttpsUrl(settings.serverUrl)) return "blocked-insecure";

	let url: URL;
	try {
		const serverOrigin = new URL(settings.serverUrl).origin;
		url = new URL(event.href, settings.serverUrl);
		if (url.origin !== serverOrigin) return "blocked-off-origin";

		const collectionPath = new URL(settings.serverUrl).pathname.replace(
			/\/?$/,
			"/",
		);
		if (!url.pathname.startsWith(collectionPath)) return "blocked-off-path";
	} catch {
		return "blocked-off-origin";
	}

	if (!event.etag) return "blocked-no-etag";

	const lines = event.icsText.split(/\r\n|\n|\r/);
	const endIdx = findAttachInsertIndex(lines, event.uid ?? null);
	if (endIdx === -1) {
		throw new Error("CalDAV event .ics is missing END:VEVENT");
	}
	const nextLines = [...lines];
	nextLines.splice(endIdx, 0, `ATTACH;VALUE=URI:${shareUrl}`);
	const nextIcs = nextLines.join("\r\n");

	const headers: Record<string, string> = {
		Authorization: authHeader(settings),
		"Content-Type": "text/calendar; charset=utf-8",
		"If-Match": event.etag,
	};

	const response = await fetch(url.toString(), {
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

export type ConnectionTestResult = {
	ok: boolean;
	status: number | null;
	message: string;
};

// Minimal authenticated depth-0 PROPFIND against the configured collection —
// enough to confirm the URL/credentials are good without touching any event
// data.
export const testConnection = async (
	settings: CalDavSettings,
): Promise<ConnectionTestResult> => {
	if (!isHttpsUrl(settings.serverUrl)) {
		return { ok: false, status: null, message: "Server URL must use https" };
	}
	try {
		const response = await fetch(settings.serverUrl, {
			method: "PROPFIND",
			headers: {
				Authorization: authHeader(settings),
				Depth: "0",
				"Content-Type": "application/xml; charset=utf-8",
			},
			body: `<?xml version="1.0" encoding="utf-8" ?><d:propfind xmlns:d="DAV:"><d:prop><d:getetag /></d:prop></d:propfind>`,
		});
		if (response.status === 207 || response.ok) {
			return { ok: true, status: response.status, message: "Connected" };
		}
		return {
			ok: false,
			status: response.status,
			message: `Failed (${response.status})`,
		};
	} catch {
		return { ok: false, status: null, message: "Network error" };
	}
};
