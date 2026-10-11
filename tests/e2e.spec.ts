import { test, expect } from "@playwright/test";

/**
 * Boots the planner on the bundled sample corridor (?sample=1) so this covers the
 * checkpoint strip + timeline UI even when Nominatim/OSRM/Open-Meteo or Postgres
 * are unreachable (the failure mode that blocked E2E-001..005 in TEST_MATRIX.md).
 */
test("checkpoint risk strip + weather timeline (offline sample corridor)", async ({ page }) => {
  const base = process.env.PREVIEW_URL;
  if (!base) throw new Error("PREVIEW_URL missing");

  await page.goto(`${base.replace(/\/$/, "")}/planner?sample=1`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "Checkpoint Weather & Risk Timeline" })).toBeVisible();
  for (const column of ["Mile", "ETA", "Wind", "Rain", "Snow", "Temp", "Risk"]) {
    await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
  }

  const slider = page.locator('input[type="range"]').first();
  await expect(page.getByText("Corridor by checkpoint")).toBeVisible();
  const before = await slider.inputValue();
  await page.locator(".risk-strip-row").nth(4).click();
  await expect(slider).not.toHaveValue(before);

  await page.getByRole("button", { name: "wind", exact: true }).click();
  await page.getByRole("button", { name: "Play" }).click();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await expect(page.getByText("sample corridor")).toBeVisible();
});

test("E2E key UX flows", async ({ page }) => {
  const base = process.env.PREVIEW_URL;
  if (!base) throw new Error("PREVIEW_URL missing");

  await page.goto(base, { waitUntil: "networkidle" });

  await page.getByLabel("Origin").fill("Dallas, TX");
  await page.getByLabel("Destination").fill("Denver, CO");
  await page.getByLabel("Load (lbs)").fill("36000");
  await page.getByRole("button", { name: "Run Route Risk Analysis" }).click();

  await expect(page.getByRole("heading", { name: "Playback + Layer Controls" })).toBeVisible({ timeout: 120000 });

  const slider = page.locator('input[type="range"]').first();
  await slider.fill("6");
  await page.getByRole("button", { name: "Play" }).click();
  await page.waitForTimeout(2500);
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();

  await page.getByRole("button", { name: "wind" }).click();
  await page.getByRole("button", { name: "precipitation" }).click();

  await expect(page.getByText("Side-by-Side Route Compare")).toBeVisible();
  await expect(page.locator('section:has-text("Side-by-Side Route Compare") select')).toHaveCount(2);

  await expect(page.getByRole("heading", { name: "Scenario Snapshots" })).toBeVisible();

  // Checkpoint weather & risk timeline (mile / ETA / wind / rain / snow / temp / risk)
  await expect(
    page.getByRole("heading", { name: "Checkpoint Weather & Risk Timeline" }),
  ).toBeVisible();
  for (const column of ["Mile", "ETA", "Wind", "Rain", "Snow", "Temp", "Risk"]) {
    await expect(page.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
  }
  await expect(page.locator("table tbody tr").first()).toBeVisible();

  // Corridor risk strip: clicking a checkpoint row drives the forecast slider.
  await expect(page.getByText("Corridor by checkpoint")).toBeVisible();
  const before = await slider.inputValue();
  await page.locator(".risk-strip-row").nth(3).click();
  await expect(slider).not.toHaveValue(before);
});
