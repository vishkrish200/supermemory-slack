import { Hono } from "hono";
import { apiRouter } from "./api";
import { authMiddleware, authRouter } from "./auth";
import type { Session, User } from "./db/schema";
import { slackRouter } from "./slack";

const app = new Hono<{
	Bindings: Env;
	Variables: {
		user: User;
		session: Session;
	};
}>()
	.use(authMiddleware)
	// auth routes for OAuth
	.route("/auth", authRouter)
	// api routes
	.route("/api", apiRouter)
	// slack integration routes
	.route("/slack", slackRouter)
	// health check endpoint
	.get("/", async (c) => {
		return c.json({
			status: "ok",
			service: "supermemory-slack-connector",
			version: "1.0.0",
		});
	});

export default app;
