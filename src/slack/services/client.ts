import type {
	SlackChannel,
	SlackError,
	SlackOAuthResponse,
	SlackUser,
} from "../types";

export class SlackApiClient {
	private baseUrl = "https://slack.com/api";

	constructor(private accessToken?: string) {}

	/**
	 * Make an authenticated request to the Slack API
	 */
	private async makeRequest<T>(
		endpoint: string,
		options: RequestInit = {},
		token?: string,
	): Promise<T> {
		const url = `${this.baseUrl}/${endpoint}`;
		const authToken = token || this.accessToken;

		if (!authToken) {
			throw new Error("No access token provided");
		}

		const headers = {
			Authorization: `Bearer ${authToken}`,
			"Content-Type": "application/json",
			...options.headers,
		};

		const response = await fetch(url, {
			...options,
			headers,
		});

		if (!response.ok) {
			throw new Error(
				`Slack API error: ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as T & { ok: boolean; error?: string };

		if (!data.ok) {
			const error = data as SlackError;
			throw new Error(`Slack API error: ${error.error}`);
		}

		return data;
	}

	/**
	 * Exchange OAuth code for access token
	 */
	async exchangeOAuthCode(
		code: string,
		clientId: string,
		clientSecret: string,
		redirectUri?: string,
	): Promise<SlackOAuthResponse> {
		const params = new URLSearchParams({
			client_id: clientId,
			client_secret: clientSecret,
			code,
		});

		if (redirectUri) {
			params.append("redirect_uri", redirectUri);
		}

		const response = await fetch(`${this.baseUrl}/oauth.v2.access`, {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: params,
		});

		const data = (await response.json()) as SlackOAuthResponse;

		if (!data.ok) {
			const error = data as unknown as SlackError;
			throw new Error(`OAuth error: ${error.error}`);
		}

		return data;
	}

	/**
	 * Get user information
	 */
	async getUser(userId: string, token?: string): Promise<SlackUser> {
		const response = await this.makeRequest<{ user: SlackUser }>(
			`users.info?user=${userId}`,
			{},
			token,
		);
		return response.user;
	}

	/**
	 * Get channel information
	 */
	async getChannel(channelId: string, token?: string): Promise<SlackChannel> {
		const response = await this.makeRequest<{ channel: SlackChannel }>(
			`conversations.info?channel=${channelId}`,
			{},
			token,
		);
		return response.channel;
	}

	/**
	 * List channels in a workspace
	 */
	async listChannels(
		token?: string,
		types = "public_channel,private_channel",
		limit = 1000,
	): Promise<SlackChannel[]> {
		const response = await this.makeRequest<{
			channels: SlackChannel[];
			response_metadata?: { next_cursor?: string };
		}>(`conversations.list?types=${types}&limit=${limit}`, {}, token);
		return response.channels;
	}

	/**
	 * Get conversation history
	 */
	async getConversationHistory(
		channelId: string,
		cursor?: string,
		limit = 100,
		oldest?: string,
		latest?: string,
		token?: string,
	): Promise<{
		messages: any[];
		has_more: boolean;
		response_metadata?: { next_cursor?: string };
	}> {
		const params = new URLSearchParams({
			channel: channelId,
			limit: limit.toString(),
		});

		if (cursor) params.append("cursor", cursor);
		if (oldest) params.append("oldest", oldest);
		if (latest) params.append("latest", latest);

		const response = await this.makeRequest<{
			messages: any[];
			has_more: boolean;
			response_metadata?: { next_cursor?: string };
		}>(`conversations.history?${params.toString()}`, {}, token);

		return response;
	}

	/**
	 * Get thread replies
	 */
	async getThreadReplies(
		channelId: string,
		threadTs: string,
		cursor?: string,
		limit = 100,
		token?: string,
	): Promise<{
		messages: any[];
		has_more: boolean;
		response_metadata?: { next_cursor?: string };
	}> {
		const params = new URLSearchParams({
			channel: channelId,
			ts: threadTs,
			limit: limit.toString(),
		});

		if (cursor) params.append("cursor", cursor);

		const response = await this.makeRequest<{
			messages: any[];
			has_more: boolean;
			response_metadata?: { next_cursor?: string };
		}>(`conversations.replies?${params.toString()}`, {}, token);

		return response;
	}

	/**
	 * Test authentication
	 */
	async testAuth(
		token?: string,
	): Promise<{ ok: boolean; team: string; user: string }> {
		return this.makeRequest<{ ok: boolean; team: string; user: string }>(
			"auth.test",
			{},
			token,
		);
	}

	/**
	 * Revoke access token
	 */
	async revokeToken(token: string): Promise<{ ok: boolean; revoked: boolean }> {
		return this.makeRequest<{ ok: boolean; revoked: boolean }>("auth.revoke", {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: `token=${token}`,
		});
	}
}
