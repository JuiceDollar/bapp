import { test, expect } from "@playwright/test";
import { gotoReady } from "./helpers/navigation";

test.describe("Dashboard @smoke", () => {
	test.beforeEach(async ({ page }) => {
		await gotoReady(page, "/dashboard");
		await expect(page).toHaveURL(/dashboard/);
	});

	test("document title includes Dashboard", async ({ page }) => {
		await expect(page).toHaveTitle(/Dashboard/i);
	});

	test("shows core portfolio section links", async ({ page }) => {
		await expect(page.getByRole("link", { name: /My Equity/i })).toBeVisible({ timeout: 20000 });
		await expect(page.getByRole("link", { name: /My Savings/i })).toBeVisible({ timeout: 20000 });
		await expect(page.getByRole("link", { name: /My Borrow/i })).toBeVisible({ timeout: 20000 });
	});

	test("shows borrow summary row (total owed)", async ({ page }) => {
		await expect(page.getByText(/^Total owed$/i)).toBeVisible({ timeout: 20000 });
	});

	test("shows savings overview section", async ({ page }) => {
		await expect(page.getByText(/^Savings Overview$/i)).toBeVisible({ timeout: 20000 });
	});

	test("monitoring section tab button is present", async ({ page }) => {
		await expect(page.getByRole("button", { name: /^Monitoring$/i }).first()).toBeVisible({ timeout: 20000 });
	});
});
