import { chromium } from "playwright";
import { expect, it } from "vitest";

import { MaxLoginController } from "./login-controller.js";
import { phoneMethodButton } from "./login-locators.js";

const liveTest = process.env["RUN_MAX_LIVE_SMOKE"] === "1" ? it : it.skip;

liveTest(
  "recognizes the live MAX login page without entering credentials",
  async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({
        locale: "ru-RU"
      });
      try {
        const page = await context.newPage();
        await page.goto("https://web.max.ru", {
          waitUntil: "domcontentloaded",
          timeout: 30_000
        });
        await phoneMethodButton(page).waitFor({
          state: "visible",
          timeout: 15_000
        });
        const controller = new MaxLoginController(page, {
          timeoutMs: 10_000
        });

        const result = await controller.detectState();
        expect([
          "method_required",
          "qr_required",
          "captcha_required"
        ]).toContain(result.state);
      } finally {
        await context.close();
      }
    } finally {
      await browser.close();
    }
  },
  45_000
);
