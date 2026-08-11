import { afterEach, describe, expect, it, vi } from "vitest";
import {
	attachShareLinkToEvent,
	parseEvent,
	queryEventsInWindow,
	testConnection,
} from "./caldav-client";
import type { CalDavSettings } from "./types";

const settings: CalDavSettings = {
	enabled: true,
	serverUrl: "https://mail.example.com/dav/calendars/user@example.com/default/",
	username: "user@example.com",
	appPassword: "app-password",
};

afterEach(() => {
	vi.unstubAllGlobals();
});

const REPORT_XML = `<?xml version="1.0"?>
<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response>
    <d:href>/dav/calendars/user@example.com/default/event1.ics</d:href>
    <d:propstat>
      <d:prop>
        <d:getetag>&quot;etag-123&quot;</d:getetag>
        <c:calendar-data>BEGIN:VCALENDAR&#13;&#10;VERSION:2.0&#13;&#10;BEGIN:VEVENT&#13;&#10;UID:1&#13;&#10;SUMMARY:Team Sync&#13;&#10;LOCATION:https://meet.google.com/abc-defg-hij&#13;&#10;DTSTART:20260810T140000Z&#13;&#10;DTEND:20260810T143000Z&#13;&#10;END:VEVENT&#13;&#10;END:VCALENDAR</c:calendar-data>
      </d:prop>
    </d:propstat>
  </d:response>
</d:multistatus>`;

describe("queryEventsInWindow", () => {
	it("parses href/etag/calendar-data out of a REPORT multistatus response", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			text: () => Promise.resolve(REPORT_XML),
		});
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const events = await queryEventsInWindow(settings, 0, 1000);

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe(settings.serverUrl);
		expect(init.method).toBe("REPORT");
		expect((init.headers as Record<string, string>).Authorization).toMatch(
			/^Basic /,
		);

		expect(events).toHaveLength(1);
		expect(events[0]?.href).toBe(
			"/dav/calendars/user@example.com/default/event1.ics",
		);
		expect(events[0]?.etag).toBe('"etag-123"');
		expect(events[0]?.icsText).toContain("SUMMARY:Team Sync");
	});

	it("throws on a non-ok response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 401 }),
		);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		await expect(queryEventsInWindow(settings, 0, 1000)).rejects.toThrow(
			/401/,
		);
	});
});

describe("parseEvent", () => {
	it("extracts fields from an unfolded VEVENT", () => {
		const parsed = parseEvent({
			href: "/e1.ics",
			etag: '"etag-1"',
			icsText:
				"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Team Sync\r\nLOCATION:https://meet.google.com/abc-defg-hij\r\nDTSTART:20260810T140000Z\r\nDTEND:20260810T143000Z\r\nEND:VEVENT\r\nEND:VCALENDAR",
		});

		expect(parsed.summary).toBe("Team Sync");
		expect(parsed.location).toBe("https://meet.google.com/abc-defg-hij");
		expect(parsed.dtstartMs).toBe(Date.UTC(2026, 7, 10, 14, 0, 0));
		expect(parsed.dtendMs).toBe(Date.UTC(2026, 7, 10, 14, 30, 0));
	});
});

describe("attachShareLinkToEvent", () => {
	it("PUTs the .ics with an ATTACH line and the etag as If-Match", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const result = await attachShareLinkToEvent(
			settings,
			{
				href: "event1.ics",
				etag: '"etag-123"',
				icsText:
					"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nEND:VEVENT\r\nEND:VCALENDAR",
			},
			"https://cap.so/s/abc123",
		);

		expect(result).toBe("attached");
		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(init.method).toBe("PUT");
		expect((init.headers as Record<string, string>)["If-Match"]).toBe(
			'"etag-123"',
		);
		expect(String(init.body)).toContain(
			"ATTACH;VALUE=URI:https://cap.so/s/abc123",
		);
		expect(String(init.body)).toMatch(/ATTACH.*\r\nEND:VEVENT/s);
	});

	it("treats a 412 as a conflict, not an error", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 412 }),
		);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const result = await attachShareLinkToEvent(
			settings,
			{
				href: "event1.ics",
				etag: '"stale"',
				icsText: "BEGIN:VEVENT\r\nEND:VEVENT",
			},
			"https://cap.so/s/abc123",
		);

		expect(result).toBe("conflict");
	});

	// FIX-1: an absolute event.href from the REPORT response must never
	// override the configured server's origin for a credentialed PUT.
	it("blocks and does not PUT when the event href resolves off the configured server origin", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const result = await attachShareLinkToEvent(
			settings,
			{
				href: "https://attacker.example/x",
				etag: '"etag-123"',
				icsText: "BEGIN:VEVENT\r\nEND:VEVENT",
			},
			"https://cap.so/s/abc123",
		);

		expect(result).toBe("blocked-off-origin");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// FIX-4: a server that omits getetag must never be blind-overwritten.
	it("blocks and does not PUT when the event has no etag", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const result = await attachShareLinkToEvent(
			settings,
			{
				href: "event1.ics",
				etag: null,
				icsText: "BEGIN:VEVENT\r\nEND:VEVENT",
			},
			"https://cap.so/s/abc123",
		);

		expect(result).toBe("blocked-no-etag");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// FIX-7: never send Basic-auth credentials over a plaintext channel.
	it("blocks and does not PUT when the server URL is not https", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const httpSettings: CalDavSettings = {
			...settings,
			serverUrl: "http://mail.example.com/dav/calendars/user@example.com/default/",
		};

		const result = await attachShareLinkToEvent(
			httpSettings,
			{
				href: "event1.ics",
				etag: '"etag-123"',
				icsText: "BEGIN:VEVENT\r\nEND:VEVENT",
			},
			"https://cap.so/s/abc123",
		);

		expect(result).toBe("blocked-insecure");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	// FIX-6: with a UID on the matched event, ATTACH must land in that
	// VEVENT block, not the first one in a multi-VEVENT (recurrence-override)
	// resource.
	it("scopes the ATTACH insertion to the VEVENT block matching the event's UID", async () => {
		const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const icsText = [
			"BEGIN:VCALENDAR",
			"BEGIN:VEVENT",
			"UID:master-uid",
			"SUMMARY:Master",
			"END:VEVENT",
			"BEGIN:VEVENT",
			"UID:override-uid",
			"RECURRENCE-ID:20260810T140000Z",
			"SUMMARY:Override",
			"END:VEVENT",
			"END:VCALENDAR",
		].join("\r\n");

		await attachShareLinkToEvent(
			settings,
			{ href: "event1.ics", etag: '"etag-123"', icsText, uid: "override-uid" },
			"https://cap.so/s/abc123",
		);

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const body = String(init.body);
		const overrideBlock = body.slice(body.indexOf("override-uid"));
		expect(overrideBlock).toMatch(/ATTACH.*\r\nEND:VEVENT/s);
		const masterBlock = body.slice(0, body.indexOf("override-uid"));
		expect(masterBlock).not.toContain("ATTACH");
	});
});

describe("parseEvent TZID / floating-time handling", () => {
	// FIX-2: a TZID-qualified DTSTART must resolve to the correct UTC instant,
	// not be treated as if it were already UTC.
	it("resolves a TZID DTSTART to the correct UTC epoch", () => {
		const parsed = parseEvent({
			href: "/e1.ics",
			etag: '"etag-1"',
			icsText:
				"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Standup\r\nDTSTART;TZID=America/New_York:20260810T140000\r\nDTEND;TZID=America/New_York:20260810T150000\r\nEND:VEVENT\r\nEND:VCALENDAR",
		});

		// 2026-08-10 is in EDT (UTC-4), so 14:00 local == 18:00Z.
		expect(parsed.dtstartMs).toBe(Date.UTC(2026, 7, 10, 18, 0, 0));
		expect(parsed.dtendMs).toBe(Date.UTC(2026, 7, 10, 19, 0, 0));
	});

	// DST-affected date: same zone, winter offset (EST, UTC-5) to catch a
	// fixed-offset shortcut that only happened to work for the summer case.
	it("resolves a TZID DTSTART correctly across a DST boundary", () => {
		const parsed = parseEvent({
			href: "/e1.ics",
			etag: '"etag-1"',
			icsText:
				"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Standup\r\nDTSTART;TZID=America/New_York:20260115T140000\r\nEND:VEVENT\r\nEND:VCALENDAR",
		});

		// 2026-01-15 is in EST (UTC-5), so 14:00 local == 19:00Z.
		expect(parsed.dtstartMs).toBe(Date.UTC(2026, 0, 15, 19, 0, 0));
	});
});

describe("parseEvent DURATION fallback", () => {
	// FIX-3: DURATION must be used to derive dtendMs when DTEND is absent.
	it("computes dtendMs from DTSTART + DURATION when DTEND is missing", () => {
		const parsed = parseEvent({
			href: "/e1.ics",
			etag: '"etag-1"',
			icsText:
				"BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Standup\r\nDTSTART:20260810T140000Z\r\nDURATION:PT1H\r\nEND:VEVENT\r\nEND:VCALENDAR",
		});

		expect(parsed.dtstartMs).toBe(Date.UTC(2026, 7, 10, 14, 0, 0));
		expect(parsed.dtendMs).toBe(Date.UTC(2026, 7, 10, 15, 0, 0));
	});
});

describe("queryEventsInWindow entity/numeric-ref decoding", () => {
	// FIX-5: numeric-char-ref-encoded CRLFs in <calendar-data> must be decoded
	// before ICS parsing, or the whole VEVENT collapses onto one line.
	it("decodes numeric character references in calendar-data into a parseable multi-line VEVENT", async () => {
		const xml =
			'<?xml version="1.0"?>' +
			'<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">' +
			"<d:response>" +
			"<d:href>/dav/calendars/user@example.com/default/event2.ics</d:href>" +
			"<d:propstat><d:prop>" +
			"<d:getetag>&quot;etag-2&quot;</d:getetag>" +
			"<c:calendar-data>BEGIN:VCALENDAR&#13;&#10;BEGIN:VEVENT&#13;&#10;SUMMARY:Encoded&#13;&#10;DTSTART:20260810T140000Z&#13;&#10;END:VEVENT&#13;&#10;END:VCALENDAR</c:calendar-data>" +
			"</d:prop></d:propstat>" +
			"</d:response>" +
			"</d:multistatus>";

		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve(xml) }),
		);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const events = await queryEventsInWindow(settings, 0, 1000);
		expect(events).toHaveLength(1);

		const parsed = parseEvent(events[0]!);
		expect(parsed.summary).toBe("Encoded");
		expect(parsed.dtstartMs).toBe(Date.UTC(2026, 7, 10, 14, 0, 0));
	});

	// FIX-7: never issue the REPORT (with credentials) against a non-https URL.
	it("throws without fetching when the server URL is not https", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const httpSettings: CalDavSettings = {
			...settings,
			serverUrl: "http://mail.example.com/dav/calendars/user@example.com/default/",
		};

		await expect(queryEventsInWindow(httpSettings, 0, 1000)).rejects.toThrow(
			/https/,
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe("testConnection", () => {
	// FIX-9
	it("reports ok on a 207 multistatus response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 207 }),
		);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const result = await testConnection(settings);
		expect(result.ok).toBe(true);
	});

	it("reports failure with the status code on a 401", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({ ok: false, status: 401 }),
		);
		vi.stubGlobal("btoa", (value: string) => Buffer.from(value).toString("base64"));

		const result = await testConnection(settings);
		expect(result.ok).toBe(false);
		expect(result.status).toBe(401);
	});
});
