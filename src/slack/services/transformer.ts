import type { SlackMessage, SupermemoryPayload } from "../types";

export class MessageTransformerService {
  /**
   * Transform a Slack message to Supermemory format
   */
  transformMessage(
    message: SlackMessage,
    teamId: string,
    teamName?: string,
    channelName?: string,
    authorName?: string
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

    // Convert user mentions from <@USER_ID> to @username format
    processedText = processedText.replace(
      /<@([A-Z0-9]+)(\|([^>]+))?>/g,
      (match, userId, pipe, username) => {
        return username ? `@${username}` : `@${userId}`;
      }
    );

    // Convert channel mentions from <#CHANNEL_ID> to #channel format
    processedText = processedText.replace(
      /<#([A-Z0-9]+)(\|([^>]+))?>/g,
      (match, channelId, pipe, channelName) => {
        return channelName ? `#${channelName}` : `#${channelId}`;
      }
    );

    // Convert URLs from <URL|text> to [text](URL) or just URL
    processedText = processedText.replace(/<([^|>]+)\|([^>]+)>/g, "[$2]($1)");
    processedText = processedText.replace(/<([^>]+)>/g, "$1");

    // Handle special formatting
    processedText = processedText.replace(/```([^`]*)```/g, "```\n$1\n```"); // Code blocks
    processedText = processedText.replace(/`([^`]+)`/g, "`$1`"); // Inline code
    processedText = processedText.replace(/\*([^*]+)\*/g, "**$1**"); // Bold
    processedText = processedText.replace(/_([^_]+)_/g, "*$1*"); // Italic
    processedText = processedText.replace(/~([^~]+)~/g, "~~$1~~"); // Strikethrough

    return processedText.trim();
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
    channelName?: string
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
    userIdToNameMap?: Map<string, string>
  ): SupermemoryPayload[] {
    return messages.map((message) => {
      const authorName = userIdToNameMap?.get(message.user);
      return this.transformMessage(
        message,
        teamId,
        teamName,
        channelName,
        authorName
      );
    });
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
