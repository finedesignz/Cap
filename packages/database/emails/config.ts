import { buildEnv, serverEnv } from "@cap/env";
import { render } from "@react-email/render";
import type { JSXElementConstructor, ReactElement } from "react";
import { Resend } from "resend";

export const resend = () =>
	serverEnv().RESEND_API_KEY ? new Resend(serverEnv().RESEND_API_KEY) : null;

// Self-hosted Cap can send mail via emails4agents (E4A) instead of Resend.
// E4A takes precedence when configured; Resend remains the fallback.
const e4aConfigured = () =>
	!!serverEnv().E4A_API_KEY && !!serverEnv().E4A_FROM_INBOX_ID;

async function sendViaE4A({
	to,
	subject,
	html,
	cc,
	replyTo,
}: {
	to: string;
	subject: string;
	html: string;
	cc?: string | string[];
	replyTo?: string;
}) {
	const base = serverEnv().E4A_BASE_URL || "https://api.emails4agents.com";
	const res = await fetch(`${base}/v1/messages/send`, {
		method: "POST",
		headers: {
			"X-API-Key": serverEnv().E4A_API_KEY as string,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({
			from_inbox_id: serverEnv().E4A_FROM_INBOX_ID,
			to,
			subject,
			html,
			cc: cc ?? undefined,
			reply_to: replyTo ?? undefined,
		}),
	});

	if (!res.ok) {
		const body = await res.text().catch(() => "");
		throw new Error(`E4A send failed (${res.status}): ${body.slice(0, 300)}`);
	}

	return res.json();
}

export const sendEmail = async ({
	email,
	subject,
	react,
	marketing,
	test,
	scheduledAt,
	cc,
	replyTo,
	fromOverride,
}: {
	email: string;
	subject: string;
	react: ReactElement<unknown, string | JSXElementConstructor<unknown>>;
	marketing?: boolean;
	test?: boolean;
	scheduledAt?: string;
	cc?: string | string[];
	replyTo?: string;
	fromOverride?: string;
}) => {
	if (marketing && !buildEnv.NEXT_PUBLIC_IS_CAP) return;

	const to = test ? "delivered@resend.dev" : email;

	// Prefer emails4agents when configured (self-host default).
	if (e4aConfigured()) {
		const html = await render(react);
		return sendViaE4A({
			to,
			subject,
			html,
			cc: test ? undefined : cc,
			replyTo,
		});
	}

	const r = resend();
	if (!r) {
		return Promise.resolve();
	}

	let from: string;

	if (fromOverride) from = fromOverride;
	else if (marketing) from = "Richie from Cap <richie@send.cap.so>";
	else if (buildEnv.NEXT_PUBLIC_IS_CAP)
		from = "Cap Auth <no-reply@auth.cap.so>";
	else from = `auth@${serverEnv().RESEND_FROM_DOMAIN}`;

	return r.emails.send({
		from,
		to,
		subject,
		react,
		scheduledAt,
		cc: test ? undefined : cc,
		replyTo: replyTo,
	});
};
