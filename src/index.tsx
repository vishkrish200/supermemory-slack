import { Hono } from "hono";
import { authMiddleware, authRouter } from "./auth";
import type { User, Session } from "./db/schema";
import { apiRouter } from "./api";

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
  // health check endpoint
  .get("/", async (c) => {
    return c.json({
      status: "ok",
      service: "supermemory-slack-connector",
      version: "1.0.0",
    });
  })
  // Slack webhook endpoints will be added here
  .post("/slack/events", async (c) => {
    // TODO: Implement Slack event handler
    return c.json({ message: "Slack events endpoint - coming soon" });
  })
  .get("/slack/oauth", async (c) => {
    // TODO: Implement Slack OAuth handler
    return c.json({ message: "Slack OAuth endpoint - coming soon" });
  });

export default app;
