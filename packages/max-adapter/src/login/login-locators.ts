import type { Locator, Page } from "playwright";

export function phoneMethodButton(page: Page): Locator {
  return page.getByRole("button", {
    name: /sign in with phone number|log in with phone number|войти по номеру телефона/iu
  }).first();
}

export function qrMethodButton(page: Page): Locator {
  return page.getByRole("button", {
    name: /sign in with qr code|log in with qr code|войти по qr-коду/iu
  }).first();
}

export function phoneInput(page: Page): Locator {
  return page.locator([
    'input[autocomplete="tel"]',
    'input[inputmode="tel"]',
    'input[type="tel"]'
  ].join(",")).first();
}

export function codeInput(page: Page): Locator {
  return page.locator([
    'input[autocomplete="one-time-code"]',
    'input[inputmode="numeric"]',
    'input[name*="code" i]'
  ].join(",")).first();
}

export function formSubmitButton(input: Locator): Locator {
  return input.locator("xpath=ancestor::form[1]")
    .locator('button[type="submit"]')
    .first();
}

export function qrVisual(page: Page): Locator {
  const explicitlyLabelled = page
    .locator('img[alt*="qr" i], canvas')
    .first();
  const currentQr = page
    .locator('div[class~="qr"]')
    .first();
  const semanticQrForm = page
    .locator("form")
    .filter({
      hasText: /sign in to max (?:with (?:a )?|via )qr code|log in to max (?:with (?:a )?|via )qr code|войдите в max по qr-коду/iu
    })
    .locator("svg")
    .last();
  return explicitlyLabelled.or(currentQr).or(semanticQrForm).first();
}

export function captchaElement(page: Page): Locator {
  return page.locator([
    'iframe[title*="captcha" i]',
    '[aria-label*="captcha" i]',
    '[data-sitekey]'
  ].join(",")).first();
}

export function authenticatedNavigation(page: Page): Locator {
  return page.getByRole("navigation", {
    name: /chats|чаты/iu
  }).first();
}

export function loginAlert(page: Page): Locator {
  return page.getByRole("alert").first();
}
