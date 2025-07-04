import { Hono } from "hono";
import type { Session, User } from "./db/schema";
import { ratelimiter } from "./middleware/rateLimit";

export const apiRouter = new Hono<{
	Bindings: Env;
	Variables: {
		user: User;
		session: Session;
	};
}>()
	.use(ratelimiter)
	.get("/", (c) => {
		const user = c.get("user");
		return c.json({
			message: "Supermemory Slack Connector API",
			user: user ? { id: user.id, name: user.name } : null,
			timestamp: new Date().toISOString(),
		});
	})
	.get("/status", (c) => {
		return c.json({
			status: "operational",
			service: "slack-connector",
			features: [
				"slack-oauth",
				"message-sync",
				"event-processing",
				"supermemory-integration",
			],
		});
	});
