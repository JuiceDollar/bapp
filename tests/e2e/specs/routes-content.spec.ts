import { test, expect } from "@playwright/test";
import { gotoReady } from "./helpers/navigation";

/**
 * Smoke assertions for routes that were previously only covered by currency (no €) checks.
 */
test.describe("Route content @smoke", () => {
	test("swap page shows headline and send/receive inputs", async ({ page }) => {
		await gotoReady(page, "/swap");
		await expect(page).toHaveURL(/swap/);
		await expect(page.getByText(/Swap other stablecoins for/i)).toBeVisible({ timeout: 20000 });
		await expect(page.getByText(/^Send$/).first()).toBeVisible({ timeout: 20000 });
		await expect(page.getByText(/^Receive$/).first()).toBeVisible({ timeout: 20000 });
	});

	test("monitoring page shows title and table or empty state", async ({ page }) => {
		await gotoReady(page, "/monitoring");
		await expect(page).toHaveURL(/monitoring/);
		await expect(page).toHaveTitle(/Monitoring/i);
		const empty = page.getByText(/There are no active positions/i);
		const header = page
			.locator("span")
			.filter({ hasText: /^Collateralization$/ })
			.first();
		await expect(empty.or(header)).toBeVisible({ timeout: 20000 });
	});

	test("challenges page shows Auctions title and table or empty state", async ({ page }) => {
		await gotoReady(page, "/challenges");
		await expect(page).toHaveURL(/challenges/);
		await expect(page).toHaveTitle(/Auctions/i);
		const empty = page.getByText(/no active challenges/i);
		const available = page.getByText("Available", { exact: true });
		const phase = page.getByText("Phase", { exact: true });
		const price = page.getByText("Price", { exact: true });
		const endsIn = page.getByText("Ends in", { exact: true });
		await expect(empty.or(available).or(phase).or(price).or(endsIn).first()).toBeVisible({ timeout: 30000 });
	});

	test("my positions page shows owned positions section", async ({ page }) => {
		await gotoReady(page, "/mypositions");
		await expect(page).toHaveURL(/mypositions/);
		await expect(page).toHaveTitle(/Positions/i);
		await expect(page.getByText(/^Owned Positions$/).first()).toBeVisible({ timeout: 20000 });
	});

	test("referrals page shows referral center", async ({ page }) => {
		await gotoReady(page, "/referrals");
		await expect(page).toHaveURL(/referrals/);
		await expect(page).toHaveTitle(/Referrals/i);
		await expect(page.getByText(/^Referral Center$/).first()).toBeVisible({ timeout: 20000 });
	});
});
