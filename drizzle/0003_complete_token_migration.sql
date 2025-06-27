-- Complete the token migration by removing the old accessToken field
-- This field was left behind in migration 0002 and is still marked as NOT NULL

-- Step 1: Create a backup of current data 
CREATE TEMPORARY TABLE slackToken_backup AS SELECT * FROM slackToken;

-- Step 2: Drop the old table
DROP TABLE slackToken;

-- Step 3: Recreate table with only the new schema (no accessToken)
CREATE TABLE `slackToken` (
  `id` text PRIMARY KEY NOT NULL,
  `teamId` text NOT NULL,
  `userId` text,
  `slackUserId` text NOT NULL,
  `encryptedToken` text DEFAULT '' NOT NULL,
  `encryptionAlgorithm` text DEFAULT 'AES-GCM-256' NOT NULL,
  `keyId` text DEFAULT 'default' NOT NULL,
  `tokenType` text DEFAULT 'bearer' NOT NULL,
  `scope` text NOT NULL,
  `botUserId` text,
  `appId` text NOT NULL,
  `isRevoked` integer DEFAULT false NOT NULL,
  `revokedAt` integer,
  `revokedReason` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`teamId`) REFERENCES `slackTeam`(`id`) ON UPDATE no action ON DELETE cascade
);

-- Step 4: Create indexes
CREATE INDEX `slackToken_teamId_idx` ON `slackToken` (`teamId`);
CREATE INDEX `slackToken_slackUserId_idx` ON `slackToken` (`slackUserId`);
CREATE INDEX `slackToken_isRevoked_idx` ON `slackToken` (`isRevoked`);

-- Step 5: Restore data from backup (migrate any existing data if present)
-- Note: This will be empty since we haven't successfully inserted any tokens yet
INSERT INTO slackToken 
SELECT 
  id, teamId, userId, slackUserId, encryptedToken, 
  encryptionAlgorithm, keyId, tokenType, scope, 
  botUserId, appId, isRevoked, revokedAt, revokedReason,
  createdAt, updatedAt
FROM slackToken_backup;

-- Step 6: Clean up backup table
DROP TABLE slackToken_backup; 