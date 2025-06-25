/**
 * Slack ID Resolution Service
 *
 * Provides utilities to resolve Slack user and channel IDs to human-readable names
 * with intelligent caching, error handling, and fallback mechanisms.
 */

import type { SlackApiClient } from "./client";

export interface UserInfo {
	id: string;
	name: string;
	real_name?: string;
	display_name?: string;
	email?: string;
	is_bot: boolean;
	deleted: boolean;
}

export interface ChannelInfo {
	id: string;
	name: string;
	is_channel: boolean;
	is_group: boolean;
	is_im: boolean;
	is_archived: boolean;
	is_private: boolean;
}

export interface ResolverCache {
	users: Map<string, UserInfo>;
	channels: Map<string, ChannelInfo>;
	userCacheExpiry: Map<string, number>;
	channelCacheExpiry: Map<string, number>;
}

export class SlackResolverService {
	private cache: ResolverCache;
	private readonly CACHE_TTL = 1000 * 60 * 15; // 15 minutes
	private readonly MAX_CACHE_SIZE = 1000;

	constructor() {
		this.cache = {
			users: new Map(),
			channels: new Map(),
			userCacheExpiry: new Map(),
			channelCacheExpiry: new Map(),
		};
	}

	/**
	 * Resolve a user ID to user information
	 */
	async resolveUser(
		userId: string,
		slackClient: SlackApiClient,
		token?: string,
	): Promise<UserInfo | null> {
		// Check cache first
		const cached = this.getCachedUser(userId);
		if (cached) {
			return cached;
		}

		try {
			const slackUser = await slackClient.getUser(userId, token);

			const userInfo: UserInfo = {
				id: slackUser.id,
				name: slackUser.name,
				real_name: slackUser.real_name,
				display_name: slackUser.real_name, // Fallback to real_name for display
				email: slackUser.email,
				is_bot: false, // Default to false since it's not in the type
				deleted: false, // Default to false since it's not in the type
			};

			this.cacheUser(userId, userInfo);
			return userInfo;
		} catch (error) {
			console.error(`Error resolving user ${userId}:`, error);
			return null;
		}
	}

	/**
	 * Resolve a channel ID to channel information
	 */
	async resolveChannel(
		channelId: string,
		slackClient: SlackApiClient,
		token?: string,
	): Promise<ChannelInfo | null> {
		// Check cache first
		const cached = this.getCachedChannel(channelId);
		if (cached) {
			return cached;
		}

		try {
			const slackChannel = await slackClient.getChannel(channelId, token);

			const channelInfo: ChannelInfo = {
				id: slackChannel.id,
				name: slackChannel.name,
				is_channel: true, // Default assumption for now
				is_group: false,
				is_im: false,
				is_archived: slackChannel.is_archived,
				is_private: slackChannel.is_private,
			};

			this.cacheChannel(channelId, channelInfo);
			return channelInfo;
		} catch (error) {
			console.error(`Error resolving channel ${channelId}:`, error);
			return null;
		}
	}

	/**
	 * Batch resolve multiple users
	 */
	async resolveUsers(
		userIds: string[],
		slackClient: SlackApiClient,
		token?: string,
	): Promise<Map<string, UserInfo | null>> {
		const results = new Map<string, UserInfo | null>();

		// Separate cached and non-cached IDs
		const uncachedIds: string[] = [];
		for (const userId of userIds) {
			const cached = this.getCachedUser(userId);
			if (cached) {
				results.set(userId, cached);
			} else {
				uncachedIds.push(userId);
			}
		}

		// Resolve uncached users concurrently (with reasonable limits)
		const BATCH_SIZE = 10;
		for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
			const batch = uncachedIds.slice(i, i + BATCH_SIZE);
			const promises = batch.map(async (userId) => {
				const userInfo = await this.resolveUser(userId, slackClient, token);
				results.set(userId, userInfo);
			});

			await Promise.all(promises);

			// Add small delay between batches to avoid rate limits
			if (i + BATCH_SIZE < uncachedIds.length) {
				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}

		return results;
	}

	/**
	 * Batch resolve multiple channels
	 */
	async resolveChannels(
		channelIds: string[],
		slackClient: SlackApiClient,
		token?: string,
	): Promise<Map<string, ChannelInfo | null>> {
		const results = new Map<string, ChannelInfo | null>();

		// Separate cached and non-cached IDs
		const uncachedIds: string[] = [];
		for (const channelId of channelIds) {
			const cached = this.getCachedChannel(channelId);
			if (cached) {
				results.set(channelId, cached);
			} else {
				uncachedIds.push(channelId);
			}
		}

		// Resolve uncached channels concurrently
		const BATCH_SIZE = 5; // Smaller batch for channels
		for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
			const batch = uncachedIds.slice(i, i + BATCH_SIZE);
			const promises = batch.map(async (channelId) => {
				const channelInfo = await this.resolveChannel(
					channelId,
					slackClient,
					token,
				);
				results.set(channelId, channelInfo);
			});

			await Promise.all(promises);

			// Add delay between batches
			if (i + BATCH_SIZE < uncachedIds.length) {
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}

		return results;
	}

	/**
	 * Get user display name with fallbacks
	 */
	getUserDisplayName(userInfo: UserInfo | null, userId: string): string {
		if (!userInfo) {
			return `user:${userId}`;
		}

		if (userInfo.deleted) {
			return `deleted-user:${userInfo.name || userId}`;
		}

		// Prefer display_name > real_name > name > id
		return (
			userInfo.display_name ||
			userInfo.real_name ||
			userInfo.name ||
			`user:${userId}`
		);
	}

	/**
	 * Get channel display name with fallbacks
	 */
	getChannelDisplayName(
		channelInfo: ChannelInfo | null,
		channelId: string,
	): string {
		if (!channelInfo) {
			return `channel:${channelId}`;
		}

		if (channelInfo.is_archived) {
			return `archived-${channelInfo.name}`;
		}

		if (channelInfo.is_im) {
			return "direct-message";
		}

		if (channelInfo.is_private) {
			return `private-${channelInfo.name}`;
		}

		return channelInfo.name || `channel:${channelId}`;
	}

	/**
	 * Extract user and channel IDs from message text
	 */
	extractIdsFromText(text: string): {
		userIds: Set<string>;
		channelIds: Set<string>;
	} {
		const userIds = new Set<string>();
		const channelIds = new Set<string>();

		// Extract user mentions: <@U1234567>
		const userMatches = text.matchAll(/<@([A-Z0-9]+)>/g);
		for (const match of userMatches) {
			userIds.add(match[1]);
		}

		// Extract channel mentions: <#C1234567>
		const channelMatches = text.matchAll(/<#([A-Z0-9]+)>/g);
		for (const match of channelMatches) {
			channelIds.add(match[1]);
		}

		return { userIds, channelIds };
	}

	/**
	 * Cache management methods
	 */
	private getCachedUser(userId: string): UserInfo | null {
		const expiry = this.cache.userCacheExpiry.get(userId);
		if (!expiry || Date.now() > expiry) {
			this.cache.users.delete(userId);
			this.cache.userCacheExpiry.delete(userId);
			return null;
		}

		return this.cache.users.get(userId) || null;
	}

	private getCachedChannel(channelId: string): ChannelInfo | null {
		const expiry = this.cache.channelCacheExpiry.get(channelId);
		if (!expiry || Date.now() > expiry) {
			this.cache.channels.delete(channelId);
			this.cache.channelCacheExpiry.delete(channelId);
			return null;
		}

		return this.cache.channels.get(channelId) || null;
	}

	private cacheUser(userId: string, userInfo: UserInfo): void {
		// Implement LRU-style eviction if cache is full
		if (this.cache.users.size >= this.MAX_CACHE_SIZE) {
			this.evictOldestEntries("users");
		}

		this.cache.users.set(userId, userInfo);
		this.cache.userCacheExpiry.set(userId, Date.now() + this.CACHE_TTL);
	}

	private cacheChannel(channelId: string, channelInfo: ChannelInfo): void {
		// Implement LRU-style eviction if cache is full
		if (this.cache.channels.size >= this.MAX_CACHE_SIZE) {
			this.evictOldestEntries("channels");
		}

		this.cache.channels.set(channelId, channelInfo);
		this.cache.channelCacheExpiry.set(channelId, Date.now() + this.CACHE_TTL);
	}

	private evictOldestEntries(type: "users" | "channels"): void {
		const cache = type === "users" ? this.cache.users : this.cache.channels;
		const expiryCache =
			type === "users"
				? this.cache.userCacheExpiry
				: this.cache.channelCacheExpiry;

		// Remove 10% of oldest entries
		const entriesToRemove = Math.floor(cache.size * 0.1);
		let removed = 0;

		for (const [id, expiry] of expiryCache.entries()) {
			if (removed >= entriesToRemove) break;

			// Find oldest entries or expired ones
			if (Date.now() > expiry) {
				cache.delete(id);
				expiryCache.delete(id);
				removed++;
			}
		}
	}

	/**
	 * Clear all caches
	 */
	clearCache(): void {
		this.cache.users.clear();
		this.cache.channels.clear();
		this.cache.userCacheExpiry.clear();
		this.cache.channelCacheExpiry.clear();
	}

	/**
	 * Get cache statistics for monitoring
	 */
	getCacheStats() {
		return {
			users: {
				size: this.cache.users.size,
				expired: Array.from(this.cache.userCacheExpiry.entries()).filter(
					([_, expiry]) => Date.now() > expiry,
				).length,
			},
			channels: {
				size: this.cache.channels.size,
				expired: Array.from(this.cache.channelCacheExpiry.entries()).filter(
					([_, expiry]) => Date.now() > expiry,
				).length,
			},
		};
	}
}
