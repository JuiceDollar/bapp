import { test, expect } from "@playwright/test";
import { gotoReady } from "./helpers/navigation";

/**
 * Currency display tests - verify USD ($) is shown everywhere, not EUR (€)
 * Part of the EUR to USD migration (PR #77)
 */

test.describe("Currency Display - USD Only", () => {
	const pages = [
		{ url: "/mint", name: "Mint" },
		{ url: "/swap", name: "Swap" },
		{ url: "/equity", name: "Equity" },
		{ url: "/savings", name: "Savings" },
		{ url: "/referrals", name: "Referrals" },
		{ url: "/monitoring", name: "Monitoring" },
		{ url: "/mypositions", name: "My Positions" },
	];

	for (const pageInfo of pages) {
		test(`${pageInfo.name} page should not display EUR symbol (€)`, async ({ page }) => {
			await gotoReady(page, pageInfo.url);
			await page.waitForLoadState("load");

			// Verify no EUR symbols (€) are displayed in visible text
			const euroSymbolCount = await page.locator("text=€").count();
			expect(euroSymbolCount).toBe(0);
		});
	}

	test("Mint page should display USD value for collateral", async ({ page }) => {
		await gotoReady(page, "/mint");
		await expect(page.getByText(/Lend.*JUSD/i)).toBeVisible({ timeout: 20000 });

		// TokenInput should show $ values (e.g., "$0.00" or "$1,234.56")
		const usdValues = page.locator("text=/\\$\\d/");
		await expect(usdValues.first()).toBeVisible({ timeout: 15000 });
	});

	test("Swap page should display USD values", async ({ page }) => {
		await gotoReady(page, "/swap");
		await expect(page.getByText(/Swap other stablecoins for/i)).toBeVisible({ timeout: 20000 });

		// Main inputs use formatCurrency without a "$" prefix; USD is shown in the asset picker modal ($ + price).
		const tokenPicker = page.getByRole("button", { name: /Select token|JUSD|USDC|USDT|DAI|USDbC|FRAX|cBTC/i }).first();
		await tokenPicker.click({ timeout: 15000 });
		await expect(page.getByText(/Select Asset/i).first()).toBeVisible({ timeout: 15000 });
		// Modal rows render currency + price in one string, e.g. "$0.00" or "$< 0.01"
		const rowWithDollarPrice = page.locator("button").filter({ hasText: /\$[0-9<.,]/ });
		await expect(rowWithDollarPrice.first()).toBeVisible({ timeout: 15000 });
		await page.keyboard.press("Escape");
	});

	test("Referrals page should show $ for bonus amounts", async ({ page }) => {
		await gotoReady(page, "/referrals");
		await expect(page.getByText(/^Referral Center$/).first()).toBeVisible({ timeout: 20000 });

		// Stats should show $ prefix for amounts (e.g., "$ 0" or "$ 1,234")
		const dollarAmounts = page.locator("text=/\\$ \\d/");
		await expect(dollarAmounts.first()).toBeVisible({ timeout: 15000 });
	});

	test("Equity page should display USD values", async ({ page }) => {
		await gotoReady(page, "/equity");
		await expect(page.getByText("Native Decentralized Protocol Shares")).toBeVisible({ timeout: 20000 });

		// Stats use formatCurrency + TOKEN_SYMBOL (JUSD), not "$" + digits in the same node as on Mint.
		await expect(page.getByText(/^Supply$/).first()).toBeVisible({ timeout: 20000 });
		await expect(page.getByText(/JUSD/).first()).toBeVisible({ timeout: 15000 });
		expect(await page.locator("text=€").count()).toBe(0);
	});

	test("Savings page should not display EUR symbol", async ({ page }) => {
		await gotoReady(page, "/savings");
		await expect(page.getByText(/Earn yield on your JUSD/i)).toBeVisible({ timeout: 20000 });

		// Savings page displays amounts in JUSD, not with currency symbols
		// Just verify no EUR symbol is shown
		const euroSymbolCount = await page.locator("text=€").count();
		expect(euroSymbolCount).toBe(0);
	});
});
