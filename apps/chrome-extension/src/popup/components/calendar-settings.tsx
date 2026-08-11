import clsx from "clsx";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { testConnection } from "../../shared/caldav-client";
import type { CalDavSettings, CalendarLinkResult } from "../../shared/types";

interface CalendarSettingsProps {
	settings: CalDavSettings;
	disabled?: boolean;
	onChange: (next: CalDavSettings) => void;
	// Passive last-attempt status, loaded once from storage by the caller —
	// so a silent success/failure in the background auto-link is visible.
	lastCalendarLink?: CalendarLinkResult | null;
}

const isHttpsUrl = (value: string): boolean => {
	if (!value) return true; // don't nag on an empty field
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
};

const formatRelativeTime = (at: number, now: number): string => {
	const diffMs = Math.max(0, now - at);
	const minutes = Math.round(diffMs / 60000);
	if (minutes < 1) return "just now";
	if (minutes < 60) return `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours}h ago`;
	const days = Math.round(hours / 24);
	return `${days}d ago`;
};

// Mirrors SystemAudioToggle's toggle-row pattern, expanded with the three
// connection fields (server URL / username / app password) whenever the
// feature is enabled. Only shown for "tab" mode recordings — CalDAV
// auto-link has no meaning for screen/window/camera captures.
export const CalendarSettings = ({
	settings,
	disabled = false,
	onChange,
	lastCalendarLink = null,
}: CalendarSettingsProps) => {
	const [testState, setTestState] = useState<
		| { status: "idle" }
		| { status: "testing" }
		| { status: "done"; ok: boolean; message: string }
	>({ status: "idle" });

	const update = (patch: Partial<CalDavSettings>) =>
		onChange({ ...settings, ...patch });

	const runTestConnection = async () => {
		setTestState({ status: "testing" });
		const result = await testConnection(settings);
		setTestState({ status: "done", ok: result.ok, message: result.message });
	};

	const urlLooksInsecure = settings.enabled && !isHttpsUrl(settings.serverUrl);

	return (
		<div className="flex flex-col gap-[0.25rem] items-stretch text-[--text-primary]">
			<button
				type="button"
				disabled={disabled}
				onClick={() => update({ enabled: !settings.enabled })}
				className={clsx(
					"relative flex flex-row items-center h-[2rem] px-[0.375rem] gap-[0.375rem] border border-gray-3 rounded-lg w-full transition-colors overflow-hidden font-normal text-[0.875rem] text-[--text-primary] disabled:text-gray-11",
					disabled ? "cursor-default" : "cursor-pointer hover:bg-gray-3/50",
				)}
			>
				<CalendarIcon className="size-4 text-gray-11 shrink-0" />
				<span className="flex-1 text-left truncate">Calendar Auto-Link</span>
				<span
					className={clsx(
						"px-[0.375rem] h-[1.25rem] min-w-[2.5rem] rounded-full text-[0.75rem] leading-[1.25rem] flex items-center justify-center font-normal transition-colors duration-200",
						settings.enabled
							? "bg-[var(--blue-3)] text-[var(--blue-11)]"
							: "bg-[var(--red-3)] text-[var(--red-11)]",
					)}
				>
					{settings.enabled ? "On" : "Off"}
				</span>
			</button>
			{settings.enabled && (
				<div className="flex flex-col gap-[0.375rem] px-[0.375rem] pt-[0.125rem]">
					<input
						type="url"
						placeholder="CalDAV calendar URL"
						value={settings.serverUrl}
						disabled={disabled}
						onChange={(event) => update({ serverUrl: event.target.value })}
						className="h-[1.75rem] rounded-md border border-gray-3 bg-transparent px-[0.5rem] text-[0.75rem] text-[--text-primary] placeholder:text-gray-9 focus:outline-none focus:border-gray-6"
					/>
					<input
						type="text"
						placeholder="Username"
						value={settings.username}
						disabled={disabled}
						autoComplete="off"
						onChange={(event) => update({ username: event.target.value })}
						className="h-[1.75rem] rounded-md border border-gray-3 bg-transparent px-[0.5rem] text-[0.75rem] text-[--text-primary] placeholder:text-gray-9 focus:outline-none focus:border-gray-6"
					/>
					<input
						type="password"
						placeholder="App password"
						value={settings.appPassword}
						disabled={disabled}
						autoComplete="new-password"
						onChange={(event) => update({ appPassword: event.target.value })}
						className="h-[1.75rem] rounded-md border border-gray-3 bg-transparent px-[0.5rem] text-[0.75rem] text-[--text-primary] placeholder:text-gray-9 focus:outline-none focus:border-gray-6"
					/>
					{urlLooksInsecure && (
						<p className="text-[0.6875rem] leading-snug text-[var(--red-11)]">
							Must be an https:// URL — CalDAV credentials are never sent over
							plain http.
						</p>
					)}
					<button
						type="button"
						disabled={disabled || !settings.serverUrl}
						onClick={() => void runTestConnection()}
						className="h-[1.75rem] rounded-md border border-gray-3 text-[0.75rem] text-[--text-primary] hover:bg-gray-3/50 disabled:opacity-50 disabled:cursor-default"
					>
						{testState.status === "testing"
							? "Testing..."
							: "Test connection"}
					</button>
					{testState.status === "done" && (
						<p
							className={clsx(
								"text-[0.6875rem] leading-snug",
								testState.ok
									? "text-[var(--green-11)]"
									: "text-[var(--red-11)]",
							)}
						>
							{testState.ok ? "Connected" : testState.message}
						</p>
					)}
					<p className="text-[0.6875rem] leading-snug text-gray-10">
						Recordings of Meet/Zoom/Teams tabs are matched to a calendar event
						and linked automatically. Must be the calendar COLLECTION URL,
						e.g. https://mail.example.com/dav/calendars/user@example.com/default/
					</p>
					{lastCalendarLink && (
						<p
							className={clsx(
								"text-[0.6875rem] leading-snug",
								lastCalendarLink.ok
									? "text-gray-10"
									: "text-[var(--red-11)]",
							)}
						>
							{lastCalendarLink.detail} ·{" "}
							{formatRelativeTime(lastCalendarLink.at, Date.now())}
						</p>
					)}
				</div>
			)}
		</div>
	);
};
