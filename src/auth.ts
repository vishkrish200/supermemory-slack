import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { Session, User } from "./db/schema";
import * as schema from "./db/schema";
import { decryptKey, generateKey } from "./utils/key";

const app = new Hono<{
  Bindings: Env;
  Variables: {
    user: User;
    session: Session;
  };
}>();

export const db = (env: Env) => drizzle(env.USERS_DATABASE);

export const auth = (env: Env) => {
  return betterAuth({
    database: drizzleAdapter(drizzle(env.USERS_DATABASE), {
      provider: "sqlite",
      schema: {
        account: schema.account,
        session: schema.session,
        user: schema.user,
        verification: schema.verification,
      },
    }),
    secret: env.SECRET,
    // Temporarily disable social providers to get server working
    // socialProviders: {},
  });
};

export const authMiddleware = createMiddleware(async (c, next) => {
  // Simplified auth middleware - skip session checking for now
  c.set("session", null);
  c.set("user", null);
  await next();
});

export const authRouter = app.get("/health", async (c) => {
  return c.json({
    status: "ok",
    service: "auth-service",
    timestamp: new Date().toISOString(),
  });
});
