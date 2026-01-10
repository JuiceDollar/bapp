import { test, expect, Page } from "@playwright/test";

/**
 * Visual regression tests - capture and compare page screenshots
 * Run `yarn test:e2e:visual:update` to update baseline images
 */

/**
 * Normalize scrollbars for consistent screenshot dimensions across platforms.
 * Must be called early (before waiting for content) to ensure consistent rendering.
 */
async function normalizeScrollbars(page: Page): Promise<void> {
	await page.addStyleTag({
		content: `
			*, *::before, *::after {
				scrollbar-width: none !important;
				-ms-overflow-style: none !important;
			}
			*::-webkit-scrollbar {
				display: none !important;
				width: 0 !important;
				height: 0 !important;
			}
		`,
	});
}

/**
 * Wait for ApexCharts to fully render (including SVG path content).
 * Used for pages with dynamic charts that load asynchronously.
 */
async function waitForCharts(page: Page): Promise<void> {
	try {
		await page.waitForSelector(".apexcharts-area-series path", { state: "visible", timeout: 20000 });
		await page.waitForTimeout(1000);
	} catch {
		try {
			await page.waitForSelector(".apexcharts-svg", { state: "visible", timeout: 10000 });
			await page.waitForTimeout(1000);
		} catch {
			// Chart might not exist on this page
		}
	}
}

test.describe("Visual Regression", () => {
	test("dashboard page", async ({ page }) => {
		await page.goto("/dashboard");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("dashboard.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mint page", async ({ page }) => {
		await page.goto("/mint");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mint.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("savings page", async ({ page }) => {
		await page.goto("/savings");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");
		await waitForCharts(page);

		await expect(page).toHaveScreenshot("savings.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("equity page", async ({ page }) => {
		await page.goto("/equity");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");
		await waitForCharts(page);

		await expect(page).toHaveScreenshot("equity.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("governance page", async ({ page }) => {
		await page.goto("/governance");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("governance.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("challenges page", async ({ page }) => {
		await page.goto("/challenges");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("challenges.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("swap page", async ({ page }) => {
		await page.goto("/swap");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("swap.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("referrals page", async ({ page }) => {
		await page.goto("/referrals");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("referrals.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mobile viewport - dashboard", async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto("/dashboard");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("dashboard-mobile.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("tablet viewport - dashboard", async ({ page }) => {
		await page.setViewportSize({ width: 768, height: 1024 });
		await page.goto("/dashboard");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("dashboard-tablet.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});
});
