import { test, expect, chromium, type BrowserContext } from "@playwright/test";
import { MetaMask, getExtensionId } from "@synthetixio/synpress-metamask/playwright";
import { prepareExtension } from "@synthetixio/synpress-cache";

const SEED_PHRASE = process.env.WALLET_SEED_PHRASE || "test test test test test test test test test test test junk";
const WALLET_PASSWORD = process.env.WALLET_PASSWORD || "TestPassword123!";

// Helper to wait for MetaMask extension page to be ready
async function waitForMetaMaskPage(context: BrowserContext): Promise<ReturnType<typeof context.pages>[0]> {
	const maxAttempts = 30;
	for (let i = 0; i < maxAttempts; i++) {
		const pages = context.pages();
		const mmPage = pages.find((p) => p.url().startsWith("chrome-extension://"));
		if (mmPage) {
			try {
				await mmPage.waitForSelector("#app-content .app", { timeout: 2000 });
				return mmPage;
			} catch {
				await mmPage.reload();
			}
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error("MetaMask page not found");
}

test.describe("Wallet Connect", () => {
	let context: BrowserContext;
	let metamaskPage: ReturnType<typeof context.pages>[0];
	let extensionId: string;

	test.beforeAll(async () => {
		const extensionPath = await prepareExtension();

		context = await chromium.launchPersistentContext("", {
			headless: false,
			args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
		});

		extensionId = await getExtensionId(context, "MetaMask");
		metamaskPage = await waitForMetaMaskPage(context);

		// Setup MetaMask wallet
		const metamask = new MetaMask(context, metamaskPage, WALLET_PASSWORD, extensionId);
		await metamask.importWallet(SEED_PHRASE);
	});

	test.afterAll(async () => {
		await context?.close();
	});

	test("should connect MetaMask to the dApp", async () => {
		const page = await context.newPage();

		await page.goto("/");
		await page.waitForLoadState("networkidle");

		// Click connect wallet button
		const connectButton = page.getByRole("button", { name: /connect/i });
		await expect(connectButton).toBeVisible({ timeout: 10000 });
		await connectButton.click();

		// Wait for wallet modal
		await page.waitForTimeout(1000);

		// Find and click MetaMask option
		let walletOption = page.getByText(/metamask/i).first();
		if (!(await walletOption.isVisible({ timeout: 2000 }).catch(() => false))) {
			walletOption = page.getByText(/browser wallet|injected/i).first();
		}
		await expect(walletOption).toBeVisible({ timeout: 5000 });
		await walletOption.click();

		// Wait for connection to complete
		await page.waitForTimeout(2000);

		// Verify wallet is connected - address should be visible
		await expect(page.locator("text=/0x[a-fA-F0-9]{4}/i").first()).toBeVisible({
			timeout: 15000,
		});

		await page.close();
	});
});
