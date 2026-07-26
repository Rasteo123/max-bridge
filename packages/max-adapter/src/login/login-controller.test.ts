import { readFile } from "node:fs/promises";

import {
  chromium,
  type Browser,
  type Page
} from "playwright";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it
} from "vitest";

import {
  MaxLoginController
} from "./login-controller.js";

let browser: Browser;

beforeAll(async () => {
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser.close();
});

describe.each([
  ["English", "login-en.html"],
  ["Russian", "login-ru.html"]
])("MAX login controller: %s", (_language, fixtureName) => {
  it("submits a phone through autocomplete=tel and reaches code state", async () => {
    const page = await fixturePage(fixtureName);
    const controller = new MaxLoginController(page, {
      timeoutMs: 1_000
    });

    await expect(controller.submitPhone("+79990000000"))
      .resolves.toEqual({ state: "code_required" });
    await expect(page.locator("input[autocomplete=tel]").inputValue())
      .resolves.toBe("+79990000000");

    await page.context().close();
  });

  it("submits a code and detects authenticated chat navigation", async () => {
    const page = await fixturePage(fixtureName);
    const controller = new MaxLoginController(page, {
      timeoutMs: 1_000
    });
    await controller.submitPhone("+79990000000");

    await expect(controller.submitCode("12345"))
      .resolves.toEqual({ state: "authenticated" });

    await page.context().close();
  });

  it("returns a typed invalid-code result", async () => {
    const page = await fixturePage(fixtureName);
    const controller = new MaxLoginController(page, {
      timeoutMs: 1_000
    });
    await controller.submitPhone("+79990000000");

    await expect(controller.submitCode("0000"))
      .resolves.toEqual({ state: "invalid_code" });

    await page.context().close();
  });

  it("streams a QR image without writing a file", async () => {
    const page = await fixturePage(fixtureName);
    const controller = new MaxLoginController(page, {
      timeoutMs: 1_000
    });

    const image = await controller.getQrPng();

    expect(image.subarray(1, 4).toString("ascii")).toBe("PNG");
    await page.context().close();
  });
});

describe("MAX login exceptional states", () => {
  it("surfaces CAPTCHA instead of bypassing it", async () => {
    const page = await fixturePage("login-captcha.html");
    const controller = new MaxLoginController(page, {
      timeoutMs: 100
    });

    await expect(controller.detectState())
      .resolves.toEqual({ state: "captcha_required" });

    await page.context().close();
  });
});

async function fixturePage(fixtureName: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const html = await readFile(
    new URL(`../../tests/fixtures/${fixtureName}`, import.meta.url),
    "utf8"
  );
  await page.setContent(html);
  return page;
}
