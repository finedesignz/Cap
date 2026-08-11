import { describe, expect, it } from "vitest";
import { detectMeetingUrl, extractMeetingId } from "./meeting-detect";

describe("detectMeetingUrl", () => {
	it("detects a Google Meet URL", () => {
		expect(detectMeetingUrl("https://meet.google.com/abc-defg-hij")).toBe(
			"https://meet.google.com/abc-defg-hij",
		);
	});

	it("detects a Zoom join URL", () => {
		expect(
			detectMeetingUrl("https://zoom.us/j/1234567890?pwd=abc"),
		).toBe("https://zoom.us/j/1234567890?pwd=abc");
	});

	it("detects a Teams meeting URL", () => {
		expect(
			detectMeetingUrl(
				"https://teams.microsoft.com/l/meetup-join/19%3ameeting_abc",
			),
		).not.toBeNull();
	});

	it("rejects an unrelated URL", () => {
		expect(detectMeetingUrl("https://example.com/dashboard")).toBeNull();
	});

	it("rejects undefined/null/invalid input", () => {
		expect(detectMeetingUrl(undefined)).toBeNull();
		expect(detectMeetingUrl(null)).toBeNull();
		expect(detectMeetingUrl("not-a-url")).toBeNull();
		expect(detectMeetingUrl("")).toBeNull();
	});
});

describe("extractMeetingId", () => {
	it("extracts the Google Meet code", () => {
		expect(extractMeetingId("https://meet.google.com/abc-defg-hij")).toBe(
			"abc-defg-hij",
		);
	});

	it("extracts the Zoom numeric meeting id from /j/", () => {
		expect(
			extractMeetingId("https://zoom.us/j/1234567890?pwd=abc"),
		).toBe("1234567890");
	});

	it("extracts the Zoom numeric meeting id from /wc/join/", () => {
		expect(extractMeetingId("https://zoom.us/wc/9998887777/join")).toBe(
			"9998887777",
		);
	});

	it("extracts the Teams meetup-join GUID", () => {
		const url =
			"https://teams.microsoft.com/l/meetup-join/12345678-90ab-cdef-1234-567890abcdef/0";
		expect(extractMeetingId(url)).toBe(
			"12345678-90ab-cdef-1234-567890abcdef",
		);
	});

	it("returns null for a non-meeting host", () => {
		expect(extractMeetingId("https://example.com/abc")).toBeNull();
	});

	it("returns null for invalid input", () => {
		expect(extractMeetingId("not-a-url")).toBeNull();
	});
});
