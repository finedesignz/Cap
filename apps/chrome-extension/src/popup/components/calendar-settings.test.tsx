import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CalDavSettings, CalendarLinkResult } from "../../shared/types";
import { CalendarSettings } from "./calendar-settings";

const settings: CalDavSettings = {
	enabled: true,
	serverUrl: "https://mail.example.com/dav/calendars/user@example.com/default/",
	username: "user@example.com",
	appPassword: "app-password",
};

// FIX-8: the last background auto-link attempt (success or failure) must be
// visible somewhere in the settings UI, not silent.
describe("CalendarSettings lastCalendarLink status", () => {
	it("renders the last-attempt detail text when a result is present", () => {
		const lastCalendarLink: CalendarLinkResult = {
			at: Date.now() - 60000,
			ok: true,
			detail: "Linked to: Team Standup",
		};

		const html = renderToStaticMarkup(
			<CalendarSettings
				settings={settings}
				onChange={() => undefined}
				lastCalendarLink={lastCalendarLink}
			/>,
		);

		expect(html).toContain("Linked to: Team Standup");
	});

	it("renders nothing extra when no result has been recorded yet", () => {
		const html = renderToStaticMarkup(
			<CalendarSettings
				settings={settings}
				onChange={() => undefined}
				lastCalendarLink={null}
			/>,
		);

		expect(html).not.toContain("Linked to:");
	});

	it("shows an inline https warning for a non-https server URL", () => {
		const html = renderToStaticMarkup(
			<CalendarSettings
				settings={{ ...settings, serverUrl: "http://mail.example.com/cal/" }}
				onChange={() => undefined}
			/>,
		);

		expect(html.toLowerCase()).toContain("https");
	});
});
