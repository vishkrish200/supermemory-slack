#!/usr/bin/env bun

import { text, confirm, select } from "@clack/prompts";
import { readFileSync, writeFileSync, existsSync } from "fs";

interface Config {
  slackClientId?: string;
  slackClientSecret?: string;
  slackSigningSecret?: string;
  supermemoryApiKey?: string;
  supermemoryApiUrl?: string;
  secretKey?: string;
}

async function main() {
  console.log("🚀 Supermemory Slack Connector Setup\n");

  const action = await select({
    message: "What would you like to do?",
    options: [
      { value: "dev", label: "Setup development environment (.dev.vars)" },
      {
        value: "prod",
        label: "Configure production secrets (wrangler secrets)",
      },
      { value: "database", label: "Setup database and KV namespaces" },
      { value: "all", label: "Complete setup (all of the above)" },
    ],
  });

  if (action === "dev" || action === "all") {
    await setupDevelopment();
  }

  if (action === "prod" || action === "all") {
    await setupProduction();
  }

  if (action === "database" || action === "all") {
    await setupDatabase();
  }

  console.log("\n✅ Setup complete! Check docs/DEPLOYMENT.md for next steps.");
}

async function setupDevelopment() {
  console.log("\n📝 Setting up development environment...\n");

  const config: Config = {};

  // Check if .dev.vars already exists
  if (existsSync(".dev.vars")) {
    const overwrite = await confirm({
      message: ".dev.vars already exists. Overwrite it?",
    });
    if (!overwrite) {
      console.log("Skipping development setup.");
      return;
    }
  }

  // Collect configuration
  config.slackClientId = (await text({
    message: "Slack Client ID (from your Slack app):",
    placeholder: "e.g., 1234567890.1234567890",
  })) as string;

  config.slackClientSecret = (await text({
    message: "Slack Client Secret (from your Slack app):",
    placeholder: "e.g., a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  })) as string;

  config.slackSigningSecret = (await text({
    message: "Slack Signing Secret (from your Slack app):",
    placeholder: "e.g., a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0",
  })) as string;

  config.supermemoryApiKey = (await text({
    message: "Supermemory API Key:",
    placeholder: "e.g., sm_1234567890abcdef",
  })) as string;

  config.supermemoryApiUrl = (await text({
    message: "Supermemory API URL:",
    placeholder: "https://api.supermemory.ai",
    defaultValue: "https://api.supermemory.ai",
  })) as string;

  config.secretKey = (await text({
    message: "Encryption secret key (32+ characters):",
    placeholder: "e.g., your-super-secret-encryption-key-here-32chars",
  })) as string;

  // Generate .dev.vars file
  const devVarsContent = `# Better Auth Configuration
AUTH_GITHUB_ID=
AUTH_GITHUB_SECRET=
BETTER_AUTH_URL=http://localhost:8787
SECRET=${config.secretKey}

# Slack App Configuration
SLACK_CLIENT_ID=${config.slackClientId}
SLACK_CLIENT_SECRET=${config.slackClientSecret}
SLACK_SIGNING_SECRET=${config.slackSigningSecret}

# Optional: Slack tokens for testing (usually obtained via OAuth)
SLACK_BOT_TOKEN=
SLACK_USER_TOKEN=

# Supermemory API Configuration
SUPERMEMORY_API_URL=${config.supermemoryApiUrl}
SUPERMEMORY_API_KEY=${config.supermemoryApiKey}
`;

  writeFileSync(".dev.vars", devVarsContent);
  console.log("✅ Created .dev.vars file");
}

async function setupProduction() {
  console.log("\n🔐 Setting up production secrets...\n");

  const useWrangler = await confirm({
    message: "Do you want to set secrets using wrangler now?",
  });

  if (!useWrangler) {
    console.log("Skipping production secrets. You can set them later using:");
    console.log("  wrangler secret put SECRET");
    console.log("  wrangler secret put SLACK_CLIENT_ID");
    console.log("  wrangler secret put SLACK_CLIENT_SECRET");
    console.log("  wrangler secret put SLACK_SIGNING_SECRET");
    console.log("  wrangler secret put SUPERMEMORY_API_KEY");
    return;
  }

  // Set secrets using wrangler
  const { exec } = await import("child_process");
  const { promisify } = await import("util");
  const execAsync = promisify(exec);

  const secrets = [
    "SECRET",
    "SLACK_CLIENT_ID",
    "SLACK_CLIENT_SECRET",
    "SLACK_SIGNING_SECRET",
    "SUPERMEMORY_API_KEY",
  ];

  for (const secret of secrets) {
    const setValue = await confirm({
      message: `Set ${secret} via wrangler?`,
    });

    if (setValue) {
      try {
        console.log(`Setting ${secret}...`);
        await execAsync(`wrangler secret put ${secret}`);
        console.log(`✅ Set ${secret}`);
      } catch (error) {
        console.error(`❌ Failed to set ${secret}:`, error);
      }
    }
  }
}

async function setupDatabase() {
  console.log("\n🗄️ Setting up database and KV namespaces...\n");

  const setupD1 = await confirm({
    message: "Create D1 database? (requires wrangler)",
  });

  if (setupD1) {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      console.log("Creating D1 database...");
      const { stdout } = await execAsync(
        "wrangler d1 create supermemory-slack"
      );
      console.log(stdout);
      console.log("✅ D1 database created");
      console.log(
        "📝 Update the database_id in wrangler.jsonc with the ID shown above"
      );
    } catch (error) {
      console.error("❌ Failed to create D1 database:", error);
    }
  }

  const setupKV = await confirm({
    message: "Create KV namespace for OAuth state? (requires wrangler)",
  });

  if (setupKV) {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      console.log("Creating KV namespace...");
      const { stdout } = await execAsync(
        'wrangler kv:namespace create "STATE_STORE"'
      );
      console.log(stdout);
      console.log("✅ KV namespace created");
      console.log("📝 Update the id in wrangler.jsonc with the ID shown above");
    } catch (error) {
      console.error("❌ Failed to create KV namespace:", error);
    }
  }

  const runMigrations = await confirm({
    message: "Apply database migrations locally?",
  });

  if (runMigrations) {
    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    try {
      console.log("Applying database migrations...");
      await execAsync("wrangler d1 migrations apply supermemory-slack --local");
      console.log("✅ Database migrations applied locally");
    } catch (error) {
      console.error("❌ Failed to apply migrations:", error);
    }
  }
}

// Run the script
main().catch(console.error);
