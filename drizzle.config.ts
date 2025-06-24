import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';
import { execSync } from 'child_process';

declare global {
	interface Process {
	  env: {
		DATABASE_ID: string;
		ACCOUNT_ID: string;
        TOKEN: string;
        NODE_ENV: string;
	  }
	}
  
  var process: Process;
}

const getSqlitePath = () => {
  try {
    return execSync('find .wrangler/state/v3/d1/miniflare-D1DatabaseObject -type f -name "*.sqlite" -print -quit', { encoding: 'utf-8' }).trim();
  } catch (_e) {
    console.error('Failed to find SQLite database file');
    return '';
  }
};

const cloudflareConfig = defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.ACCOUNT_ID,
    databaseId: process.env.DATABASE_ID,
    token: process.env.TOKEN,
  },
});

const localConfig = defineConfig({
  out: './drizzle',
  schema: './src/db/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: `file:${getSqlitePath()}`,
  },
});

const config = process.env.NODE_ENV === "production" ? cloudflareConfig : localConfig;
console.log(`Using ${process.env.NODE_ENV === "production" ? "cloudflare" : "local"} config`);
export default config;