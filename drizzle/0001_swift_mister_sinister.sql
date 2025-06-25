CREATE TABLE `slackBackfill` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`channelId` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`totalMessages` integer DEFAULT 0,
	`processedMessages` integer DEFAULT 0,
	`lastCursor` text,
	`startDate` text,
	`endDate` text,
	`messageLimit` integer,
	`errorMessage` text,
	`startedAt` integer,
	`completedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `slackTeam`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channelId`) REFERENCES `slackChannel`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `slackChannel` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`name` text NOT NULL,
	`isPrivate` integer DEFAULT false NOT NULL,
	`isArchived` integer DEFAULT false NOT NULL,
	`isSyncEnabled` integer DEFAULT false NOT NULL,
	`documentLimit` integer DEFAULT 1000,
	`lastSyncAt` integer,
	`lastMessageTs` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `slackTeam`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `slackSyncLog` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`channelId` text,
	`messageTs` text NOT NULL,
	`supermemoryId` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`errorMessage` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `slackTeam`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`channelId`) REFERENCES `slackChannel`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `slackTeam` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`enterpriseId` text,
	`enterpriseName` text,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `slackToken` (
	`id` text PRIMARY KEY NOT NULL,
	`teamId` text NOT NULL,
	`userId` text,
	`slackUserId` text NOT NULL,
	`accessToken` text NOT NULL,
	`tokenType` text DEFAULT 'bearer' NOT NULL,
	`scope` text NOT NULL,
	`botUserId` text,
	`appId` text NOT NULL,
	`isRevoked` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`teamId`) REFERENCES `slackTeam`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
