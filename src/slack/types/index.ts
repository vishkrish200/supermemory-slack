// Slack API Types
export interface SlackUser {
	id: string;
	name: string;
	real_name?: string;
	email?: string;
	team_id: string;
}

export interface SlackChannel {
	id: string;
	name: string;
	is_private: boolean;
	is_archived: boolean;
	topic?: {
		value: string;
	};
	purpose?: {
		value: string;
	};
}

export interface SlackFile {
	id: string;
	name: string;
	title?: string;
	mimetype: string;
	url_private: string;
	url_private_download: string;
	size: number;
	user: string;
}

// Slack Block Kit types (simplified)
export interface SlackBlockElement {
	type: string;
	text?: string;
	[key: string]: unknown;
}

export interface SlackBlock {
	type: string;
	text?: {
		type: string;
		text: string;
	};
	elements?: SlackBlockElement[];
	[key: string]: unknown;
}

export interface SlackAttachment {
	id?: string;
	fallback?: string;
	color?: string;
	pretext?: string;
	author_name?: string;
	author_link?: string;
	author_icon?: string;
	title?: string;
	title_link?: string;
	text?: string;
	fields?: Array<{
		title: string;
		value: string;
		short?: boolean;
	}>;
	image_url?: string;
	thumb_url?: string;
	footer?: string;
	footer_icon?: string;
	ts?: string;
	[key: string]: unknown;
}

export interface SlackMessage {
	type: string;
	user: string;
	text: string;
	ts: string;
	thread_ts?: string;
	channel: string;
	files?: SlackFile[];
	blocks?: SlackBlock[];
	attachments?: SlackAttachment[];
	edited?: {
		user: string;
		ts: string;
	};
	subtype?: string;
	bot_id?: string;
}

export interface SlackEventPayload {
	type: string;
	channel?: string;
	user?: string;
	text?: string;
	ts?: string;
	thread_ts?: string;
	files?: SlackFile[];
	message?: SlackMessage;
	channel_type?: string;
	hidden?: boolean;
	subtype?: string;
	[key: string]: unknown;
}

export interface SlackEvent {
	type: string;
	event: SlackEventPayload;
	team_id: string;
	api_app_id: string;
	event_id: string;
	event_time: number;
	event_context: string;
	authorizations?: Array<{
		enterprise_id?: string;
		team_id: string;
		user_id: string;
		is_bot: boolean;
		is_enterprise_install: boolean;
	}>;
}

// OAuth and Token Types
export interface SlackOAuthResponse {
	ok: boolean;
	access_token: string;
	token_type: string;
	scope: string;
	bot_user_id?: string;
	app_id: string;
	team: {
		id: string;
		name: string;
	};
	enterprise?: {
		id: string;
		name: string;
	};
	authed_user: {
		id: string;
		scope?: string;
		access_token?: string;
		token_type?: string;
	};
}

export interface StoredSlackToken {
	access_token: string;
	team_id: string;
	team_name: string;
	user_id: string;
	scope: string;
	bot_user_id?: string;
	app_id: string;
	enterprise_id?: string;
	created_at: number;
	updated_at: number;
	is_revoked: boolean;
}

// Supermemory Integration Types
export interface SupermemoryPayload {
	content: string;
	metadata: {
		provider: string;
		author: string;
		author_name?: string;
		timestamp: string;
		channel: string;
		channel_name?: string;
		thread_id?: string;
		file_urls?: string[];
		message_type?: string;
		team_id?: string;
		team_name?: string;
	};
	tags: string[];
}

export interface SupermemoryResponse {
	id: string;
	success: boolean;
	message?: string;
}

// Configuration Types
export interface SlackConnectorConfig {
	client_id: string;
	client_secret: string;
	signing_secret: string;
	bot_token?: string;
	user_token?: string;
	supermemory_api_url: string;
	supermemory_api_key: string;
}

// Error Types
export interface SlackError {
	ok: false;
	error: string;
	response_metadata?: {
		messages?: string[];
	};
}

// Backfill Types
export interface BackfillRequest {
	team_id: string;
	channel_ids?: string[];
	limit?: number;
	start_date?: string;
	end_date?: string;
}

export interface BackfillProgress {
	team_id: string;
	channel_id: string;
	total_messages: number;
	processed_messages: number;
	status: "pending" | "in_progress" | "completed" | "failed";
	started_at: number;
	completed_at?: number;
	last_cursor?: string;
	error_message?: string;
}
