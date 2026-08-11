import clsx from "clsx";
import { CalendarIcon } from "lucide-react";
import type { CalDavSettings } from "../../shared/types";

interface CalendarSettingsProps {
	settings: CalDavSettings;
	disabled?: boolean;
	onChange: (next: CalDavSettings) => void;
}

// Mirrors SystemAudioToggle's toggle-row pattern, expanded with the three
// connection fields (server URL / username / app password) whenever the
// feature is enabled. Only shown for "tab" mode recordings — CalDAV
// auto-link has no meaning for screen/window/camera captures.
export const CalendarSettings = ({
	settings,
	disabled = false,
	onChange,
}: CalendarSettingsProps) => {
	const update = (patch: Partial<CalDavSettings>) =>
		onChange({ ...settings, ...patch });

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
					<p className="text-[0.6875rem] leading-snug text-gray-10">
						Recordings of Meet/Zoom/Teams tabs are matched to a calendar event
						and linked automatically.
					</p>
				</div>
			)}
		</div>
	);
};
