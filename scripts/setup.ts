import { execSync } from "node:child_process";
import crypto from "node:crypto";
import { default as fs } from "node:fs";
import os from "node:os";
import { default as path } from "node:path";
import { cancel, intro, outro, select, spinner, text } from "@clack/prompts";

interface CommandError {
	stdout?: string;
	stderr?: string;
}

// Function to get current working directory
function getCurrentDirectory(): string {
	return execSync("pwd", { encoding: "utf-8" }).trim();
}

// Function to execute shell commands
function executeCommand(
	command: string,
): string | { error: true; message: string } {
	console.log(`\x1b[33m${command}\x1b[0m`);
	try {
		return execSync(command, { encoding: "utf-8" });
	} catch (error) {
		const err = error as CommandError;
		return {
			error: true,
			message: err.stdout || err.stderr || "Unknown error",
		};
	}
}

// Function to prompt user for input without readline-sync
async function prompt(message: string, defaultValue: string): Promise<string> {
	return (await text({
		message: `${message} (${defaultValue}):`,
		placeholder: defaultValue,
		defaultValue,
	})) as string;
}

// Function to extract account IDs from `wrangler whoami` output
function extractAccountDetails(output: string): { name: string; id: string }[] {
	const lines = output.split("\n");
	const accountDetails: { name: string; id: string }[] = [];

	for (const line of lines) {
		const isValidLine =
			line.trim().startsWith("│ ") && line.trim().endsWith(" │");

		if (isValidLine) {
			const regex = /\b[a-f0-9]{32}\b/g;
			const matches = line.match(regex);

			if (matches && matches.length === 1) {
				const accountName = line.split("│ ")[1]?.trim();
				const accountId = matches[0].replace("│ ", "").replace(" │", "");
				if (accountName === undefined || accountId === undefined) {
					console.error(
						"\x1b[31mError extracting account details from wrangler whoami output.\x1b[0m",
					);
					cancel("Operation cancelled.");
					throw new Error("Failed to extract account details");
				}
				accountDetails.push({ name: accountName, id: accountId });
			}
		}
	}

	return accountDetails;
}

// Function to prompt for account ID if there are multiple accounts
async function promptForAccountId(
	accounts: { name: string; id: string }[],
): Promise<string> {
	if (accounts.length === 1) {
		if (!accounts[0]) {
			console.error(
				"\x1b[31mNo accounts found. Please run `wrangler login`.\x1b[0m",
			);
			cancel("Operation cancelled.");
			throw new Error("No accounts found");
		}
		if (!accounts[0].id) {
			console.error(
				"\x1b[31mNo accounts found. Please run `wrangler login`.\x1b[0m",
			);
			cancel("Operation cancelled.");
			throw new Error("No account ID found");
		}
		return accounts[0].id;
	}

	if (accounts.length > 1) {
		const options = accounts.map((account) => ({
			value: account.id,
			label: account.name,
		}));
		const selectedAccountId = await select({
			message: "Select an account to use:",
			options,
		});

		if (!selectedAccountId) {
			throw new Error("No account selected");
		}

		return selectedAccountId as string;
	}

	console.error(
		"\x1b[31mNo accounts found. Please run `wrangler login`.\x1b[0m",
	);
	cancel("Operation cancelled.");
	throw new Error("No accounts found");
}

let dbName: string;

interface WranglerConfig {
	name?: string;
	main?: string;
	compatibility_date?: string;
	compatibility_flags?: string[];
	d1_databases?: Array<{
		binding: string;
		database_name: string;
		database_id: string;
		migrations_dir: string;
	}>;
}

// Function to create database and update wrangler.jsonc
async function createDatabaseAndConfigure() {
	intro(`Let's set up your database...`);
	const defaultDBName = `${path.basename(getCurrentDirectory())}-db`;
	dbName = await prompt("Enter the name of your database", defaultDBName);

	let databaseID: string | undefined;

	const wranglerJsoncPath = path.join(__dirname, "..", "wrangler.jsonc");
	let wranglerConfig: WranglerConfig;

	try {
		const wranglerJsoncContent = fs.readFileSync(wranglerJsoncPath, "utf-8");
		wranglerConfig = JSON.parse(wranglerJsoncContent);
	} catch (error) {
		console.error("\x1b[31mError reading wrangler.jsonc:", error, "\x1b[0m");
		cancel("Operation cancelled.");
		throw error;
	}

	// Run command to create a new database
	const creationOutput = executeCommand(`bunx wrangler d1 create ${dbName}`);

	if (creationOutput === undefined || typeof creationOutput !== "string") {
		console.log(
			"\x1b[33mDatabase creation failed, maybe you have already created a database with that name. I'll try to find the database ID for you.\x1b[0m",
		);
		const dbInfoOutput = executeCommand(`bunx wrangler d1 info ${dbName}`);
		if (typeof dbInfoOutput === "string") {
			const getInfo = dbInfoOutput.match(
				/│ [0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12} │/i,
			);
			if (getInfo && getInfo.length === 1) {
				console.log(
					"\x1b[33mFound it! The database ID is: ",
					getInfo[0],
					"\x1b[0m",
				);
				databaseID = getInfo[0].replace("│ ", "").replace(" │", "");
			}
		}

		if (!databaseID) {
			console.error(
				"\x1b[31mSomething went wrong when initialising the database. Please try again.\x1b[0m",
			);
			cancel("Operation cancelled.");
			throw new Error("Failed to get database ID");
		}
	} else {
		// Extract database ID from the output
		const matchResult = creationOutput.match(/database_id = "(.*)"/);
		if (matchResult?.[1]) {
			databaseID = matchResult[1];
		} else {
			console.error("Failed to extract database ID from the output.");
			cancel("Operation cancelled.");
			throw new Error("Failed to extract database ID");
		}
	}

	// Update wrangler.jsonc with database configuration
	wranglerConfig.d1_databases = [
		{
			binding: "USERS_DATABASE",
			database_name: dbName,
			database_id: databaseID,
			migrations_dir: "./drizzle",
		},
	];

	try {
		const updatedJsonc = JSON.stringify(wranglerConfig, null, 2);
		fs.writeFileSync(wranglerJsoncPath, updatedJsonc);
		console.log(
			"\x1b[33mDatabase configuration updated in wrangler.jsonc\x1b[0m",
		);
	} catch (error) {
		console.error("\x1b[31mError updating wrangler.jsonc:", error, "\x1b[0m");
		cancel("Operation cancelled.");
		throw error;
	}

	outro("Database configuration completed.");
}

// Function to prompt for environment variables
async function promptForEnvVars() {
	intro("Setting up environment variables...");

	const devVarsPath = path.join(__dirname, "..", ".dev.vars");
	const _devVarsExamplePath = path.join(__dirname, "..", ".dev.vars.example");

	if (!fs.existsSync(devVarsPath)) {
		console.log("\x1b[33mNow, let's set up your environment variables.\x1b[0m");

		const vars = {
			AUTH_GITHUB_ID: await prompt(
				"Enter your GitHub Client ID (enter to skip)",
				"",
			),
			AUTH_GITHUB_SECRET: await prompt(
				"Enter your GitHub Client Secret (enter to skip)",
				"",
			),
			BETTER_AUTH_URL: await prompt(
				"Enter your Better Auth URL",
				"http://localhost:8787",
			),
			SECRET: generateSecureRandomString(32),
			LEMONSQUEEZY_CHECKOUT_LINK: await prompt(
				"Enter your Lemonsqueezy Checkout Link (enter to skip)",
				"",
			),
		};

		try {
			const envContent = Object.entries(vars)
				.map(([key, value]) => `${key}=${value}`)
				.join("\n");
			fs.writeFileSync(devVarsPath, `${envContent}\n`);
			console.log(
				"\x1b[33m.dev.vars file created with environment variables.\x1b[0m",
			);
		} catch (error) {
			console.error("\x1b[31mError creating .dev.vars file:", error, "\x1b[0m");
			cancel("Operation cancelled.");
			throw error;
		}
	} else {
		console.log(
			"\x1b[31m.dev.vars file already exists. Skipping creation.\x1b[0m",
		);
	}

	outro("Environment variables setup completed.");
}

// Function to generate secure random string
function generateSecureRandomString(length: number): string {
	return crypto
		.randomBytes(Math.ceil(length / 2))
		.toString("hex")
		.slice(0, length);
}

// Function to run database migrations
async function runDatabaseMigrations(dbName: string) {
	const setupMigrationSpinner = spinner();
	setupMigrationSpinner.start("Generating setup migration...");
	executeCommand("bunx drizzle-kit generate --name setup");
	setupMigrationSpinner.stop("Setup migration generated.");

	const localMigrationSpinner = spinner();
	localMigrationSpinner.start("Running local database migrations...");
	executeCommand(`bunx wrangler d1 migrations apply ${dbName}`);
	localMigrationSpinner.stop("Local database migrations completed.");

	const remoteMigrationSpinner = spinner();
	remoteMigrationSpinner.start("Running remote database migrations...");
	executeCommand(`bunx wrangler d1 migrations apply ${dbName} --remote`);
	remoteMigrationSpinner.stop("Remote database migrations completed.");
}

// Function to deploy worker
async function deployWorker() {
	const shouldDeploy = await select({
		message: "Would you like to deploy the worker now?",
		options: [
			{ value: "yes", label: "Yes" },
			{ value: "no", label: "No" },
		],
	});

	if (shouldDeploy === "yes") {
		console.log("\x1b[33mDeploying worker...\x1b[0m");
		executeCommand("bunx wrangler deploy");
		console.log("\x1b[32mWorker deployed successfully!\x1b[0m");
	}
}

function setEnvironmentVariable(name: string, value: string): never {
	const platform = os.platform();
	const command =
		platform === "win32"
			? `set ${name}=${value}` // Windows Command Prompt
			: `export ${name}=${value}`; // Unix-like shells

	console.log(
		`\x1b[33mPlease run this command: ${command} and then rerun the setup script.\x1b[0m`,
	);
	throw new Error("Environment variable needs to be set");
}

async function main() {
	try {
		const whoamiOutput = executeCommand("wrangler whoami");
		if (whoamiOutput === undefined || typeof whoamiOutput !== "string") {
			console.error(
				"\x1b[31mError running wrangler whoami. Please run `wrangler login`.\x1b[0m",
			);
			cancel("Operation cancelled.");
			throw new Error("Failed to run wrangler whoami");
		}

		try {
			await createDatabaseAndConfigure();
		} catch (error) {
			console.error("\x1b[31mError:", error, "\x1b[0m");
			const accountIds = extractAccountDetails(whoamiOutput);
			const accountId = await promptForAccountId(accountIds);
			setEnvironmentVariable("CLOUDFLARE_ACCOUNT_ID", accountId);
		}

		await promptForEnvVars();
		await runDatabaseMigrations(dbName);
		await deployWorker();

		console.log("\x1b[32mSetup completed successfully!\x1b[0m");
		console.log(
			"\x1b[33mYou can now run 'bun run dev' to start the development server.\x1b[0m",
		);
	} catch (error) {
		console.error("\x1b[31mError:", error, "\x1b[0m");
		cancel("Operation cancelled.");
		throw error;
	}
}

main().catch(() => {
	// Exit with error code
	// @ts-expect-error
	process.exit(1);
});
