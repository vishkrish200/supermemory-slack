import { betterAuth } from "better-auth";
import type { User, Session } from "./db/schema";
import { drizzle } from "drizzle-orm/d1";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import * as schema from "./db/schema";
import { createMiddleware } from "hono/factory";
import { Hono } from "hono";
import { generateKey, decryptKey } from "./utils/key";
import { eq } from "drizzle-orm";

const app = new Hono<{
	Bindings: Env;
	Variables: {
		user: User;
		session: Session;
	};
}>();

export const db = (env: Env) => drizzle(env.USERS_DATABASE);

export const auth = (env: Env) =>
	betterAuth({
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
		socialProviders: {
			github: {
				clientId: env.AUTH_GITHUB_ID,
				clientSecret: env.AUTH_GITHUB_SECRET,
				redirectURI: `${env.BETTER_AUTH_URL}/api/auth/callback/github`,
			},
		},
	});

export const authMiddleware = createMiddleware(async (c, next) => {
	// Check for bearer token
	const authHeader = c.req.header("Authorization");
	if (authHeader?.startsWith("Bearer ")) {
		const token = authHeader.substring(7);
		try {
			const [userId, lastKeyGeneratedAtTimestamp] = await decryptKey(token, c.env.SECRET);
			const user = await db(c.env)
				.select()
				.from(schema.user)
				.where(eq(schema.user.id, userId))
				.get();

			if (user) {
				if (!user.lastKeyGeneratedAt || user.lastKeyGeneratedAt === null) {
					// Update user with current timestamp if no lastKeyGeneratedAt
					const now = new Date();
					await db(c.env)
						.update(schema.user)
						.set({ lastKeyGeneratedAt: now })
						.where(eq(schema.user.id, userId))
						.run();
					user.lastKeyGeneratedAt = now;
				}

				// Convert both timestamps to numbers for comparison
				const storedTimestamp = user.lastKeyGeneratedAt.getTime();
				const providedTimestamp = Number(lastKeyGeneratedAtTimestamp);

				if (storedTimestamp === providedTimestamp) {
					c.set("user", user);
					c.set("session", null);
					await next();
					return;
				}
			}
		} catch (e) {
			console.error("API Key validation failed:", e);
			return c.json({ error: "Invalid API key" }, 401);
		}

		// If we reach here, the API key was invalid
		return c.json({ error: "Invalid API key" }, 401);
	}

	// Fall back to session-based auth
	const session = await auth(c.env).api.getSession({
		headers: c.req.raw.headers,
	});

	if (session?.user) {
		const user = await db(c.env)
			.select()
			.from(schema.user)
			.where(eq(schema.user.id, session.user.id))
			.get();

		if (user && (!user.lastKeyGeneratedAt || user.lastKeyGeneratedAt === null)) {
			// Update user with current timestamp if no lastKeyGeneratedAt
			const now = new Date();
			await db(c.env)
				.update(schema.user)
				.set({ lastKeyGeneratedAt: now })
				.where(eq(schema.user.id, user.id))
				.run();
			user.lastKeyGeneratedAt = now;
		}

		c.set("session", session.session || null);
		c.set("user", user || null);
	}
	await next();
});

export const authRouter = app
	.all("/api/auth/*", (c) => {
		const authHandler = auth(c.env).handler;
		return authHandler(c.req.raw);
	})
	.get("/signout", async (c) => {
		await auth(c.env).api.signOut({
			headers: c.req.raw.headers,
		});
		return c.redirect("/");
	})
	.get("/signin", async (c) => {
		const signinUrl = await auth(c.env).api.signInSocial({
			body: {
				provider: "github",
				callbackURL: "/",
			},
		});

		if (!signinUrl || !signinUrl.url) {
			return c.text("Failed to sign in", 500);
		}

		return c.redirect(signinUrl.url);
	})
	.post("/api/auth/token", async (c) => {
		const user = c.get("user");
		if (!user) {
			return c.json({ error: "Unauthorized" }, 401);
		}

		const lastKeyGeneratedAt = Date.now();
		const token = await generateKey(user.id, String(lastKeyGeneratedAt), c.env.SECRET);

		return c.json({ token });
	});
