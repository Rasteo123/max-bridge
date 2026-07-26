import type { Page } from "playwright";

import {
  authenticatedNavigation,
  captchaElement,
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

    const input = phoneInput(this.page);
    if (!await this.isVisible(input)) {
      const method = phoneMethodButton(this.page);
      if (!await this.isVisible(method)) {
        return { state: "failed" };
      }
      await method.click();
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

  async submitCode(code: string): Promise<MaxLoginResult> {
    if (!/^\d{4,8}$/u.test(code)) {
      return { state: "invalid_code" };
    }
    const input = codeInput(this.page);
    if (!await this.isVisible(input)) {
      return this.detectState();
    }
    await input.fill(code);
    await formSubmitButton(input).click();
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
        throw new Error("QR login is unavailable");
      }
      await method.click();
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
      if (expected.includes(result.state)) {
        return result;
      }
      await this.page.waitForTimeout(25);
    }
    return { state: "failed" };
  }

  private async isVisible(locator: ReturnType<typeof phoneInput>): Promise<boolean> {
    try {
      return await locator.isVisible({ timeout: 50 });
    } catch {
      return false;
    }
  }
}
