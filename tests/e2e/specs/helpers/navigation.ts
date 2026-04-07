import type { Page } from "@playwright/test";

export async function gotoReady(page: Page, path: string): Promise<void> {
	await page.goto(path, { waitUntil: "domcontentloaded" });
}
