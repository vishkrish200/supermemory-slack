import { env } from "cloudflare:test";
import { testClient } from "hono/testing";
import { describe, expect, it } from "vitest";
import app from "../src";

describe("Authentication on /api routes", () => {
	it("should return 401 on protected routes", async () => {
		const client = testClient(app, env);
		const res = await client.api.$get();

		expect(res.status).toBe(401);
	});
});
