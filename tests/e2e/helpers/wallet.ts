import { expect, chromium, type BrowserContext, type Page } from "@playwright/test";
import { MetaMask, getExtensionId } from "@synthetixio/synpress-metamask/playwright";
import { prepareExtension } from "@synthetixio/synpress-cache";

// ---------------------------------------------------------------------------
// MetaMask Setup
// ---------------------------------------------------------------------------

export interface MetaMaskSetup {
	context: BrowserContext;
	metamask: MetaMask;
}

export async function setupMetaMask(password: string, seedPhrase: string): Promise<MetaMaskSetup> {
	const extensionPath = await prepareExtension();

	const context = await chromium.launchPersistentContext("", {
		headless: false,
		viewport: { width: 1280, height: 720 },
		args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
	});

	const extensionId = await getExtensionId(context, "MetaMask");

	await new Promise((r) => setTimeout(r, 2000));
	const pages = context.pages();
	const metamaskPage = pages.find((p) => p.url().includes("chrome-extension://"));
	if (!metamaskPage) throw new Error("MetaMask extension page not found");

	const metamask = new MetaMask(context, metamaskPage, password, extensionId);
	await metamask.importWallet(seedPhrase);

	return { context, metamask };
}

// ---------------------------------------------------------------------------
// Wallet connection helpers
// ---------------------------------------------------------------------------

/**
 * Connects the wallet if not already connected with a valid balance.
 * Skips reconnection if wallet shows address and has balance > 0.
 */
export async function connectWalletIfNeeded(page: Page, metamask: MetaMask): Promise<void> {
	const walletAddressVisible = await page
		.locator("text=/0x[a-fA-F0-9]{4}/i")
		.first()
		.isVisible({ timeout: 3000 })
		.catch(() => false);

	if (walletAddressVisible) {
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

	await _doConnect(page, metamask);
}

/**
 * Always performs a fresh wallet connection regardless of current state.
 * Disconnects first if wallet appears already connected.
 */
export async function forceConnectWallet(page: Page, metamask: MetaMask): Promise<void> {
	console.log("📍 Force connecting wallet...");

	const connectButton = page.getByRole("button", { name: /connect/i });
	const connectVisible = await connectButton.isVisible({ timeout: 5000 }).catch(() => false);

	if (!connectVisible) {
		console.log("   No connect button found, looking for wallet menu to disconnect...");
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

		await page.reload();
		await page.waitForLoadState("networkidle");
	}

	await _doConnect(page, metamask);
}

async function _doConnect(page: Page, metamask: MetaMask): Promise<void> {
	const connectBtn = page.getByRole("button", { name: /connect/i });
	await expect(connectBtn).toBeVisible({ timeout: 10000 });
	await connectBtn.click();

	console.log("📍 Select MetaMask from modal");
	await page.waitForTimeout(1000);
	const walletOption = page.getByText(/metamask/i).first();
	await expect(walletOption).toBeVisible({ timeout: 5000 });
	await walletOption.click();

	console.log("📍 Approve connection in MetaMask");
	await metamask.connectToDapp();
	await page.waitForTimeout(2000);

	console.log("📍 Handle network switch if needed");
	try {
		const switchNetworkButton = page.getByRole("button", { name: /switch network/i });
		const isSwitchVisible = await switchNetworkButton.isVisible({ timeout: 3000 }).catch(() => false);
		if (isSwitchVisible) {
			await switchNetworkButton.click();
			await page.waitForTimeout(3000);
		}
	} catch {
		// Network switch not required
	}

	await page.keyboard.press("Escape");
	await page.waitForTimeout(500);

	const walletAddress = page.locator("text=/0x[a-fA-F0-9]{4}/i").first();
	await expect(walletAddress).toBeVisible({ timeout: 10000 });
	console.log("   ✅ Wallet connected!");
}

// ---------------------------------------------------------------------------
// Citreascan blockchain verification
// ---------------------------------------------------------------------------

const CITREASCAN_API = "https://testnet.citreascan.com/api/v2";
const DEFAULT_POLL_INTERVAL_MS = 1000;

interface CitreascanTransaction {
	hash: string;
	status: string;
	result: string;
	timestamp: string;
	from: { hash: string };
	to: { hash: string };
	value: string;
}

/**
 * Polls Citreascan until a new transaction from walletAddress appears after
 * beforeTimestamp and is confirmed, or throws if timeoutMs elapses.
 */
export async function verifyTransactionOnCitreascan(
	walletAddress: string,
	beforeTimestamp: Date,
	timeoutMs: number = 30000
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

			const data = (await response.json()) as { items: CitreascanTransaction[] };

			if (data.items && data.items.length > 0) {
				const recentTx = data.items.find((tx) => new Date(tx.timestamp) > beforeTimestamp);

				if (recentTx) {
					if (recentTx.status === "ok" && recentTx.result === "success") {
						const elapsed = Date.now() - startTime;
						console.log(`   ✅ Transaction confirmed in ${elapsed}ms — TX: ${recentTx.hash}`);
						return recentTx;
					} else if (recentTx.status === "error" || recentTx.result === "error") {
						throw new Error(`Transaction failed on blockchain: ${recentTx.hash}`);
					}
				}
			}
		} catch (error) {
			lastError = error as Error;
		}

		await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS));
	}

	throw new Error(
		`Transaction not confirmed on Citreascan within ${timeoutMs}ms. ` + `Last error: ${lastError?.message || "No transaction found"}`
	);
}

// ---------------------------------------------------------------------------
// Explorer screenshot helper
// ---------------------------------------------------------------------------

import * as fs from "fs";
import * as path from "path";

const SCREENSHOT_DIR = "test-results/screenshots";

/**
 * Opens the Citreascan explorer in a new tab and captures a screenshot of the tx.
 */
export async function captureExplorerScreenshot(context: BrowserContext, txHash: string, screenshotPrefix: string): Promise<void> {
	if (!fs.existsSync(SCREENSHOT_DIR)) {
		fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
	}

	const explorerUrl = `https://testnet.citreascan.com/tx/${txHash}`;
	console.log(`\n   📷 Opening explorer: ${explorerUrl}`);

	const explorerPage = await context.newPage();
	await explorerPage.bringToFront();
	await explorerPage.goto(explorerUrl);
	await explorerPage.waitForLoadState("networkidle");

	const successSelector = 'span:has-text("Success"), text="Success"';
	try {
		await explorerPage.locator(successSelector).first().waitFor({ state: "visible", timeout: 5000 });
		console.log("   ✅ Transaction confirmed on explorer");
	} catch {
		console.log("   ⏳ Waiting for confirmation...");
		await explorerPage.waitForTimeout(3000);
		await explorerPage.reload();
		await explorerPage.waitForLoadState("networkidle");
	}

	const screenshotPath = path.join(SCREENSHOT_DIR, `${screenshotPrefix}-explorer.png`);
	await explorerPage.screenshot({ path: screenshotPath, fullPage: true });
	console.log(`   📸 Screenshot saved: ${screenshotPath}`);

	await explorerPage.close();
}
