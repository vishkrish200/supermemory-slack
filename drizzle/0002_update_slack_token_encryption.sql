CREATE TABLE `securityAuditLog` (
	`id` text PRIMARY KEY NOT NULL,
	`eventType` text NOT NULL,
	`teamId` text,
	`tokenId` text,
	`actorType` text NOT NULL,
	`actorId` text,
	`details` text,
	`ipAddress` text,
	`userAgent` text,
	`success` integer NOT NULL,
	`errorMessage` text,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `slackToken` ADD `encryptedToken` text NOT NULL;--> statement-breakpoint
ALTER TABLE `slackToken` ADD `encryptionAlgorithm` text DEFAULT 'AES-GCM-256' NOT NULL;--> statement-breakpoint
ALTER TABLE `slackToken` ADD `keyId` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE `slackToken` ADD `revokedAt` integer;--> statement-breakpoint
ALTER TABLE `slackToken` ADD `revokedReason` text;--> statement-breakpoint
ALTER TABLE `slackToken` DROP COLUMN `accessToken`;