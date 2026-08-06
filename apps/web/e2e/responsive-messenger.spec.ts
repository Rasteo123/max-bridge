import {
  expect,
  test,
  type Locator,
  type Page
} from "@playwright/test";

const viewports = [
  { width: 1_440, height: 900 },
  { width: 1_024, height: 768 },
  { width: 820, height: 1_180 },
  { width: 768, height: 1_024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 320, height: 568 }
] as const;

for (const viewport of viewports) {
  test(`adapts without composer overlap at ${String(viewport.width)}x${String(viewport.height)}`, async ({
    page
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/preview.html");
    await expect(page.getByTestId("messenger-shell")).toHaveAttribute(
      "data-mode",
      viewport.width >= 820 ? "wide" : "narrow"
    );
    await expectComposerDoesNotOverlap(page);

    if (viewport.width >= 820) {
      await expectBothPanesInsideShell(page);
    } else {
      await expectFullWidthConversation(page);
      await page.getByRole("button", {
        name: "Открыть список чатов"
      }).click();
      await expectFullWidthList(page);
    }
  });
}

test("switches between wide and narrow modes without reload", async ({
  page
}) => {
  await page.setViewportSize({ width: 820, height: 900 });
  await page.goto("/preview.html");
  const shell = page.getByTestId("messenger-shell");
  await expect(shell).toHaveAttribute("data-mode", "wide");

  await page.setViewportSize({ width: 768, height: 900 });

  await expect(shell).toHaveAttribute("data-mode", "narrow");
  await expectFullWidthConversation(page);
});

test("returns to the list by swipe and then pages folders", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview.html");
  const shell = page.getByTestId("messenger-shell");

  await drag(page, 8, 300, 180);
  await expect(shell).toHaveAttribute("data-pane", "list");

  await drag(page, 300, 60, 180);
  await expect(shell).toHaveAttribute("data-pane", "list");
  await expect(page.getByRole("tab", { name: "Новые" }))
    .toHaveAttribute("aria-selected", "true");
});

test("keeps the responsive track aligned during a gesture", async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/preview.html");
  const shell = page.getByTestId("messenger-shell");

  await page.mouse.move(8, 180);
  await page.mouse.down();
  await page.mouse.move(150, 180, { steps: 6 });

  await expect(shell).toHaveAttribute("data-dragging", "true");
  const conversation = await box(page.getByTestId("conversation"));
  expect(conversation.x).toBeGreaterThan(0);
  expect(conversation.width).toBeCloseTo(390, 0);
  await page.mouse.up();
});

async function expectComposerDoesNotOverlap(page: Page) {
  const attach = await box(page.getByRole("button", {
    name: "Прикрепить файл"
  }));
  const field = await box(page.getByLabel("Сообщение"));
  const send = await box(page.getByRole("button", { name: "Отправить" }));
  expect(attach.x + attach.width).toBeLessThanOrEqual(field.x + 1);
  expect(field.x + field.width).toBeLessThanOrEqual(send.x + 1);
  expect(send.x + send.width).toBeLessThanOrEqual(
    (await box(page.getByTestId("conversation"))).x +
    (await box(page.getByTestId("conversation"))).width
  );
}

async function expectBothPanesInsideShell(page: Page) {
  const shell = await box(page.getByTestId("messenger-shell"));
  const list = await box(page.getByTestId("chat-list"));
  const conversation = await box(page.getByTestId("conversation"));
  expect(list.x).toBeGreaterThanOrEqual(shell.x);
  expect(list.x + list.width).toBeLessThanOrEqual(conversation.x + 1);
  expect(conversation.x + conversation.width)
    .toBeLessThanOrEqual(shell.x + shell.width + 1);
}

async function expectFullWidthConversation(page: Page) {
  await expect.poll(async () =>
    (await box(page.getByTestId("conversation"))).x
  ).toBeCloseTo(0, 0);
  await expect.poll(async () =>
    (await box(page.getByTestId("conversation"))).width
  ).toBeCloseTo(page.viewportSize()?.width ?? 0, 0);
}

async function expectFullWidthList(page: Page) {
  await expect.poll(async () =>
    (await box(page.getByTestId("chat-list"))).x
  ).toBeCloseTo(0, 0);
  await expect.poll(async () =>
    (await box(page.getByTestId("chat-list"))).width
  ).toBeCloseTo(page.viewportSize()?.width ?? 0, 0);
}

async function box(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  if (result === null) {
    throw new Error("Element has no layout box");
  }
  return result;
}

async function drag(
  page: Page,
  fromX: number,
  toX: number,
  y: number
) {
  await page.mouse.move(fromX, y);
  await page.mouse.down();
  await page.mouse.move(toX, y, { steps: 8 });
  await page.mouse.up();
}
