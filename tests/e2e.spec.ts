import { test, expect } from "@playwright/test";

test("E2E key UX flows", async ({ page }) => {
  const base = process.env.PREVIEW_URL;
  if (!base) throw new Error("PREVIEW_URL missing");

  await page.goto(base, { waitUntil: "networkidle" });

  await page.getByLabel("Origin").fill("Dallas, TX");
  await page.getByLabel("Destination").fill("Denver, CO");
  await page.getByLabel("Load (lbs)").fill("36000");
  await page.getByRole("button", { name: "Run Route Risk Analysis" }).click();

  await expect(page.getByText("Playback & Layer Controls")).toBeVisible({ timeout: 120000 });

  const slider = page.locator('input[type="range"]').first();
  await slider.fill("6");
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(2500);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await page.getByRole("button", { name: "wind" }).click();
  await page.getByRole("button", { name: "precipitation" }).click();

  await expect(page.getByText("Side-by-Side Route Compare")).toBeVisible();
  await expect(page.locator('section:has-text("Side-by-Side Route Compare") select')).toHaveCount(2);

  await expect(page.getByText("Scenario Snapshots (Departure Time Comparison)")).toBeVisible();
});
