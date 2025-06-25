#!/usr/bin/env node

/**
 * Generate environment-specific Slack app manifests
 *
 * Usage:
 *   node scripts/generate-manifest.js --env development
 *   node scripts/generate-manifest.js --env staging
 *   node scripts/generate-manifest.js --env production
 *   node scripts/generate-manifest.js --custom-url https://my-custom-domain.com
 */

const fs = require("node:fs");
const path = require("node:path");

// Environment configurations
const environments = {
	development: {
		url: "http://localhost:8787",
		suffix: "-dev",
	},
	staging: {
		url: "https://slack-staging.supermemory.ai",
		suffix: "-staging",
	},
	production: {
		url: "https://slack.supermemory.ai",
		suffix: "-prod",
	},
};

function generateManifest(environment, customUrl = null) {
	const templatePath = path.join(__dirname, "..", "slack-app-manifest.yaml");
	const template = fs.readFileSync(templatePath, "utf8");

	// Determine the URL to use
	const workerUrl = customUrl || environments[environment]?.url;

	if (!workerUrl) {
		console.error(`❌ Invalid environment: ${environment}`);
		console.error("Valid environments: development, staging, production");
		process.exit(1);
	}

	// Replace the placeholder with actual URL
	const manifest = template.replace(/\{\{WORKER_URL\}\}/g, workerUrl);

	// Generate output filename
	const suffix = customUrl
		? "-custom"
		: environments[environment]?.suffix || "";
	const outputPath = path.join(
		__dirname,
		"..",
		`slack-app-manifest${suffix}.yaml`,
	);

	// Write the generated manifest
	fs.writeFileSync(outputPath, manifest);

	console.log(`✅ Generated Slack app manifest: ${outputPath}`);
	console.log(`🔗 Worker URL: ${workerUrl}`);

	// Display next steps
	console.log("\n📋 Next steps:");
	console.log("1. Go to https://api.slack.com/apps");
	console.log('2. Click "Create New App"');
	console.log('3. Select "From an app manifest"');
	console.log("4. Choose your workspace");
	console.log(`5. Upload the generated file: ${path.basename(outputPath)}`);
	console.log("6. Review and create your app");
	console.log("7. Configure secrets using the setup guide");

	return outputPath;
}

// Parse command line arguments
const args = process.argv.slice(2);
let environment = null;
let customUrl = null;

for (let i = 0; i < args.length; i++) {
	const arg = args[i];

	if (arg === "--env" && i + 1 < args.length) {
		environment = args[i + 1];
		i++; // Skip next argument as it's the value
	} else if (arg === "--custom-url" && i + 1 < args.length) {
		customUrl = args[i + 1];
		i++; // Skip next argument as it's the value
	} else if (arg === "--help" || arg === "-h") {
		console.log(`
🚀 Slack App Manifest Generator

Generate environment-specific Slack app manifests for the Supermemory Connector.

Usage:
  node scripts/generate-manifest.js --env <environment>
  node scripts/generate-manifest.js --custom-url <url>

Environments:
  development    Generate manifest for local development (localhost:8787)
  staging        Generate manifest for staging (slack-staging.supermemory.ai)
  production     Generate manifest for production (slack.supermemory.ai)

Options:
  --env <env>           Environment to generate manifest for
  --custom-url <url>    Use a custom URL instead of predefined environments
  --help, -h            Show this help message

Examples:
  node scripts/generate-manifest.js --env development
  node scripts/generate-manifest.js --env production
  node scripts/generate-manifest.js --custom-url https://my-domain.com

The generated manifest can be imported directly into Slack's app creation flow.
    `);
		process.exit(0);
	}
}

// Validate arguments
if (!environment && !customUrl) {
	console.error(
		"❌ Missing required argument. Use --env <environment> or --custom-url <url>",
	);
	console.error("Run with --help for usage information.");
	process.exit(1);
}

// Generate the manifest
try {
	generateManifest(environment, customUrl);
} catch (error) {
	console.error("❌ Error generating manifest:", error.message);
	process.exit(1);
}
