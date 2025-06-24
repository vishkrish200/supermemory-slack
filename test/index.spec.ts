import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import app from "../src"
import { testClient } from 'hono/testing'

describe('Authentication on /api routes', () => {
	it('should return 401 on protected routes', async () => {
		const client = testClient(app, env)
		const res = await client.api.$get()

    expect(res.status).toBe(401)
	});
});
