import { describe, expect, it } from "vitest";
import { matchCalendarEvent, matchWindowFor } from "./calendar-match";
import type { ParsedCalDavEvent } from "./caldav-client";

const baseEvent = (
	overrides: Partial<ParsedCalDavEvent>,
): ParsedCalDavEvent => ({
	href: "/calendars/user/default/event.ics",
	etag: '"etag-1"',
	icsText: "",
	summary: null,
	location: null,
	description: null,
	dtstartMs: null,
	dtendMs: null,
	...overrides,
});

describe("matchWindowFor", () => {
	it("pads 15 minutes on each side of the recording window", () => {
		const startedAt = 1_000_000;
		const durationMs = 60_000;
		const { start, end } = matchWindowFor(startedAt, durationMs);
		expect(start).toBe(startedAt - 15 * 60 * 1000);
		expect(end).toBe(startedAt + durationMs + 15 * 60 * 1000);
	});
});

describe("matchCalendarEvent", () => {
	const meetingUrl = "https://meet.google.com/abc-defg-hij";
	const startedAt = 1_700_000_000_000;

	it("matches on meeting-id substring in LOCATION (primary signal)", () => {
		const events = [
			baseEvent({
				href: "/e1.ics",
				location: "https://meet.google.com/abc-defg-hij",
			}),
			baseEvent({ href: "/e2.ics", location: "some other place" }),
		];
		const match = matchCalendarEvent(events, meetingUrl, startedAt);
		expect(match?.href).toBe("/e1.ics");
	});

	it("matches on meeting-id substring in DESCRIPTION", () => {
		const events = [
			baseEvent({
				href: "/e1.ics",
				description: "Join: https://meet.google.com/abc-defg-hij",
			}),
		];
		const match = matchCalendarEvent(events, meetingUrl, startedAt);
		expect(match?.href).toBe("/e1.ics");
	});

	it("skips (returns null) when the meeting id matches more than one event", () => {
		const events = [
			baseEvent({ href: "/e1.ics", location: "abc-defg-hij" }),
			baseEvent({ href: "/e2.ics", description: "abc-defg-hij" }),
		];
		expect(matchCalendarEvent(events, meetingUrl, startedAt)).toBeNull();
	});

	it("falls back to time-window match when no id match exists", () => {
		const events = [
			baseEvent({
				href: "/e1.ics",
				dtstartMs: startedAt - 5000,
				dtendMs: startedAt + 5000,
			}),
			baseEvent({
				href: "/e2.ics",
				dtstartMs: startedAt + 1_000_000,
				dtendMs: startedAt + 2_000_000,
			}),
		];
		const match = matchCalendarEvent(events, meetingUrl, startedAt);
		expect(match?.href).toBe("/e1.ics");
	});

	it("skips (ambiguous) when more than one event's window contains startedAt", () => {
		const events = [
			baseEvent({
				href: "/e1.ics",
				dtstartMs: startedAt - 5000,
				dtendMs: startedAt + 5000,
			}),
			baseEvent({
				href: "/e2.ics",
				dtstartMs: startedAt - 1000,
				dtendMs: startedAt + 1000,
			}),
		];
		expect(matchCalendarEvent(events, meetingUrl, startedAt)).toBeNull();
	});

	it("returns null when there is no match at all", () => {
		const events = [
			baseEvent({
				href: "/e1.ics",
				dtstartMs: startedAt + 1_000_000,
				dtendMs: startedAt + 2_000_000,
			}),
		];
		expect(matchCalendarEvent(events, meetingUrl, startedAt)).toBeNull();
	});
});
