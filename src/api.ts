import { Hono } from "hono";
import { ratelimiter } from "./middleware/rateLimit";
import type { User, Session } from "./db/schema";

export const apiRouter = new Hono<{
	Bindings: Env;
	Variables: {
		user: User;
		session: Session;
	};
}>()
.use(ratelimiter)
.get("/", (c) => {
    const user = c.get("user")
    if (!user?.subscriptionId) {
        return c.json({
            error: "Unauthorized, please buy a subscription"
        }, 401)
    }
    return c.json({
        message: "Hello World"
    })
})