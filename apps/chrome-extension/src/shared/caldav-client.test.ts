import { afterEach, describe, expect, it, vi } from "vitest";
import {
	attachShareLinkToEvent,
	parseEvent,
	queryEventsInWindow,
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
});
