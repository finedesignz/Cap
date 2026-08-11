// Hostname/path allowlist for the video-meeting platforms the CalDAV
// auto-link feature matches against. Only "tab" mode recordings have a
// single associated tab URL worth checking (fullscreen/window/camera modes
// have no meaningful single-tab origin).
const MEETING_HOST_PATTERNS = [
	/meet\.google\.com/,
	/zoom\.us\/(j|wc|s)\//,
	/teams\.microsoft\.com/,
	/teams\.live\.com/,
];

export const detectMeetingUrl = (
	url: string | undefined | null,
): string | null => {
	if (!url) return null;
	try {
		const { href } = new URL(url);
		return MEETING_HOST_PATTERNS.some((pattern) => pattern.test(href))
			? href
			: null;
	} catch {
		return null;
	}
};

// Extracts the stable meeting-id segment from a joined meeting tab URL, for
// substring-matching against a CalDAV VEVENT's LOCATION/DESCRIPTION text.
// The raw href isn't a reliable match target: invite links are often wrapped
// in redirect params or carry different query strings than the tab the user
// actually joined, but the id segment itself is stable across both.
export const extractMeetingId = (url: string): string | null => {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return null;
	}
	const { hostname, pathname } = parsed;

	if (/meet\.google\.com/.test(hostname)) {
		const match = pathname.match(/\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?:\/|$)/i);
		return match ? match[1].toLowerCase() : null;
	}

	if (/zoom\.us/.test(hostname)) {
		const match = pathname.match(/\/(?:j|wc|s)\/(\d+)/);
		return match ? match[1] : null;
	}

	if (/teams\.microsoft\.com|teams\.live\.com/.test(hostname)) {
		const match = pathname.match(
			/meetup-join\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
		);
		return match ? match[1].toLowerCase() : null;
	}

	return null;
};
