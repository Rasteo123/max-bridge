import type { Page } from "playwright";

import {
  authenticatedNavigation,
  captchaElement,
  codeDigitInputs,
  codeInput,
  formSubmitButton,
  loginAlert,
  phoneInput,
  phoneMethodButton,
  qrMethodButton,
  qrVisual
} from "./login-locators.js";
import type { MaxLoginResult } from "./login-state.js";

export type MaxLoginControllerOptions = Readonly<{
  timeoutMs?: number;
  isNetworkAuthenticated?: () => Promise<boolean>;
}>;

export class MaxLoginController {
  private readonly timeoutMs: number;

  constructor(
    private readonly page: Page,
    private readonly options: MaxLoginControllerOptions = {}
  ) {
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async submitPhone(phone: string): Promise<MaxLoginResult> {
    if (!/^\+[1-9]\d{7,14}$/u.test(phone)) {
      return { state: "failed" };
    }
    if (await this.isVisible(captchaElement(this.page))) {
      return { state: "captcha_required" };
    }
    if (await this.isVisible(loginAlert(this.page))) {
      await this.page.reload({
        waitUntil: "domcontentloaded",
        timeout: this.timeoutMs
      });
    }

    const input = phoneInput(this.page);
    if (!await this.isVisible(input)) {
      const method = phoneMethodButton(this.page);
      if (!await this.isVisible(method)) {
        await this.reloadLoginPage();
      }
      if (!await this.isVisible(input)) {
        await method.waitFor({ state: "visible", timeout: this.timeoutMs });
        await method.click();
      }
    }
    await input.waitFor({ state: "visible", timeout: this.timeoutMs });
    await input.fill(phone);
    const submit = formSubmitButton(input);
    await submit.click();
    return this.waitForState([
      "code_required",
      "captcha_required",
      "failed"
    ]);
  }

  async failureCategory(): Promise<
    "rate_limited" | "phone_rejected" | "generic" | "unknown"
  > {
    const alert = loginAlert(this.page);
    if (!await this.isVisible(alert)) {
      return "unknown";
    }
    const text = (await alert.textContent() ?? "").toLowerCase();
    if (
      /too many|rate limit|try again later|слишком много|попробуйте позже/u
        .test(text)
    ) {
      return "rate_limited";
    }
    if (
      /invalid phone|phone number|неверн.{0,12}номер|номер телефона/u
        .test(text)
    ) {
      return "phone_rejected";
    }
    if (/something went wrong|error|ошибк/u.test(text)) {
      return "generic";
    }
    return "unknown";
  }

  async submitCode(code: string): Promise<MaxLoginResult> {
    if (!/^\d{4,8}$/u.test(code)) {
      return { state: "invalid_code" };
    }
    const input = codeInput(this.page);
    if (!await this.isVisible(input)) {
      return this.detectState();
    }
    const digitInputs = codeDigitInputs(input);
    const digitInputCount = await digitInputs.count();
    if (digitInputCount > 1) {
      if (digitInputCount !== code.length) {
        return { state: "invalid_code" };
      }
      for (let index = 0; index < digitInputCount; index += 1) {
        await digitInputs.nth(index).fill(code[index] ?? "");
      }
    } else {
      await input.fill(code);
    }
    const submit = formSubmitButton(input);
    if (await this.isVisible(submit)) {
      try {
        await submit.click({
          timeout: Math.min(this.timeoutMs, 2_000)
        });
      } catch {
        const state = await this.detectState();
        if (state.state !== "code_required" && state.state !== "failed") {
          return state;
        }
        if (await this.isVisible(input)) {
          await input.press("Enter", {
            timeout: Math.min(this.timeoutMs, 2_000)
          });
        }
      }
    }
    return this.waitForState([
      "authenticated",
      "invalid_code",
      "captcha_required",
      "failed"
    ]);
  }

  async getQrPng(): Promise<Buffer> {
    const visual = qrVisual(this.page);
    if (!await this.isVisible(visual)) {
      const method = qrMethodButton(this.page);
      if (!await this.isVisible(method)) {
        await this.reloadLoginPage();
      }
      if (!await this.isVisible(visual)) {
        await method.waitFor({ state: "visible", timeout: this.timeoutMs });
        await method.click();
      }
    }
    await visual.waitFor({ state: "visible", timeout: this.timeoutMs });
    return visual.screenshot({ type: "png" });
  }

  async detectState(): Promise<MaxLoginResult> {
    if (await this.isVisible(captchaElement(this.page))) {
      return { state: "captcha_required" };
    }
    if (
      await this.options.isNetworkAuthenticated?.() === true
      || await this.isVisible(authenticatedNavigation(this.page))
    ) {
      return { state: "authenticated" };
    }
    const alert = loginAlert(this.page);
    if (await this.isVisible(alert)) {
      const text = await alert.textContent();
      if (/invalid code|неверный код/iu.test(text ?? "")) {
        return { state: "invalid_code" };
      }
      return { state: "failed" };
    }
    if (await this.isVisible(codeInput(this.page))) {
      return { state: "code_required" };
    }
    if (await this.isVisible(qrVisual(this.page))) {
      return { state: "qr_required" };
    }
    if (
      await this.isVisible(phoneMethodButton(this.page))
      || await this.isVisible(phoneInput(this.page))
    ) {
      return { state: "method_required" };
    }
    return { state: "failed" };
  }

  private async waitForState(
    expected: readonly MaxLoginResult["state"][]
  ): Promise<MaxLoginResult> {
    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() <= deadline) {
      const result = await this.detectState();
      if (
        result.state !== "failed"
        && expected.includes(result.state)
      ) {
        return result;
      }
      if (
        result.state === "failed"
        && expected.includes("failed")
        && await this.isVisible(loginAlert(this.page))
      ) {
        return result;
      }
      await this.page.waitForTimeout(25);
    }
    return { state: "failed" };
  }

  private async reloadLoginPage(): Promise<void> {
    await this.page.reload({
      waitUntil: "domcontentloaded",
      timeout: this.timeoutMs
    });
    await phoneMethodButton(this.page)
      .or(qrMethodButton(this.page))
      .or(phoneInput(this.page))
      .or(qrVisual(this.page))
      .first()
      .waitFor({ state: "visible", timeout: this.timeoutMs });
  }

  private async isVisible(locator: ReturnType<typeof phoneInput>): Promise<boolean> {
    try {
      return await locator.isVisible({ timeout: 50 });
    } catch {
      return false;
    }
  }
}
