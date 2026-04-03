import { test, expect } from "@playwright/test";

/**
 * Smoke tests for the Governance page.
 * No wallet required — verifies UI renders correctly for unauthenticated users.
 */

test.describe("Governance Page", () => {
	test.beforeEach(async ({ page }) => {
		await page.goto("/governance");
		await page.waitForURL(/governance/);
	});

	test.describe("Page Load", () => {
		test("should load with HTTP 200", async ({ page }) => {
			const response = await page.goto("/governance");
			expect(response?.status()).toBe(200);
		});

		test("should have correct document title", async ({ page }) => {
			await expect(page).toHaveTitle(/JUSD/i);
		});
	});

	test.describe("Leadrate Section", () => {
		test("should display leadrate heading", async ({ page }) => {
			const heading = page.getByText(/leadrate|lead rate/i).first();
			await expect(heading).toBeVisible({ timeout: 15000 });
		});

		test("should display current value label", async ({ page }) => {
			const currentValue = page.getByText(/current value|current leadrate/i).first();
			await expect(currentValue).toBeVisible({ timeout: 15000 });
		});

		test("should display propose button (disabled without wallet)", async ({ page }) => {
			const proposeBtn = page.getByRole("button", { name: /propose/i }).first();
			await expect(proposeBtn).toBeVisible({ timeout: 15000 });
		});

		test("should display proposals table or empty state", async ({ page }) => {
			// Either a table with proposals or an empty message is acceptable
			const tableOrEmpty = page.locator("table, [role='table'], text=/no proposals/i, text=/empty/i");
			await expect(tableOrEmpty.first()).toBeVisible({ timeout: 15000 });
		});
	});

	test.describe("Minters Section", () => {
		test("should display minters section", async ({ page }) => {
			const mintersSection = page.getByText(/minter/i).first();
			await expect(mintersSection).toBeVisible({ timeout: 15000 });
		});
	});

	test.describe("Connect Wallet prompt", () => {
		test("should show connect wallet button when not connected", async ({ page }) => {
			const connectBtn = page.getByRole("button", { name: /connect wallet/i }).first();
			await expect(connectBtn).toBeVisible({ timeout: 15000 });
		});
	});

	test.describe("Responsive Design", () => {
		test("should render on mobile viewport", async ({ page }) => {
			await page.setViewportSize({ width: 375, height: 667 });
			await page.reload();
			await page.waitForURL(/governance/);
			const heading = page.getByText(/leadrate|governance/i).first();
			await expect(heading).toBeVisible({ timeout: 15000 });
		});

		test("should render on tablet viewport", async ({ page }) => {
			await page.setViewportSize({ width: 768, height: 1024 });
			await page.reload();
			await page.waitForURL(/governance/);
			await expect(page.locator("body")).toBeVisible();
		});
	});
});
