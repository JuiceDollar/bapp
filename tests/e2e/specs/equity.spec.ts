import { test, expect } from "@playwright/test";
import { gotoReady } from "./helpers/navigation";

test.describe("Equity Page @smoke", () => {
	test.beforeEach(async ({ page }) => {
		await gotoReady(page, "/equity");
		await expect(page).toHaveURL(/equity/);
	});

	test("document title includes Equity", async ({ page }) => {
		await expect(page).toHaveTitle(/Equity/i);
	});

	test("renders pool shares interaction card", async ({ page }) => {
		await expect(page.getByText("Native Decentralized Protocol Shares")).toBeVisible({ timeout: 20000 });
	});

	test("renders native pool stats labels", async ({ page }) => {
		await expect(page.getByText(/^Supply$/).first()).toBeVisible({ timeout: 20000 });
		await expect(page.getByText(/^Market Cap$/).first()).toBeVisible({ timeout: 20000 });
	});
});
