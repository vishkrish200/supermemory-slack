import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("emailVerified", { mode: "boolean" })
    .notNull()
    .default(false),
  image: text("image"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
  subscriptionId: text("subscriptionId"),
  lastKeyGeneratedAt: integer("lastKeyGeneratedAt", { mode: "timestamp" }),
});

export const session = sqliteTable("session", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  token: text("token").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  ipAddress: text("ipAddress"),
  userAgent: text("userAgent"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const account = sqliteTable("account", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  accountId: text("accountId").notNull(),
  providerId: text("providerId").notNull(),
  accessToken: text("accessToken"),
  refreshToken: text("refreshToken"),
  accessTokenExpiresAt: integer("accessTokenExpiresAt", { mode: "timestamp" }),
  refreshTokenExpiresAt: integer("refreshTokenExpiresAt", {
    mode: "timestamp",
  }),
  scope: text("scope"),
  idToken: text("idToken"),
  password: text("password"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const verification = sqliteTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: integer("expiresAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const rateLimit = sqliteTable("rateLimit", {
  id: text("id").primaryKey(),
  userId: text("userId")
    .notNull()
    .references(() => user.id),
  endpoint: text("endpoint").notNull(),
  count: integer("count").notNull().default(0),
  resetAt: integer("resetAt", { mode: "timestamp" }).notNull(),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

// Slack-specific tables
export const slackTeam = sqliteTable("slackTeam", {
  id: text("id").primaryKey(), // Slack team ID
  name: text("name").notNull(),
  domain: text("domain"),
  enterpriseId: text("enterpriseId"),
  enterpriseName: text("enterpriseName"),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const slackToken = sqliteTable("slackToken", {
  id: text("id").primaryKey(),
  teamId: text("teamId")
    .notNull()
    .references(() => slackTeam.id),
  userId: text("userId").references(() => user.id), // Optional: link to our user system
  slackUserId: text("slackUserId").notNull(), // Slack user ID
  accessToken: text("accessToken").notNull(), // Encrypted
  tokenType: text("tokenType").notNull().default("bearer"),
  scope: text("scope").notNull(),
  botUserId: text("botUserId"),
  appId: text("appId").notNull(),
  isRevoked: integer("isRevoked", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const slackChannel = sqliteTable("slackChannel", {
  id: text("id").primaryKey(), // Slack channel ID
  teamId: text("teamId")
    .notNull()
    .references(() => slackTeam.id),
  name: text("name").notNull(),
  isPrivate: integer("isPrivate", { mode: "boolean" }).notNull().default(false),
  isArchived: integer("isArchived", { mode: "boolean" })
    .notNull()
    .default(false),
  isSyncEnabled: integer("isSyncEnabled", { mode: "boolean" })
    .notNull()
    .default(false),
  documentLimit: integer("documentLimit").default(1000), // Max documents to sync
  lastSyncAt: integer("lastSyncAt", { mode: "timestamp" }),
  lastMessageTs: text("lastMessageTs"), // Last synced message timestamp
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const slackSyncLog = sqliteTable("slackSyncLog", {
  id: text("id").primaryKey(),
  teamId: text("teamId")
    .notNull()
    .references(() => slackTeam.id),
  channelId: text("channelId").references(() => slackChannel.id),
  messageTs: text("messageTs").notNull(), // Slack message timestamp
  supermemoryId: text("supermemoryId"), // Supermemory document ID
  status: text("status").notNull().default("pending"), // pending, success, failed
  errorMessage: text("errorMessage"),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export const slackBackfill = sqliteTable("slackBackfill", {
  id: text("id").primaryKey(),
  teamId: text("teamId")
    .notNull()
    .references(() => slackTeam.id),
  channelId: text("channelId")
    .notNull()
    .references(() => slackChannel.id),
  status: text("status").notNull().default("pending"), // pending, in_progress, completed, failed
  totalMessages: integer("totalMessages").default(0),
  processedMessages: integer("processedMessages").default(0),
  lastCursor: text("lastCursor"), // For pagination
  startDate: text("startDate"), // ISO date string
  endDate: text("endDate"), // ISO date string
  messageLimit: integer("messageLimit"),
  errorMessage: text("errorMessage"),
  startedAt: integer("startedAt", { mode: "timestamp" }),
  completedAt: integer("completedAt", { mode: "timestamp" }),
  createdAt: integer("createdAt", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updatedAt", { mode: "timestamp" }).notNull(),
});

export type User = typeof user.$inferSelect;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
export type RateLimit = typeof rateLimit.$inferSelect;

// Slack types
export type SlackTeam = typeof slackTeam.$inferSelect;
export type SlackToken = typeof slackToken.$inferSelect;
export type SlackChannel = typeof slackChannel.$inferSelect;
export type SlackSyncLog = typeof slackSyncLog.$inferSelect;
export type SlackBackfill = typeof slackBackfill.$inferSelect;
