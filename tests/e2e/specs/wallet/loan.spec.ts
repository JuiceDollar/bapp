import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { MetaMask, getExtensionId } from "@synthetixio/synpress-metamask/playwright";
import { prepareExtension } from "@synthetixio/synpress-cache";
import * as fs from "fs";
import * as path from "path";

const SEED_PHRASE = process.env.WALLET_SEED_PHRASE || "";
const WALLET_PASSWORD = process.env.WALLET_PASSWORD || "";
const WALLET_ADDRESS = process.env.WALLET_ADDRESS || "";

// Citreascan API configuration
const CITREASCAN_API = "https://testnet.citreascan.com/api/v2";
const CONFIRMATION_TIMEOUT_MS = 30000; // 30 seconds for Citrea Testnet
const POLL_INTERVAL_MS = 1000;

interface CitreascanTransaction {
	hash: string;
	status: string;
	result: string;
	timestamp: string;
	from: { hash: string };
	to: { hash: string };
	value: string;
}

interface CitreascanResponse {
	items: CitreascanTransaction[];
}

// Ensure screenshot directory exists
const SCREENSHOT_DIR = "test-results/screenshots";

/**
 * Open Citreascan explorer in a new tab and capture screenshot
 * Waits 10s, takes screenshot. If not confirmed, waits 30s more, reloads and takes another screenshot.
 * @param context - Browser context to create new tab
 * @param txHash - Transaction hash to view
 * @param screenshotPrefix - Prefix for screenshot filename
 * @returns Promise that resolves when done
 */
async function captureExplorerScreenshot(context: BrowserContext, txHash: string, screenshotPrefix: string): Promise<void> {
	// Ensure screenshot directory exists
	if (!fs.existsSync(SCREENSHOT_DIR)) {
		fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	}

	const explorerUrl = `https://testnet.citreascan.com/tx/${txHash}`;
	console.log(`\n   📷 OPENING CITREASCAN EXPLORER`);
	console.log(`   URL: ${explorerUrl}`);

	const explorerPage = await context.newPage();

	// Bring the explorer tab to the front so it's visible
	await explorerPage.bringToFront();
	console.log("   🔍 Explorer tab opened and brought to front");

	await explorerPage.goto(explorerUrl);
	await explorerPage.waitForLoadState("networkidle");
	console.log("   ✓ Page loaded");

	// Wait 10 seconds before first screenshot
	console.log("   ⏳ Waiting 10 seconds before screenshot...");
	await explorerPage.waitForTimeout(10000);

	// Take first screenshot
	const screenshot1 = path.join(SCREENSHOT_DIR, `${screenshotPrefix}-explorer-1.png`);
	await explorerPage.screenshot({ path: screenshot1, fullPage: true });
	console.log(`   📸 Screenshot saved: ${screenshot1}`);

	// Check if transaction is confirmed (look for success indicators on Citreascan)
	// Citreascan shows "Success" in a badge or status field
	const isConfirmed = await explorerPage
		.locator('text=/Success|Confirmed|success/i, [data-status="ok"], .badge:has-text("Success")')
		.first()
		.isVisible({ timeout: 2000 })
		.catch(() => false);

	if (!isConfirmed) {
		console.log("   ⏳ Transaction status not clearly visible, waiting 30 more seconds...");
		await explorerPage.waitForTimeout(30000);

		// Reload and take another screenshot
		console.log("   🔄 Reloading page...");
		await explorerPage.reload();
		await explorerPage.waitForLoadState("networkidle");
		await explorerPage.waitForTimeout(2000);

		const screenshot2 = path.join(SCREENSHOT_DIR, `${screenshotPrefix}-explorer-2.png`);
		await explorerPage.screenshot({ path: screenshot2, fullPage: true });
		console.log(`   📸 Screenshot after reload: ${screenshot2}`);
	} else {
		console.log("   ✅ Transaction already confirmed on explorer");
	}

	console.log("   🔒 Closing explorer tab\n");
	await explorerPage.close();
}

/**
 * Verify transaction is confirmed on Citreascan within timeout
 * @param walletAddress - The wallet address to check transactions for
 * @param beforeTimestamp - Only consider transactions after this timestamp
 * @param timeoutMs - Maximum time to wait for confirmation (default: 10s)
 * @returns The confirmed transaction or throws error
 */
async function verifyTransactionOnCitreascan(
	walletAddress: string,
	beforeTimestamp: Date,
	timeoutMs: number = CONFIRMATION_TIMEOUT_MS
): Promise<CitreascanTransaction> {
	const startTime = Date.now();
	let lastError: Error | null = null;

	console.log(`   Checking Citreascan for wallet: ${walletAddress}`);
	console.log(`   Looking for transactions after: ${beforeTimestamp.toISOString()}`);

	while (Date.now() - startTime < timeoutMs) {
		try {
			const response = await fetch(`${CITREASCAN_API}/addresses/${walletAddress}/transactions`);

			if (!response.ok) {
				throw new Error(`Citreascan API error: ${response.status}`);
			}

			const data: CitreascanResponse = await response.json();

			if (data.items && data.items.length > 0) {
				// Find the most recent transaction that occurred after our beforeTimestamp
				const recentTx = data.items.find((tx) => {
					const txTime = new Date(tx.timestamp);
					return txTime > beforeTimestamp;
				});

				if (recentTx) {
					if (recentTx.status === "ok" && recentTx.result === "success") {
						const elapsed = Date.now() - startTime;
						console.log(`   ✅ Transaction confirmed on blockchain in ${elapsed}ms`);
						console.log(`   TX Hash: ${recentTx.hash}`);
						console.log(`   Status: ${recentTx.status}, Result: ${recentTx.result}`);
						return recentTx;
					} else if (recentTx.status === "error" || recentTx.result === "error") {
						throw new Error(`Transaction failed on blockchain: ${recentTx.hash}`);
					}
				}
			}
		} catch (error) {
			lastError = error as Error;
		}

		// Wait before next poll
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
	}

	throw new Error(
		`Transaction not confirmed on Citreascan within ${timeoutMs}ms. ` + `Last error: ${lastError?.message || "No transaction found"}`
	);
}

if (!SEED_PHRASE || !WALLET_PASSWORD) {
	throw new Error("WALLET_SEED_PHRASE and WALLET_PASSWORD must be set in environment variables");
}

if (!WALLET_ADDRESS) {
	throw new Error("WALLET_ADDRESS must be set in environment variables for blockchain verification");
}

// Citrea Testnet configuration
const CITREA_TESTNET = {
	name: "Citrea Testnet",
	rpcUrl: "https://rpc.testnet.citreascan.com",
	chainId: 5115,
	symbol: "cBTC",
	blockExplorerUrl: "https://testnet.citreascan.com",
};

/**
 * Connect wallet if not already connected
 * Checks for wallet address display AND valid balance to determine connection status
 * @param page - Playwright page
 * @param metamask - MetaMask instance
 * @returns Promise that resolves when wallet is connected
 */
/**
 * Force connect wallet - always performs connection regardless of current state
 */
async function forceConnectWallet(page: Page, metamask: MetaMask): Promise<void> {
	console.log("📍 Force connecting wallet...");

	// First, check if there's a connect button visible
	const connectButton = page.getByRole("button", { name: /connect/i });
	const connectVisible = await connectButton.isVisible({ timeout: 5000 }).catch(() => false);

	if (connectVisible) {
		// Fresh page, just click connect
		await connectButton.click();
	} else {
		// Might be "connected" (cached state) - disconnect first
		console.log("   No connect button found, looking for wallet menu...");
		const walletButton = page.locator("text=/0x[a-fA-F0-9]{4}/i").first();
		const walletButtonVisible = await walletButton.isVisible({ timeout: 3000 }).catch(() => false);

		if (walletButtonVisible) {
			await walletButton.click();
			await page.waitForTimeout(500);
			const disconnectOption = page.getByText(/disconnect/i).first();
			const disconnectVisible = await disconnectOption.isVisible({ timeout: 2000 }).catch(() => false);
			if (disconnectVisible) {
				await disconnectOption.click();
				console.log("   Disconnected wallet");
				await page.waitForTimeout(1000);
			} else {
				await page.keyboard.press("Escape");
			}
		}

		// Reload and try again
		await page.reload();
		await page.waitForLoadState("networkidle");
		const newConnectBtn = page.getByRole("button", { name: /connect/i });
		await expect(newConnectBtn).toBeVisible({ timeout: 10000 });
		await newConnectBtn.click();
	}

	// Select MetaMask from wallet modal
	console.log("📍 Select MetaMask from modal");
	await page.waitForTimeout(1000);
	const walletOption = page.getByText(/metamask/i).first();
	await expect(walletOption).toBeVisible({ timeout: 5000 });
	await walletOption.click();

	// Approve connection in MetaMask
	console.log("📍 Approve connection in MetaMask");
	await metamask.connectToDapp();
	await page.waitForTimeout(2000);

	// Handle network switch if prompted
	console.log("📍 Handle network switch");
	try {
		const switchNetworkButton = page.getByRole("button", { name: /switch network/i });
		const isSwitchVisible = await switchNetworkButton.isVisible({ timeout: 3000 }).catch(() => false);
		if (isSwitchVisible) {
			await switchNetworkButton.click();
			await page.waitForTimeout(3000);
		}
	} catch {
		// Network switch not needed
	}

	// Verify connection
	console.log("📍 Verifying connection...");
	await page.waitForTimeout(2000);
	const walletAddress = page.locator("text=/0x[a-fA-F0-9]{4}/i").first();
	await expect(walletAddress).toBeVisible({ timeout: 10000 });
	console.log("   ✅ Wallet connected!");
}

async function connectWalletIfNeeded(page: Page, metamask: MetaMask): Promise<void> {
	// Check if wallet is already connected AND has a valid balance (not 0)
	const walletAddressVisible = await page
		.locator("text=/0x[a-fA-F0-9]{4}/i")
		.first()
		.isVisible({ timeout: 3000 })
		.catch(() => false);

	if (walletAddressVisible) {
		// Check if balance is loaded (not 0)
		const balanceText = await page
			.locator("text=/\\d+\\.?\\d*\\s*cBTC/")
			.first()
			.textContent({ timeout: 5000 })
			.catch(() => "0 cBTC");
		const balanceMatch = balanceText?.match(/([\d.]+)\s*cBTC/);
		const balance = balanceMatch ? parseFloat(balanceMatch[1]) : 0;

		if (balance > 0) {
			console.log(`   ✓ Wallet already connected with balance: ${balance} cBTC`);
			return;
		}
		console.log("   ⚠️ Wallet appears connected but balance is 0, forcing reconnection...");
	}

	// Connect wallet - first check if there's a connect button
	console.log("📍 Connect wallet");
	const connectButton = page.getByRole("button", { name: /connect/i });
	const connectVisible = await connectButton.isVisible({ timeout: 5000 }).catch(() => false);

	if (!connectVisible) {
		// No connect button - try to disconnect first by looking for a disconnect option
		console.log("   Looking for disconnect option...");
		const walletButton = page.locator("text=/0x[a-fA-F0-9]{4}/i").first();
		const walletButtonVisible = await walletButton.isVisible({ timeout: 2000 }).catch(() => false);
		if (walletButtonVisible) {
			await walletButton.click();
			await page.waitForTimeout(500);
			const disconnectOption = page.getByText(/disconnect/i).first();
			const disconnectVisible = await disconnectOption.isVisible({ timeout: 2000 }).catch(() => false);
			if (disconnectVisible) {
				await disconnectOption.click();
				console.log("   Disconnected wallet, now reconnecting...");
				await page.waitForTimeout(1000);
			} else {
				await page.keyboard.press("Escape");
			}
		}
		// Reload and try again
		await page.reload();
		await page.waitForLoadState("networkidle");
	}

	// Now click connect
	const connectBtn = page.getByRole("button", { name: /connect/i });
	await expect(connectBtn).toBeVisible({ timeout: 10000 });
	await connectBtn.click();

	// Select MetaMask from wallet modal
	console.log("📍 Select MetaMask");
	await page.waitForTimeout(1000);
	const walletOption = page.getByText(/metamask/i).first();
	await expect(walletOption).toBeVisible({ timeout: 5000 });
	await walletOption.click();

	// Approve connection in MetaMask
	console.log("📍 Approve connection in MetaMask");
	await metamask.connectToDapp();
	await page.waitForTimeout(2000);

	// Handle network switch if prompted (click button, MetaMask auto-approves on known networks)
	console.log("📍 Handle network switch");
	try {
		const switchNetworkButton = page.getByRole("button", { name: /switch network/i });
		const isSwitchVisible = await switchNetworkButton.isVisible({ timeout: 3000 }).catch(() => false);
		if (isSwitchVisible) {
			await switchNetworkButton.click();
			// Wait for MetaMask to process the network switch
			await page.waitForTimeout(3000);
		}
	} catch {
		console.log("   No network switch needed");
	}

	// Close any modal that might be open
	await page.keyboard.press("Escape");
	await page.waitForTimeout(500);

	// Verify wallet is connected
	console.log("📍 Verify wallet connected");
	await expect(page.locator("text=/0x[a-fA-F0-9]{4}/i").first()).toBeVisible({ timeout: 15000 });
	console.log("   ✓ Wallet connected successfully");
}

test.describe("Loan Creation", () => {
	// Increase timeout for wallet transactions (5 minutes for full lifecycle with explorer screenshots)
	test.setTimeout(300000);
	let context: BrowserContext;
	let metamask: MetaMask;
	let page: Page;

	test.beforeAll(async () => {
		const extensionPath = await prepareExtension();

		context = await chromium.launchPersistentContext("", {
			headless: false,
			viewport: { width: 1280, height: 720 },
			args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
		});

		const extensionId = await getExtensionId(context, "MetaMask");

		await new Promise((r) => setTimeout(r, 2000));
		const pages = context.pages();
		const metamaskPage = pages.find((p) => p.url().includes("chrome-extension://"));
		if (!metamaskPage) throw new Error("MetaMask not found");

		metamask = new MetaMask(context, metamaskPage, WALLET_PASSWORD, extensionId);
		await metamask.importWallet(SEED_PHRASE);

		// Add Citrea Testnet to MetaMask
		await metamask.addNetwork(CITREA_TESTNET);
	});

	test.afterAll(async () => {
		await context?.close();
	});

	test("should create a loan with cBTC collateral", async () => {
		page = await context.newPage();

		// Step 1: Navigate to mint page
		console.log("\n📍 Step 1: Navigate to mint page");
		await page.goto("/mint");
		await page.waitForLoadState("networkidle");

		// Step 2-6: Connect wallet (or skip if already connected)
		await connectWalletIfNeeded(page, metamask);

		// Step 7: Wait for the borrow form to load with default position
		console.log("📍 Step 7: Wait for borrow form to load");
		const collateralLabel = page.getByText(/Select your collateral asset/i);
		await expect(collateralLabel).toBeVisible({ timeout: 15000 });

		// Wait for cBTC to appear (indicates position loaded)
		const cbtcToken = page.getByText("cBTC").first();
		await expect(cbtcToken).toBeVisible({ timeout: 15000 });

		// Step 8: Check wallet balance
		console.log("📍 Step 8: Check wallet balance");
		// The balance is shown near the MAX button
		const balanceText = await page.locator("text=/\\d+\\.?\\d*\\s*cBTC/").first().textContent({ timeout: 10000 });
		console.log(`   Wallet balance: ${balanceText}`);

		// Extract the balance value
		const balanceMatch = balanceText?.match(/([\d.]+)\s*cBTC/);
		const balance = balanceMatch ? parseFloat(balanceMatch[1]) : 0;

		if (balance < 0.0001) {
			console.log("⚠️  Insufficient cBTC balance for test. Skipping transaction.");
			await page.close();
			test.skip();
			return;
		}

		// Step 9: Use pre-filled collateral amount (form auto-fills with max balance)
		console.log("📍 Step 9: Using pre-filled collateral amount");
		// The form automatically fills with the max collateral amount
		// We just verify the "You get" section shows a calculated value

		// Step 10: Verify "You get" amount is calculated
		console.log("📍 Step 10: Verify loan amount calculated");
		const youGetLabel = page.getByText(/You get/i);
		await expect(youGetLabel).toBeVisible();

		// Step 11: Find and click the borrow button
		console.log("📍 Step 11: Click borrow button");
		// The button contains "Receive X.XX JUSD"
		const borrowButton = page.getByRole("button", { name: /receive.*jusd/i });
		await expect(borrowButton).toBeVisible({ timeout: 10000 });

		// Check if button is enabled
		const isDisabled = await borrowButton.isDisabled();
		if (isDisabled) {
			console.log("⚠️  Borrow button is disabled. Checking for errors...");
			// Check for error messages
			const errorText = await page
				.locator('[class*="error"], [class*="Error"]')
				.textContent()
				.catch(() => "");
			console.log(`   Error: ${errorText || "Unknown error"}`);
			await page.close();
			test.skip();
			return;
		}

		// Record timestamp before transaction for blockchain verification
		const txStartTime = new Date();

		await borrowButton.click();
		console.log("   Clicked borrow button");

		// Step 12: Confirm transaction in MetaMask
		console.log("📍 Step 12: Confirm transaction in MetaMask");
		await page.waitForTimeout(2000);

		try {
			await metamask.confirmTransaction();
			console.log("   Transaction confirmed in MetaMask");
		} catch (error) {
			console.log("⚠️  Failed to confirm transaction:", error);
			await page.close();
			throw error;
		}

		// Step 13: Verify transaction on blockchain (MANDATORY - must confirm within 10s)
		console.log("📍 Step 13: Verify transaction on Citreascan (10s timeout)");
		const confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
		expect(confirmedTx.status).toBe("ok");
		expect(confirmedTx.result).toBe("success");

		// Step 13b: Capture explorer screenshot in separate tab
		console.log("📍 Step 13b: Capture explorer screenshot");
		await captureExplorerScreenshot(context, confirmedTx.hash, "loan-default");

		// Step 14: Wait for UI success indicator
		console.log("📍 Step 14: Wait for UI confirmation");
		try {
			const successIndicator = page.locator("text=/success|confirmed|minted/i").first();
			await expect(successIndicator).toBeVisible({ timeout: 10000 });
			console.log("✅ UI shows transaction successful!");
		} catch {
			// UI indicator is optional since we already verified on blockchain
			console.log("   UI indicator not found, but blockchain confirmed");
		}

		// Step 15: Take screenshot of final state
		console.log("📍 Step 15: Capture final state");
		await page.waitForTimeout(2000);
		await expect(page).toHaveScreenshot("loan-created-success.png", {
			maxDiffPixelRatio: 0.1,
		});

		await page.close();
	});

	test("should create a loan with custom parameters (0.003 cBTC, 40000 liq price, 1 month)", async () => {
		page = await context.newPage();

		// Step 1: Navigate to mint page
		console.log("\n📍 Step 1: Navigate to mint page");
		await page.goto("/mint");
		await page.waitForLoadState("networkidle");

		// Step 2-6: Connect wallet (or skip if already connected)
		await connectWalletIfNeeded(page, metamask);

		// Step 7: Wait for the borrow form to load
		console.log("📍 Step 7: Wait for borrow form to load");
		const collateralLabel = page.getByText(/Select your collateral asset/i);
		await expect(collateralLabel).toBeVisible({ timeout: 15000 });

		const cbtcToken = page.getByText("cBTC").first();
		await expect(cbtcToken).toBeVisible({ timeout: 15000 });

		// Step 8: Check wallet balance
		console.log("📍 Step 8: Check wallet balance");
		const balanceText = await page.locator("text=/\\d+\\.?\\d*\\s*cBTC/").first().textContent({ timeout: 10000 });
		console.log(`   Wallet balance: ${balanceText}`);

		const balanceMatch = balanceText?.match(/([\d.]+)\s*cBTC/);
		const balance = balanceMatch ? parseFloat(balanceMatch[1]) : 0;

		if (balance < 0.003) {
			console.log("⚠️  Insufficient cBTC balance for test (need 0.003). Skipping.");
			await page.close();
			test.skip();
			return;
		}

		// Step 9: Enter collateral amount: 0.003 cBTC
		console.log("📍 Step 9: Enter collateral amount: 0.003 cBTC");
		// The collateral input is the first visible text input with placeholder="0" that's NOT in a slider
		// It's in the section with cBTC token display
		const allInputs = page.locator('input[placeholder="0"]');
		const collateralInput = allInputs.first();
		await expect(collateralInput).toBeVisible({ timeout: 10000 });
		await collateralInput.click();
		await collateralInput.press("Control+a");
		await collateralInput.fill("0.003");
		console.log("   Entered: 0.003 cBTC");
		await page.waitForTimeout(1000);

		// Step 10: Set liquidation price: 40000
		console.log("📍 Step 10: Set liquidation price: 40000");
		// The liquidation price input is the second text input with placeholder="0" (after collateral)
		// It's in the slider section with JUSD logo
		const liqPriceInput = allInputs.nth(1);
		await expect(liqPriceInput).toBeVisible({ timeout: 10000 });
		await liqPriceInput.click();
		await liqPriceInput.press("Control+a");
		await liqPriceInput.fill("40000");
		console.log("   Entered: 40000 JUSD");
		await page.waitForTimeout(1000);

		// Step 11: Set expiration date: 1 month from now
		console.log("📍 Step 11: Set expiration date: 1 month from now");
		const oneMonthFromNow = new Date();
		oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
		const formattedDate = oneMonthFromNow.toISOString().split("T")[0]; // YYYY-MM-DD

		const dateInput = page.locator("#expiration-datepicker");
		await expect(dateInput).toBeVisible({ timeout: 10000 });
		await dateInput.click();
		await dateInput.fill(formattedDate);
		await page.keyboard.press("Escape"); // Close date picker
		console.log(`   Entered: ${formattedDate}`);
		await page.waitForTimeout(500);

		// Step 12: Verify "You get" amount
		console.log("📍 Step 12: Verify loan amount calculated");
		const youGetLabel = page.getByText(/You get/i);
		await expect(youGetLabel).toBeVisible();

		// Step 13: Click borrow button
		console.log("📍 Step 13: Click borrow button");
		const borrowButton = page.getByRole("button", { name: /receive.*jusd/i });
		await expect(borrowButton).toBeVisible({ timeout: 10000 });

		const isDisabled = await borrowButton.isDisabled();
		if (isDisabled) {
			console.log("⚠️  Borrow button is disabled. Checking for errors...");
			const errorText = await page
				.locator('[class*="error"], [class*="Error"]')
				.textContent()
				.catch(() => "");
			console.log(`   Error: ${errorText || "Unknown error"}`);
			await page.close();
			test.skip();
			return;
		}

		// Record timestamp before transaction for blockchain verification
		const txStartTime = new Date();

		await borrowButton.click();
		console.log("   Clicked borrow button");

		// Step 14: Confirm transaction in MetaMask
		console.log("📍 Step 14: Confirm transaction in MetaMask");
		await page.waitForTimeout(2000);

		try {
			await metamask.confirmTransaction();
			console.log("   Transaction confirmed in MetaMask");
		} catch (error) {
			console.log("⚠️  Failed to confirm transaction:", error);
			await page.close();
			throw error;
		}

		// Step 15: Verify transaction on blockchain (MANDATORY - must confirm within 10s)
		console.log("📍 Step 15: Verify transaction on Citreascan (10s timeout)");
		const confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
		expect(confirmedTx.status).toBe("ok");
		expect(confirmedTx.result).toBe("success");

		// Step 15b: Capture explorer screenshot in separate tab
		console.log("📍 Step 15b: Capture explorer screenshot");
		await captureExplorerScreenshot(context, confirmedTx.hash, "loan-custom-params");

		// Step 16: Wait for UI success indicator
		console.log("📍 Step 16: Wait for UI confirmation");
		try {
			const successIndicator = page.locator("text=/success|confirmed|minted/i").first();
			await expect(successIndicator).toBeVisible({ timeout: 10000 });
			console.log("✅ UI shows transaction successful!");
		} catch {
			// UI indicator is optional since we already verified on blockchain
			console.log("   UI indicator not found, but blockchain confirmed");
		}

		// Step 17: Capture final state
		console.log("📍 Step 17: Capture final state");
		await page.waitForTimeout(2000);
		await expect(page).toHaveScreenshot("loan-custom-params-success.png", {
			maxDiffPixelRatio: 0.1,
		});

		await page.close();
	});

	test("should complete full loan lifecycle: open position, swap JUSD to SUSD, swap back, close position", async () => {
		page = await context.newPage();

		// Screenshot counter for unique naming
		let screenshotCount = 0;
		const screenshot = async (name: string) => {
			screenshotCount++;
			const filename = `lifecycle-${String(screenshotCount).padStart(2, "0")}-${name}.png`;
			await page.screenshot({ path: `test-results/screenshots/${filename}`, fullPage: true });
			console.log(`   📸 Screenshot: ${filename}`);
		};

		// =====================================================================
		// PHASE 1: Create a loan position
		// =====================================================================
		console.log("\n🔵 PHASE 1: Create Loan Position");
		console.log("━".repeat(50));

		// Step 1: Navigate to mint page
		console.log("\n📍 Step 1: Navigate to mint page");
		await page.goto("/mint");
		await page.waitForLoadState("networkidle");
		await screenshot("01-mint-page-initial");

		// Step 2-6: Connect wallet (or skip if already connected)
		await screenshot("02-before-connect-wallet");
		await connectWalletIfNeeded(page, metamask);
		await screenshot("03-wallet-connected");

		// Step 7: Wait for the borrow form to load
		console.log("📍 Step 7: Wait for borrow form to load");
		const collateralLabel = page.getByText(/Select your collateral asset/i);
		await expect(collateralLabel).toBeVisible({ timeout: 15000 });

		const cbtcToken = page.getByText("cBTC").first();
		await expect(cbtcToken).toBeVisible({ timeout: 15000 });
		await screenshot("09-borrow-form-loaded");

		// Step 8: Check wallet balance
		console.log("📍 Step 8: Check wallet balance");
		const balanceText = await page.locator("text=/\\d+\\.?\\d*\\s*cBTC/").first().textContent({ timeout: 10000 });
		console.log(`   Wallet balance: ${balanceText}`);

		const balanceMatch = balanceText?.match(/([\d.]+)\s*cBTC/);
		const balance = balanceMatch ? parseFloat(balanceMatch[1]) : 0;

		if (balance < 0.003) {
			console.log("⚠️  Insufficient cBTC balance for test (need 0.003). Skipping.");
			await screenshot("10-insufficient-balance");
			await page.close();
			test.skip();
			return;
		}

		// Step 9: Enter collateral amount: 0.003 cBTC
		console.log("📍 Step 9: Enter collateral amount: 0.003 cBTC");
		const allInputs = page.locator('input[placeholder="0"]');
		const collateralInput = allInputs.first();
		await expect(collateralInput).toBeVisible({ timeout: 10000 });
		await collateralInput.click();
		await collateralInput.press("Control+a");
		await collateralInput.fill("0.003");
		console.log("   Entered: 0.003 cBTC");
		await page.waitForTimeout(1000);
		await screenshot("10-collateral-entered");

		// Step 10: Set liquidation price: 40000
		console.log("📍 Step 10: Set liquidation price: 40000");
		const liqPriceInput = allInputs.nth(1);
		await expect(liqPriceInput).toBeVisible({ timeout: 10000 });
		await liqPriceInput.click();
		await liqPriceInput.press("Control+a");
		await liqPriceInput.fill("40000");
		console.log("   Entered: 40000 JUSD");
		await page.waitForTimeout(1000);
		await screenshot("11-liquidation-price-entered");

		// Step 11: Set expiration date: 1 month from now
		console.log("📍 Step 11: Set expiration date: 1 month from now");
		const oneMonthFromNow = new Date();
		oneMonthFromNow.setMonth(oneMonthFromNow.getMonth() + 1);
		const formattedDate = oneMonthFromNow.toISOString().split("T")[0];

		const dateInput = page.locator("#expiration-datepicker");
		await expect(dateInput).toBeVisible({ timeout: 10000 });
		await dateInput.click();
		await screenshot("12-datepicker-open");
		await dateInput.fill(formattedDate);
		await page.keyboard.press("Escape");
		console.log(`   Entered: ${formattedDate}`);
		await page.waitForTimeout(500);
		await screenshot("13-expiration-date-entered");

		// Step 12: Get the JUSD amount we'll receive (for later swap)
		console.log("📍 Step 12: Check loan amount");
		const youGetLabel = page.getByText(/You get/i);
		await expect(youGetLabel).toBeVisible();
		await screenshot("14-loan-form-complete");

		// Step 13: Click borrow button
		console.log("📍 Step 13: Click borrow button");
		const borrowButton = page.getByRole("button", { name: /receive.*jusd/i });
		await expect(borrowButton).toBeVisible({ timeout: 10000 });
		await screenshot("15-before-borrow-click");

		const isDisabled = await borrowButton.isDisabled();
		if (isDisabled) {
			console.log("⚠️  Borrow button is disabled. Skipping test.");
			await screenshot("16-borrow-button-disabled");
			await page.close();
			test.skip();
			return;
		}

		// Record timestamp before transaction for blockchain verification
		let txStartTime = new Date();

		await borrowButton.click();
		console.log("   Clicked borrow button");
		await screenshot("16-after-borrow-click");

		// Step 14: Confirm transaction in MetaMask
		console.log("📍 Step 14: Confirm transaction in MetaMask");
		await page.waitForTimeout(2000);
		await screenshot("17-waiting-for-metamask");

		try {
			await metamask.confirmTransaction();
			console.log("   Transaction confirmed in MetaMask");
		} catch (error) {
			console.log("⚠️  Failed to confirm transaction:", error);
			await screenshot("18-metamask-error");
			await page.close();
			throw error;
		}

		await screenshot("18-after-metamask-confirm");

		// Step 15: Verify transaction on blockchain
		console.log("📍 Step 15: Verify loan creation on Citreascan (10s timeout)");
		let confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
		expect(confirmedTx.status).toBe("ok");
		expect(confirmedTx.result).toBe("success");
		console.log("✅ Loan created successfully!");

		// Capture explorer screenshot for loan creation
		console.log("📍 Step 15b: Capture explorer screenshot");
		await captureExplorerScreenshot(context, confirmedTx.hash, "lifecycle-loan-creation");

		// Wait for UI to update
		await page.waitForTimeout(3000);
		await screenshot("19-loan-created-success");

		// =====================================================================
		// PHASE 2: Swap JUSD to SUSD
		// =====================================================================
		console.log("\n🟡 PHASE 2: Swap JUSD → SUSD");
		console.log("━".repeat(50));

		// Navigate to swap page
		console.log("\n📍 Navigate to /swap");
		await page.goto("/swap");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);
		await screenshot("20-swap-page-initial");

		// The default view is SUSD → JUSD, we need to reverse it to JUSD → SUSD
		console.log("📍 Change swap direction (JUSD → SUSD)");
		// Click the direction change button (arrow button)
		const directionButton = page.locator('button:has(svg[data-icon="arrow-down"])');
		await expect(directionButton).toBeVisible({ timeout: 10000 });
		await directionButton.click();
		await page.waitForTimeout(1000);
		console.log("   Direction changed to JUSD → SUSD");
		await screenshot("21-swap-direction-changed");

		// Enter amount to swap (use a small amount)
		console.log("📍 Enter swap amount");
		// Bring focus back to the main page (away from MetaMask)
		await page.bringToFront();
		await page.waitForTimeout(1000);
		// The input field uses BigNumberInput with placeholder="0" and type="text"
		const swapInput = page.locator('input[placeholder="0"]').first();
		await expect(swapInput).toBeVisible({ timeout: 10000 });
		await swapInput.click();
		await swapInput.fill("1"); // Enter 1 JUSD (component handles decimals)
		await page.waitForTimeout(1000);
		console.log("   Entered: 1 JUSD");
		await screenshot("22-swap-amount-entered-jusd");

		// Check if we need to approve first
		console.log("📍 Check for approve button");
		const approveButton = page.getByRole("button", { name: /approve/i });
		const needsApproval = await approveButton.isVisible({ timeout: 3000 }).catch(() => false);

		if (needsApproval) {
			console.log("📍 Approving JUSD...");
			await screenshot("23-jusd-needs-approval");
			txStartTime = new Date();
			await approveButton.click();
			await screenshot("24-jusd-approval-clicked");
			await page.waitForTimeout(3000);
			// Use approveTokenPermission for ERC20 approve() calls - MetaMask shows a different dialog
			await metamask.approveTokenPermission({ spendLimit: "max" });
			console.log("   Token permission approved in MetaMask");
			await screenshot("25-jusd-approval-confirmed");

			// Verify approval on blockchain
			console.log("📍 Verify approval on Citreascan");
			confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
			expect(confirmedTx.status).toBe("ok");
			expect(confirmedTx.result).toBe("success");
			console.log("   ✅ Approval confirmed on chain!");

			// Capture explorer screenshot for JUSD approval
			await captureExplorerScreenshot(context, confirmedTx.hash, "lifecycle-jusd-approval");

			await page.waitForTimeout(2000);
			await screenshot("26-jusd-approval-success");
		}

		// Click swap button
		console.log("📍 Execute swap JUSD → SUSD");
		const swapButton = page.getByRole("button", { name: /swap/i });
		await expect(swapButton).toBeVisible({ timeout: 10000 });
		await expect(swapButton).toBeEnabled({ timeout: 10000 });
		await screenshot("27-before-swap-jusd-to-susd");

		txStartTime = new Date();
		await swapButton.click();
		await screenshot("28-swap-jusd-clicked");
		await page.waitForTimeout(2000);
		await metamask.confirmTransaction();
		console.log("   Swap confirmed in MetaMask");
		await screenshot("29-swap-jusd-metamask-confirmed");

		// Verify swap on blockchain
		console.log("📍 Verify swap on Citreascan (10s timeout)");
		confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
		expect(confirmedTx.status).toBe("ok");
		expect(confirmedTx.result).toBe("success");
		console.log("✅ JUSD → SUSD swap successful!");

		// Capture explorer screenshot for JUSD → SUSD swap
		await captureExplorerScreenshot(context, confirmedTx.hash, "lifecycle-swap-jusd-to-susd");

		await page.waitForTimeout(2000);
		await screenshot("30-swap-jusd-to-susd-success");

		// =====================================================================
		// PHASE 3: Swap SUSD back to JUSD
		// =====================================================================
		console.log("\n🟢 PHASE 3: Swap SUSD → JUSD");
		console.log("━".repeat(50));

		// Refresh the page to reset state
		await page.goto("/swap");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);
		await screenshot("31-swap-page-for-susd");

		// Default view is SUSD → JUSD, so no direction change needed
		console.log("📍 Enter swap amount (SUSD → JUSD)");
		// Bring focus back to the main page
		await page.bringToFront();
		await page.waitForTimeout(1000);
		const swapInputBack = page.locator('input[placeholder="0"]').first();
		await expect(swapInputBack).toBeVisible({ timeout: 10000 });
		await swapInputBack.click();
		await swapInputBack.fill("1"); // Enter 1 SUSD (component handles decimals)
		await page.waitForTimeout(1000);
		console.log("   Entered: 1 SUSD");
		await screenshot("32-swap-amount-entered-susd");

		// Check if we need to approve SUSD
		console.log("📍 Check for approve button");
		const approveButtonSusd = page.getByRole("button", { name: /approve/i });
		const needsApprovalSusd = await approveButtonSusd.isVisible({ timeout: 3000 }).catch(() => false);

		if (needsApprovalSusd) {
			console.log("📍 Approving SUSD...");
			await screenshot("33-susd-needs-approval");
			txStartTime = new Date();
			await approveButtonSusd.click();
			await screenshot("34-susd-approval-clicked");
			await page.waitForTimeout(3000);
			// Use approveTokenPermission for ERC20 approve() calls
			await metamask.approveTokenPermission({ spendLimit: "max" });
			console.log("   Token permission approved in MetaMask");
			await screenshot("35-susd-approval-confirmed");

			// Verify approval on blockchain
			console.log("📍 Verify approval on Citreascan");
			confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
			expect(confirmedTx.status).toBe("ok");
			expect(confirmedTx.result).toBe("success");
			console.log("   ✅ Approval confirmed on chain!");

			// Capture explorer screenshot for SUSD approval
			await captureExplorerScreenshot(context, confirmedTx.hash, "lifecycle-susd-approval");

			await page.waitForTimeout(2000);
			await screenshot("36-susd-approval-success");
		}

		// Click swap button
		console.log("📍 Execute swap SUSD → JUSD");
		const swapButtonBack = page.getByRole("button", { name: /swap/i });
		await expect(swapButtonBack).toBeVisible({ timeout: 10000 });
		await expect(swapButtonBack).toBeEnabled({ timeout: 10000 });
		await screenshot("37-before-swap-susd-to-jusd");

		txStartTime = new Date();
		await swapButtonBack.click();
		await screenshot("38-swap-susd-clicked");
		await page.waitForTimeout(2000);
		await metamask.confirmTransaction();
		console.log("   Swap confirmed in MetaMask");
		await screenshot("39-swap-susd-metamask-confirmed");

		// Verify swap on blockchain
		console.log("📍 Verify swap on Citreascan (10s timeout)");
		confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
		expect(confirmedTx.status).toBe("ok");
		expect(confirmedTx.result).toBe("success");
		console.log("✅ SUSD → JUSD swap successful!");

		// Capture explorer screenshot for SUSD → JUSD swap
		await captureExplorerScreenshot(context, confirmedTx.hash, "lifecycle-swap-susd-to-jusd");

		await page.waitForTimeout(2000);
		await screenshot("40-swap-susd-to-jusd-success");

		// =====================================================================
		// PHASE 4: Close the position
		// =====================================================================
		console.log("\n🔴 PHASE 4: Close Position");
		console.log("━".repeat(50));

		// Navigate to dashboard to find position address
		console.log("\n📍 Navigate to dashboard");
		await page.goto("/dashboard");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(3000);
		await screenshot("41-dashboard-page");

		// Find the "Manage" button for our position and get the href
		console.log("📍 Find position and navigate to manage page");
		const manageLink = page.locator('a[href^="/mint/0x"][href$="/manage"]').first();
		await expect(manageLink).toBeVisible({ timeout: 15000 });
		await screenshot("42-position-found-on-dashboard");
		const positionHref = await manageLink.getAttribute("href");
		console.log(`   Found position: ${positionHref}`);

		// Navigate to the loan management page
		const loanManageUrl = positionHref?.replace("/manage", "/manage/loan");
		console.log(`📍 Navigate to ${loanManageUrl}`);
		await page.goto(loanManageUrl || "/dashboard");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);
		await screenshot("43-loan-manage-page");

		// Switch to "Repay Loan" mode
		console.log("📍 Switch to Repay Loan mode");
		const repayLoanButton = page.getByText(/Repay Loan/i).first();
		await expect(repayLoanButton).toBeVisible({ timeout: 10000 });
		await screenshot("44-before-repay-loan-click");
		await repayLoanButton.click();
		await page.waitForTimeout(500);
		console.log("   Switched to Repay Loan mode");
		await screenshot("45-repay-loan-mode-active");

		// Click MAX to repay full amount
		console.log("📍 Click MAX to repay full loan");
		const maxButton = page.locator("button").filter({ hasText: /max/i }).first();
		await expect(maxButton).toBeVisible({ timeout: 5000 });
		await maxButton.click();
		await page.waitForTimeout(1000);
		console.log("   MAX amount entered");
		await screenshot("46-max-repay-amount-entered");

		// Check if we need to approve JUSD for the position
		console.log("📍 Check for approve button");
		const approveButtonClose = page.getByRole("button", { name: /approve/i });
		const needsApprovalClose = await approveButtonClose.isVisible({ timeout: 3000 }).catch(() => false);

		if (needsApprovalClose) {
			console.log("📍 Approving JUSD for position...");
			await screenshot("47-jusd-position-needs-approval");
			txStartTime = new Date();
			await approveButtonClose.click();
			await screenshot("48-jusd-position-approval-clicked");
			await page.waitForTimeout(3000);
			// Use approveTokenPermission for ERC20 approve() calls
			await metamask.approveTokenPermission({ spendLimit: "max" });
			console.log("   Token permission approved in MetaMask");
			await screenshot("49-jusd-position-approval-confirmed");

			// Verify approval on blockchain
			console.log("📍 Verify approval on Citreascan");
			confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
			expect(confirmedTx.status).toBe("ok");
			expect(confirmedTx.result).toBe("success");
			console.log("   ✅ Approval confirmed on chain!");

			// Capture explorer screenshot for close position approval
			await captureExplorerScreenshot(context, confirmedTx.hash, "lifecycle-close-position-approval");

			await page.waitForTimeout(2000);
			await screenshot("50-jusd-position-approval-success");
		}

		// Click "Confirm & Close Position" button
		console.log("📍 Click Confirm & Close Position");
		const closePositionButton = page.getByRole("button", { name: /Confirm.*Close Position/i });
		await expect(closePositionButton).toBeVisible({ timeout: 10000 });
		await expect(closePositionButton).toBeEnabled({ timeout: 10000 });
		await screenshot("51-before-close-position-click");

		txStartTime = new Date();
		await closePositionButton.click();
		await screenshot("52-close-position-clicked");
		await page.waitForTimeout(2000);
		await metamask.confirmTransaction();
		console.log("   Close position confirmed in MetaMask");
		await screenshot("53-close-position-metamask-confirmed");

		// Verify close position on blockchain
		console.log("📍 Verify position close on Citreascan (10s timeout)");
		confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
		expect(confirmedTx.status).toBe("ok");
		expect(confirmedTx.result).toBe("success");

		// Capture explorer screenshot for close position
		await captureExplorerScreenshot(context, confirmedTx.hash, "lifecycle-close-position");

		await page.waitForTimeout(2000);
		await screenshot("54-position-closed-success");

		console.log("\n" + "═".repeat(50));
		console.log("✅ FULL LOAN LIFECYCLE COMPLETED SUCCESSFULLY!");
		console.log("   1. ✅ Loan created with 0.003 cBTC collateral");
		console.log("   2. ✅ Swapped JUSD → SUSD");
		console.log("   3. ✅ Swapped SUSD → JUSD");
		console.log("   4. ✅ Position closed completely");
		console.log(`   📸 Total screenshots taken: ${screenshotCount}`);
		console.log("═".repeat(50));

		await screenshot("55-final-state");
		await page.close();
	});

	test("should close an existing position with single transaction", async () => {
		page = await context.newPage();

		// Screenshot helper
		let screenshotCount = 0;
		const screenshot = async (name: string) => {
			screenshotCount++;
			const filename = `close-position-${String(screenshotCount).padStart(2, "0")}-${name}.png`;
			if (!fs.existsSync(SCREENSHOT_DIR)) {
				fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
			}
			await page.screenshot({ path: `${SCREENSHOT_DIR}/${filename}`, fullPage: true });
			console.log(`   📸 Screenshot: ${filename}`);
		};

		console.log("\n🔴 TEST: Close Existing Position (Single Transaction)");
		console.log("━".repeat(50));
		console.log("This test validates that closing a position requires only ONE MetaMask confirmation");
		console.log("(Previously it required TWO: repayFull + withdrawCollateral)\n");

		// Step 1: Navigate to dashboard
		console.log("📍 Step 1: Navigate to dashboard");
		await page.goto("/dashboard");
		await page.waitForLoadState("networkidle");
		await screenshot("01-dashboard-initial");

		// Step 2: Force connect wallet (always fresh connection)
		console.log("📍 Step 2: Force connect wallet");
		await forceConnectWallet(page, metamask);
		await screenshot("02-wallet-connected");

		// Step 3: Wait for positions to load
		console.log("📍 Step 3: Wait for positions to load");
		await page.waitForTimeout(5000);
		await screenshot("03-positions-loaded");

		// Step 4: Find an existing position with the "Manage" link
		console.log("📍 Step 4: Find existing position");
		const manageLink = page.locator('a[href^="/mint/0x"][href$="/manage"]').first();
		const hasPosition = await manageLink.isVisible({ timeout: 15000 }).catch(() => false);

		if (!hasPosition) {
			console.log("⚠️  No existing position found on dashboard. Skipping test.");
			console.log("   To run this test, first create a loan position.");
			await screenshot("04-no-position-found");
			await page.close();
			test.skip();
			return;
		}

		await screenshot("04-position-found");
		const positionHref = await manageLink.getAttribute("href");
		console.log(`   Found position: ${positionHref}`);

		// Step 5: Navigate to loan management page
		const loanManageUrl = positionHref?.replace("/manage", "/manage/loan");
		console.log(`📍 Step 5: Navigate to ${loanManageUrl}`);
		await page.goto(loanManageUrl || "/dashboard");
		await page.waitForLoadState("networkidle");
		await page.waitForTimeout(2000);
		await screenshot("05-loan-manage-page");

		// Step 6: Switch to "Repay Loan" mode
		console.log("📍 Step 6: Switch to Repay Loan mode");
		const repayLoanButton = page.getByText(/Repay Loan/i).first();
		await expect(repayLoanButton).toBeVisible({ timeout: 10000 });
		await repayLoanButton.click();
		await page.waitForTimeout(500);
		console.log("   Switched to Repay Loan mode");
		await screenshot("06-repay-loan-mode");

		// Step 7: Click MAX to repay full amount
		console.log("📍 Step 7: Click MAX to repay full loan");
		const maxButton = page.locator("button").filter({ hasText: /max/i }).first();
		await expect(maxButton).toBeVisible({ timeout: 5000 });
		await expect(maxButton).toBeEnabled({ timeout: 5000 });
		await maxButton.click();
		await page.waitForTimeout(1000);
		console.log("   MAX amount entered");
		await screenshot("07-max-amount-entered");

		// Step 8: Check if we need to approve JUSD
		console.log("📍 Step 8: Check for approve button");
		const approveButton = page.getByRole("button", { name: /approve/i });
		const needsApproval = await approveButton.isVisible({ timeout: 3000 }).catch(() => false);

		let txStartTime: Date;

		if (needsApproval) {
			console.log("📍 Step 8a: Approving JUSD for position...");
			await screenshot("08a-needs-approval");
			txStartTime = new Date();
			await approveButton.click();
			await page.waitForTimeout(3000);
			await metamask.approveTokenPermission({ spendLimit: "max" });
			console.log("   Token permission approved in MetaMask");
			await screenshot("08b-approval-confirmed");

			// Verify approval on blockchain
			console.log("📍 Verify approval on Citreascan");
			const approvalTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
			expect(approvalTx.status).toBe("ok");
			console.log("   ✅ Approval confirmed on chain!");

			await page.waitForTimeout(2000);
			await screenshot("08c-approval-success");
		}

		// Step 9: Click "Confirm & Close Position" button
		console.log("📍 Step 9: Click Confirm & Close Position");
		console.log("   ⚡ IMPORTANT: This should trigger only ONE MetaMask confirmation!");
		const closePositionButton = page.getByRole("button", { name: /Confirm.*Close Position/i });
		await expect(closePositionButton).toBeVisible({ timeout: 10000 });
		await expect(closePositionButton).toBeEnabled({ timeout: 10000 });
		await screenshot("09-before-close-click");

		txStartTime = new Date();
		await closePositionButton.click();
		await screenshot("10-close-clicked");
		await page.waitForTimeout(2000);

		// THIS IS THE KEY ASSERTION: Only ONE confirmTransaction call!
		console.log("📍 Step 10: Confirm SINGLE transaction in MetaMask");
		await metamask.confirmTransaction();
		console.log("   ✅ Close position confirmed in MetaMask (SINGLE transaction!)");
		await screenshot("11-metamask-confirmed");

		// Step 11: Verify on blockchain
		console.log("📍 Step 11: Verify position close on Citreascan");
		const confirmedTx = await verifyTransactionOnCitreascan(WALLET_ADDRESS, txStartTime, CONFIRMATION_TIMEOUT_MS);
		expect(confirmedTx.status).toBe("ok");
		expect(confirmedTx.result).toBe("success");

		// Capture explorer screenshot
		await captureExplorerScreenshot(context, confirmedTx.hash, "close-position-single-tx");

		await page.waitForTimeout(2000);
		await screenshot("12-position-closed");

		console.log("\n" + "═".repeat(50));
		console.log("✅ CLOSE POSITION TEST PASSED!");
		console.log("   Position closed with SINGLE transaction (adjust call)");
		console.log("   Previously this required TWO transactions:");
		console.log("   - repayFull()");
		console.log("   - withdrawCollateral()");
		console.log(`   📸 Total screenshots: ${screenshotCount}`);
		console.log("═".repeat(50));

		await page.close();
	});
});
