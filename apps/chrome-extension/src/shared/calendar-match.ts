import { extractMeetingId } from "./meeting-detect";
import type { ParsedCalDavEvent } from "./caldav-client";

// Generous pad: meetings start late, recordings start after join.
export const MATCH_WINDOW_PAD_MS = 15 * 60 * 1000;

export const matchWindowFor = (startedAt: number, durationMs: number) => ({
	start: startedAt - MATCH_WINDOW_PAD_MS,
	end: startedAt + durationMs + MATCH_WINDOW_PAD_MS,
});

// Primary signal: substring-match the meeting's stable id segment against
// LOCATION/DESCRIPTION. Fallback: exactly one VEVENT whose window contains
// startedAt — ambiguity (zero or more than one) means skip, not guess.
export const matchCalendarEvent = (
	events: ParsedCalDavEvent[],
	meetingUrl: string,
	startedAt: number,
): ParsedCalDavEvent | null => {
	const meetingId = extractMeetingId(meetingUrl);
	if (meetingId) {
		const idMatches = events.filter((event) => {
			const haystack = `${event.location ?? ""} ${event.description ?? ""}`;
			return haystack.toLowerCase().includes(meetingId);
		});
		if (idMatches.length === 1) return idMatches[0] ?? null;
		if (idMatches.length > 1) return null;
	}

	const timeMatches = events.filter(
		(event) =>
			event.dtstartMs !== null &&
			event.dtendMs !== null &&
			startedAt >= event.dtstartMs &&
			startedAt <= event.dtendMs,
	);
	return timeMatches.length === 1 ? (timeMatches[0] ?? null) : null;
};
