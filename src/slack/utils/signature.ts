import { timingSafeEqual } from "node:crypto";
import type { SlackEvent } from "../types";

/**
 * Verify Slack request signature
 * @param request - The incoming request
 * @param signingSecret - Slack signing secret
 * @returns Promise<boolean> - Whether the signature is valid
 */
export async function verifySlackSignature(
	request: Request,
	signingSecret: string,
): Promise<boolean> {
	const timestamp = request.headers.get("X-Slack-Request-Timestamp");
	const signature = request.headers.get("X-Slack-Signature");

	if (!timestamp || !signature) {
		return false;
	}

	// Verify timestamp is within 5 minutes to prevent replay attacks
	const currentTime = Math.floor(Date.now() / 1000);
	if (Math.abs(currentTime - Number.parseInt(timestamp)) > 300) {
		return false;
	}

	// Get the raw body
	const body = await request.text();

	// Create the base string for signing
	const baseString = `v0:${timestamp}:${body}`;

	// Create HMAC SHA256 signature
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(signingSecret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	const signatureArray = await crypto.subtle.sign(
		"HMAC",
		key,
		encoder.encode(baseString),
	);

	// Convert to hex string
	const computedSignature = `v0=${Array.from(new Uint8Array(signatureArray))
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("")}`;

	// Compare signatures using timing-safe comparison
	try {
		return timingSafeEqual(
			Buffer.from(signature),
			Buffer.from(computedSignature),
		);
	} catch {
		// Fallback for environments without Buffer
		return signature === computedSignature;
	}
}

/**
 * Validate Slack event payload
 */
export function validateSlackEvent(payload: unknown): payload is SlackEvent {
	if (!payload || typeof payload !== "object") return false;

	const p = payload as Record<string, unknown>;

	// Handle URL verification challenge
	if (p.type === "url_verification") {
		return typeof p.challenge === "string";
	}

	// Handle event callbacks
	if (p.type === "event_callback") {
		return !!(
			p.team_id &&
			p.api_app_id &&
			p.event &&
			typeof p.event === "object" &&
			(p.event as Record<string, unknown>).type
		);
	}

	return false;
}

/**
 * Extract team ID from various Slack payload types
 */
export function extractTeamId(payload: Record<string, unknown>): string | null {
	return (
		(payload.team_id as string) ||
		((payload.team as Record<string, unknown>)?.id as string) ||
		null
	);
}

/**
 * Check if a Slack event should be processed
 */
export function shouldProcessEvent(event: Record<string, unknown>): boolean {
	// Skip bot messages by default to avoid loops
	if (event.bot_id || event.subtype === "bot_message") {
		return false;
	}

	// Skip hidden messages (deleted, etc.)
	if (event.hidden) {
		return false;
	}

	// Skip message changed/deleted events for now
	if (
		event.subtype === "message_changed" ||
		event.subtype === "message_deleted"
	) {
		return false;
	}

	// Process regular messages and file shares
	return event.type === "message" || event.type === "file_shared";
}
