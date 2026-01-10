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

	test("ecosystem page", async ({ page }) => {
		await page.goto("/ecosystem");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");
		await waitForCharts(page);

		await expect(page).toHaveScreenshot("ecosystem.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("monitoring page", async ({ page }) => {
		await page.goto("/monitoring");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("monitoring.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mypositions page", async ({ page }) => {
		await page.goto("/mypositions");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mypositions.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mint create page", async ({ page }) => {
		await page.goto("/mint/create");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mint-create.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("404 page", async ({ page }) => {
		await page.goto("/nonexistent-page-for-404-test");
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("404.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	// Dynamic pages with real testnet data
	// Position source: https://dev.api.testnet.juicedollar.com/positions/list
	const TEST_POSITION = "0xDd37e2Bdbcf01000fa2C744f95dCc653f1660EAE";
	// Challenge source: https://dev.api.testnet.juicedollar.com/challenges/list (position: 0x9A1FEAE477748c57bC5bf9d07f6b7427C3f26879)
	const TEST_CHALLENGE_INDEX = "3";

	test("mint position detail page", async ({ page }) => {
		await page.goto(`/mint/${TEST_POSITION}`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mint-position-detail.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mint position manage page", async ({ page }) => {
		await page.goto(`/mint/${TEST_POSITION}/manage`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mint-position-manage.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mint position manage collateral page", async ({ page }) => {
		await page.goto(`/mint/${TEST_POSITION}/manage/collateral`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mint-position-manage-collateral.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mint position manage expiration page", async ({ page }) => {
		await page.goto(`/mint/${TEST_POSITION}/manage/expiration`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mint-position-manage-expiration.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mint position manage liquidation-price page", async ({ page }) => {
		await page.goto(`/mint/${TEST_POSITION}/manage/liquidation-price`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mint-position-manage-liqprice.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mint position manage loan page", async ({ page }) => {
		await page.goto(`/mint/${TEST_POSITION}/manage/loan`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mint-position-manage-loan.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("monitoring position detail page", async ({ page }) => {
		await page.goto(`/monitoring/${TEST_POSITION}`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("monitoring-position-detail.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("monitoring position challenge page", async ({ page }) => {
		await page.goto(`/monitoring/${TEST_POSITION}/challenge`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("monitoring-position-challenge.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("monitoring position forceSell page", async ({ page }) => {
		await page.goto(`/monitoring/${TEST_POSITION}/forceSell`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("monitoring-position-forcesell.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("mypositions adjust page", async ({ page }) => {
		await page.goto(`/mypositions/${TEST_POSITION}/adjust`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("mypositions-adjust.png", {
			fullPage: true,
			maxDiffPixelRatio: 0.01,
		});
	});

	test("challenges bid page", async ({ page }) => {
		await page.goto(`/challenges/${TEST_CHALLENGE_INDEX}/bid`);
		await normalizeScrollbars(page);
		await page.waitForLoadState("networkidle");

		await expect(page).toHaveScreenshot("challenges-bid.png", {
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
