import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // Reuse Vite's preview HTML and React refresh setup with a test-only fixture.
  await page.route(/\/src\/preview\.tsx(?:\?.*)?$/u, (route) => route.fulfill({
    contentType: "text/javascript",
    body: 'import "/e2e/fixtures/message-context-menu.tsx";'
  }));
  await page.goto("/preview.html");
  await expect(page.getByText("Сообщение 39", { exact: true })).toBeVisible();
});

test("keeps a message menu open through incoming-message auto-scroll", async ({ page }) => {
  const list = page.locator(".conversation__messages");
  const before = await list.evaluate((element) => element.scrollTop);
  await openMenu(page);

  await page.evaluate(() => {
    window.dispatchEvent(new Event("test:incoming-message"));
  });

  await expect(page.getByText("Сообщение 40", { exact: true })).toBeVisible();
  await expect.poll(() => list.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(before);
  await expect(page.getByRole("menu")).toBeVisible();
  await page.getByRole("menuitem", { name: "Ответить", exact: true }).click();
  await expect(page.getByText("Ответ на сообщение", { exact: true })).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("keeps an idle menu open across unchanged history refreshes", async ({ page }) => {
  await openMenu(page);
  await page.clock.install();
  await page.clock.runFor(30_000);
  await expect(page.getByRole("menu")).toBeVisible();

  for (let index = 0; index < 3; index += 1) {
    await page.evaluate(() => {
      window.dispatchEvent(new Event("test:refresh-history"));
    });
    await page.clock.runFor(1_000);
    await expect(page.getByRole("menu")).toBeVisible();
  }
});

test("keeps expanded reactions open during their native scroll", async ({ page }) => {
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Показать все реакции" }).click();
  const reactions = page.getByLabel("Реакции", { exact: true });
  expect(await reactions.evaluate((element) =>
    element.scrollHeight > element.clientHeight
  )).toBe(true);

  await reactions.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });

  await expect.poll(() => reactions.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(page.getByRole("menu")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
});

test("keeps the menu within a resized viewport until an outside press", async ({ page }) => {
  await openMenu(page);

  await page.setViewportSize({ width: 360, height: 600 });

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const bounds = await menu.boundingBox();
    return bounds === null ? Infinity : bounds.y + bounds.height;
  }).toBeLessThanOrEqual(600);
  await page.getByTestId("context-menu-backdrop").click({ position: { x: 2, y: 2 } });
  await expect(menu).toHaveCount(0);
});

test("keeps all actions reachable after a short-height viewport resize", async ({ page }) => {
  await openMenu(page);
  await page.getByRole("menuitem", { name: "Показать все реакции" }).click();
  await expect.poll(async () => {
    const bounds = await page.getByRole("menu").boundingBox();
    return bounds === null ? Infinity : bounds.y + bounds.height;
  }).toBeLessThanOrEqual(836);
  await page.setViewportSize({ width: 390, height: 250 });

  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await expect.poll(async () => {
    const bounds = await menu.boundingBox();
    return bounds === null ? Infinity : bounds.y + bounds.height;
  }).toBeLessThanOrEqual(242);
  const copy = page.getByRole("menuitem", { name: "Копировать текст", exact: true });
  await copy.scrollIntoViewIfNeeded();
  await expect(copy).toBeInViewport();
  await copy.click();
  await expect(menu).toHaveCount(0);
});

async function openMenu(page: Page) {
  await page.getByText("Сообщение 39", { exact: true }).click({ button: "right" });
  await expect(page.getByRole("menu")).toBeVisible();
}
