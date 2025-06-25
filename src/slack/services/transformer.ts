import type { SlackMessage, SupermemoryPayload } from "../types";
import type { SlackApiClient } from "./client";
import { type ProcessedFile, SlackFileHandler } from "./fileHandler";
import { SlackResolverService } from "./resolver";

export class MessageTransformerService {
	private resolver: SlackResolverService;
	private fileHandler: SlackFileHandler;

	constructor() {
		this.resolver = new SlackResolverService();
		this.fileHandler = new SlackFileHandler();
	}

	/**
	 * Enhanced transform a Slack message to Supermemory format with resolution
	 */
	async transformMessageWithResolution(
		message: SlackMessage,
		teamId: string,
		slackClient: SlackApiClient,
		token?: string,
		teamName?: string,
		channelName?: string,
	): Promise<SupermemoryPayload> {
		// Resolve user and channel information
		const [userInfo, channelInfo] = await Promise.all([
			this.resolver.resolveUser(message.user, slackClient, token),
			channelName
				? null
				: this.resolver.resolveChannel(message.channel, slackClient, token),
		]);

		const resolvedChannelName =
			channelName ||
			(channelInfo
				? this.resolver.getChannelDisplayName(channelInfo, message.channel)
				: message.channel);

		const authorName = userInfo
			? this.resolver.getUserDisplayName(userInfo, message.user)
			: message.user;

		// Process files if present
		let processedFiles: ProcessedFile[] = [];
		if (message.files && message.files.length > 0) {
			processedFiles = await this.fileHandler.processFiles(
				message.files,
				slackClient,
				token,
				{
					extractTextContent: true,
					maxFileSize: 10 * 1024 * 1024, // 10MB limit
					extractMetadata: true,
				},
			);
		}

		// Enhanced content processing
		let content = this.processMessageText(message.text);

		// Add file content and summaries
		if (processedFiles.length > 0) {
			const fileSummary = this.fileHandler.generateFileSummary(processedFiles);
			if (fileSummary) {
				content = content ? `${content}\n\n${fileSummary}` : fileSummary;
			}

			// Add text content from files
			for (const file of processedFiles) {
				if (file.content) {
					content += `\n\n--- Content from ${file.name} ---\n${file.content}`;
				}
			}
		}

		// Generate enhanced tags
		const tags = this.generateEnhancedTags(
			message,
			teamId,
			resolvedChannelName,
			processedFiles,
		);

		// Extract file URLs
		const fileUrls =
			processedFiles.length > 0
				? this.fileHandler.getFileUrls(processedFiles)
				: message.files?.map((file) => file.url_private) || [];

		return {
			content,
			metadata: {
				provider: "slack",
				author: message.user,
				author_name: authorName,
				timestamp: this.convertSlackTimestamp(message.ts),
				channel: message.channel,
				channel_name: resolvedChannelName,
				thread_id: message.thread_ts,
				file_urls: fileUrls.length > 0 ? fileUrls : undefined,
				message_type: this.getMessageType(message),
				team_id: teamId,
				team_name: teamName,
			},
			tags,
		};
	}

	/**
	 * Transform a Slack message to Supermemory format (legacy method)
	 */
	transformMessage(
		message: SlackMessage,
		teamId: string,
		teamName?: string,
		channelName?: string,
		authorName?: string,
	): SupermemoryPayload {
		// Clean and process the message text
		const content = this.processMessageText(message.text);

		// Determine message type
		const messageType = this.getMessageType(message);

		// Extract file URLs if present
		const fileUrls = message.files?.map((file) => file.url_private) || [];

		// Generate tags
		const tags = this.generateTags(message, teamId, channelName);

		return {
			content,
			metadata: {
				provider: "slack",
				author: message.user,
				author_name: authorName,
				timestamp: this.convertSlackTimestamp(message.ts),
				channel: message.channel,
				channel_name: channelName,
				thread_id: message.thread_ts,
				file_urls: fileUrls.length > 0 ? fileUrls : undefined,
				message_type: messageType,
				team_id: teamId,
				team_name: teamName,
			},
			tags,
		};
	}

	/**
	 * Process message text to handle Slack formatting
	 */
	private processMessageText(text: string): string {
		if (!text) return "";

		let processedText = text;

		// Convert user mentions
		processedText = processedText.replace(
			/<@([A-Z0-9]+)(\|([^>]+))?>/g,
			(_match, userId, _pipe, username) => {
				return username ? `@${username}` : `@${userId}`;
			},
		);

		// Convert channel mentions
		processedText = processedText.replace(
			/<#([A-Z0-9]+)(\|([^>]+))?>/g,
			(_match, channelId, _pipe, channelName) => {
				return channelName ? `#${channelName}` : `#${channelId}`;
			},
		);

		// Convert URLs
		processedText = processedText.replace(
			/<(https?:\/\/[^>|]+)(\|([^>]+))?>/g,
			(_match, url, _pipe, linkText) => {
				return linkText ? `[${linkText}](${url})` : url;
			},
		);

		// Convert bold text
		processedText = processedText.replace(/\*([^*]+)\*/g, "**$1**");

		// Convert italic text
		processedText = processedText.replace(/_([^_]+)_/g, "*$1*");

		// Convert strikethrough
		processedText = processedText.replace(/~([^~]+)~/g, "~~$1~~");

		// Convert inline code
		processedText = processedText.replace(/`([^`]+)`/g, "`$1`");

		// Convert code blocks
		processedText = processedText.replace(/```([^`]+)```/g, "```\n$1\n```");

		return processedText.trim();
	}

	/**
	 * Process message text with resolved user and channel names
	 */
	private processMessageTextWithResolution(
		text: string,
		userResolutions: Map<string, any>,
		channelResolutions: Map<string, any>,
	): string {
		if (!text) return "";

		let processedText = text;

		// Convert user mentions with resolved names
		processedText = processedText.replace(
			/<@([A-Z0-9]+)(\|([^>]+))?>/g,
			(_match, userId, _pipe, username) => {
				const userInfo = userResolutions.get(userId);
				if (userInfo) {
					const displayName = this.resolver.getUserDisplayName(
						userInfo,
						userId,
					);
					return `@${displayName}`;
				}
				return username ? `@${username}` : `@${userId}`;
			},
		);

		// Convert channel mentions with resolved names
		processedText = processedText.replace(
			/<#([A-Z0-9]+)(\|([^>]+))?>/g,
			(_match, channelId, _pipe, channelName) => {
				const channelInfo = channelResolutions.get(channelId);
				if (channelInfo) {
					const displayName = this.resolver.getChannelDisplayName(
						channelInfo,
						channelId,
					);
					return `#${displayName}`;
				}
				return channelName ? `#${channelName}` : `#${channelId}`;
			},
		);

		// Apply standard text processing
		return this.processMessageText(processedText);
	}

	/**
	 * Determine the type of message
	 */
	private getMessageType(message: SlackMessage): string {
		if (message.subtype) {
			return message.subtype;
		}

		if (message.files && message.files.length > 0) {
			return "file_share";
		}

		if (message.thread_ts && message.thread_ts !== message.ts) {
			return "thread_reply";
		}

		if (message.blocks && message.blocks.length > 0) {
			return "rich_message";
		}

		return "message";
	}

	/**
	 * Generate appropriate tags for the message
	 */
	private generateTags(
		message: SlackMessage,
		teamId: string,
		channelName?: string,
	): string[] {
		const tags = ["slack"];

		// Add team tag
		tags.push(`team:${teamId}`);

		// Add channel tag
		if (channelName) {
			tags.push(`channel:${channelName}`);
		} else {
			tags.push(`channel:${message.channel}`);
		}

		// Add thread tag if it's a thread
		if (message.thread_ts) {
			tags.push("thread");
			if (message.thread_ts !== message.ts) {
				tags.push("thread-reply");
			} else {
				tags.push("thread-parent");
			}
		}

		// Add file tag if files are present
		if (message.files && message.files.length > 0) {
			tags.push("files");

			// Add specific file type tags
			const fileTypes = message.files.map((file) => {
				if (file.mimetype.startsWith("image/")) return "image";
				if (file.mimetype.startsWith("video/")) return "video";
				if (file.mimetype.startsWith("audio/")) return "audio";
				if (file.mimetype.includes("pdf")) return "pdf";
				if (
					file.mimetype.includes("document") ||
					file.mimetype.includes("text")
				)
					return "document";
				return "file";
			});

			tags.push(...[...new Set(fileTypes)]);
		}

		// Add message type tag
		const messageType = this.getMessageType(message);
		if (messageType !== "message") {
			tags.push(`type:${messageType}`);
		}

		return tags;
	}

	/**
	 * Generate enhanced tags with file and resolution information
	 */
	private generateEnhancedTags(
		message: SlackMessage,
		teamId: string,
		channelName?: string,
		processedFiles: ProcessedFile[] = [],
	): string[] {
		const tags = this.generateTags(message, teamId, channelName);

		// Add file-specific tags
		if (processedFiles.length > 0) {
			// Add file type tags
			const fileTypes = new Set(
				processedFiles.map((file) => file.metadata.type),
			);
			for (const type of fileTypes) {
				tags.push(`file-type:${type}`);
			}

			// Add file category tags
			const categories = new Set(
				processedFiles.map((file) => file.metadata.category),
			);
			for (const category of categories) {
				tags.push(`file-category:${category}`);
			}

			// Add content availability tags
			const hasTextContent = processedFiles.some((file) => file.content);
			if (hasTextContent) {
				tags.push("has-text-content");
			}
		}

		// Add enhanced thread tags
		if (message.thread_ts) {
			if (message.thread_ts === message.ts) {
				tags.push("thread-start");
			} else {
				tags.push("thread-reply");
			}
		}

		return tags;
	}

	/**
	 * Convert Slack timestamp to ISO string
	 */
	private convertSlackTimestamp(slackTs: string): string {
		const timestamp = Number.parseFloat(slackTs) * 1000;
		return new Date(timestamp).toISOString();
	}

	/**
	 * Transform multiple messages in batch
	 */
	transformMessages(
		messages: SlackMessage[],
		teamId: string,
		teamName?: string,
		channelName?: string,
		userIdToNameMap?: Map<string, string>,
	): SupermemoryPayload[] {
		return messages.map((message) => {
			const authorName = userIdToNameMap?.get(message.user);
			return this.transformMessage(
				message,
				teamId,
				teamName,
				channelName,
				authorName,
			);
		});
	}

	/**
	 * Enhanced batch transformation with resolution and file processing
	 */
	async transformMessagesWithResolution(
		messages: SlackMessage[],
		teamId: string,
		slackClient: SlackApiClient,
		token?: string,
		teamName?: string,
		channelName?: string,
	): Promise<SupermemoryPayload[]> {
		// Extract all unique user and channel IDs for batch resolution
		const userIds = new Set<string>();
		const channelIds = new Set<string>();

		for (const message of messages) {
			userIds.add(message.user);
			if (!channelName) {
				channelIds.add(message.channel);
			}

			// Extract IDs from message text
			const extractedIds = this.resolver.extractIdsFromText(message.text);
			extractedIds.userIds.forEach((id) => userIds.add(id));
			extractedIds.channelIds.forEach((id) => channelIds.add(id));
		}

		// Batch resolve all users and channels
		const [userResolutions, channelResolutions] = await Promise.all([
			this.resolver.resolveUsers(Array.from(userIds), slackClient, token),
			channelIds.size > 0
				? this.resolver.resolveChannels(
						Array.from(channelIds),
						slackClient,
						token,
					)
				: new Map(),
		]);

		// Transform messages with resolution
		const BATCH_SIZE = 5;
		const results: SupermemoryPayload[] = [];

		for (let i = 0; i < messages.length; i += BATCH_SIZE) {
			const batch = messages.slice(i, i + BATCH_SIZE);

			const batchPromises = batch.map(async (message) => {
				const userInfo = userResolutions.get(message.user);
				const channelInfo = channelName
					? null
					: channelResolutions.get(message.channel);

				const resolvedChannelName =
					channelName ||
					(channelInfo
						? this.resolver.getChannelDisplayName(channelInfo, message.channel)
						: message.channel);

				const authorName = userInfo
					? this.resolver.getUserDisplayName(userInfo, message.user)
					: message.user;

				// Process files if present
				let processedFiles: ProcessedFile[] = [];
				if (message.files && message.files.length > 0) {
					processedFiles = await this.fileHandler.processFiles(
						message.files,
						slackClient,
						token,
						{
							extractTextContent: true,
							maxFileSize: 5 * 1024 * 1024, // 5MB for batch processing
							extractMetadata: true,
						},
					);
				}

				// Enhanced content processing with resolved mentions
				let content = this.processMessageTextWithResolution(
					message.text,
					userResolutions,
					channelResolutions,
				);

				// Add file content and summaries
				if (processedFiles.length > 0) {
					const fileSummary =
						this.fileHandler.generateFileSummary(processedFiles);
					if (fileSummary) {
						content = content ? `${content}\n\n${fileSummary}` : fileSummary;
					}
				}

				// Generate enhanced tags
				const tags = this.generateEnhancedTags(
					message,
					teamId,
					resolvedChannelName,
					processedFiles,
				);

				// Extract file URLs
				const fileUrls =
					processedFiles.length > 0
						? this.fileHandler.getFileUrls(processedFiles)
						: message.files?.map((file) => file.url_private) || [];

				return {
					content,
					metadata: {
						provider: "slack",
						author: message.user,
						author_name: authorName,
						timestamp: this.convertSlackTimestamp(message.ts),
						channel: message.channel,
						channel_name: resolvedChannelName,
						thread_id: message.thread_ts,
						file_urls: fileUrls.length > 0 ? fileUrls : undefined,
						message_type: this.getMessageType(message),
						team_id: teamId,
						team_name: teamName,
					},
					tags,
				};
			});

			const batchResults = await Promise.all(batchPromises);
			results.push(...batchResults);

			// Small delay between batches
			if (i + BATCH_SIZE < messages.length) {
				await new Promise((resolve) => setTimeout(resolve, 200));
			}
		}

		return results;
	}

	/**
	 * Extract text content from Slack blocks (rich text)
	 */
	extractTextFromBlocks(blocks: Record<string, unknown>[]): string {
		if (!blocks || blocks.length === 0) return "";

		const textParts: string[] = [];

		for (const block of blocks) {
			if (block.type === "section" && block.text) {
				const textBlock = block.text as Record<string, unknown>;
				textParts.push((textBlock.text as string) || "");
			} else if (block.type === "rich_text" && block.elements) {
				const elements = block.elements as Record<string, unknown>[];
				for (const element of elements) {
					if (element.type === "rich_text_section" && element.elements) {
						const textElements = element.elements as Record<string, unknown>[];
						for (const textElement of textElements) {
							if (textElement.text) {
								textParts.push(textElement.text as string);
							}
						}
					}
				}
			}
		}

		return textParts.join(" ").trim();
	}

	/**
	 * Check if message should be processed
	 */
	shouldProcessMessage(message: SlackMessage): boolean {
		// Skip bot messages to avoid loops
		if (message.bot_id || message.subtype === "bot_message") {
			return false;
		}

		// Skip empty messages
		if (!message.text && (!message.files || message.files.length === 0)) {
			return false;
		}

		// Skip system messages
		if (
			message.subtype &&
			[
				"channel_join",
				"channel_leave",
				"channel_topic",
				"channel_purpose",
				"channel_name",
				"channel_archive",
				"channel_unarchive",
			].includes(message.subtype)
		) {
			return false;
		}

		return true;
	}
}
