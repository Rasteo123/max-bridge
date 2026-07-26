import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  TelegramInitDataError,
  validateTelegramInitData
} from "./telegram-init-data.js";

const botToken = "123456:synthetic_bot_token";
const nowSeconds = 1_774_700_000;

describe("validateTelegramInitData", () => {
  it("validates Telegram HMAC and returns the signed user", () => {
    const raw = createSignedInitData({
      auth_date: String(nowSeconds - 30),
      query_id: "synthetic-query",
      user: JSON.stringify({
        id: 123456789,
        first_name: "Синтетический",
        username: "synthetic_user"
      })
    });

    expect(validateTelegramInitData(raw, botToken, {
      nowSeconds,
      maxAgeSeconds: 300
    })).toEqual({
      telegramId: "123456789",
      firstName: "Синтетический",
      username: "synthetic_user",
      authDate: nowSeconds - 30
    });
  });

  it("rejects changed user data", () => {
    const raw = createSignedInitData({
      auth_date: String(nowSeconds),
      user: JSON.stringify({
        id: 123456789,
        first_name: "Original"
      })
    }).replace("Original", "Changed");

    expect(() => validateTelegramInitData(raw, botToken, {
      nowSeconds,
      maxAgeSeconds: 300
    })).toThrow(TelegramInitDataError);
  });

  it("rejects data older than five minutes", () => {
    const raw = createSignedInitData({
      auth_date: String(nowSeconds - 301),
      user: JSON.stringify({ id: 123456789, first_name: "Synthetic" })
    });

    expect(() => validateTelegramInitData(raw, botToken, {
      nowSeconds,
      maxAgeSeconds: 300
    })).toThrow("expired");
  });

  it("rejects data too far in the future", () => {
    const raw = createSignedInitData({
      auth_date: String(nowSeconds + 31),
      user: JSON.stringify({ id: 123456789, first_name: "Synthetic" })
    });

    expect(() => validateTelegramInitData(raw, botToken, {
      nowSeconds,
      maxAgeSeconds: 300
    })).toThrow("future");
  });

  it("rejects duplicate signed fields", () => {
    const raw = createSignedInitData({
      auth_date: String(nowSeconds),
      user: JSON.stringify({ id: 123456789, first_name: "Synthetic" })
    });

    expect(() => validateTelegramInitData(
      `${raw}&auth_date=${String(nowSeconds)}`,
      botToken,
      { nowSeconds, maxAgeSeconds: 300 }
    )).toThrow("duplicate");
  });

  it("rejects missing signed user data", () => {
    const raw = createSignedInitData({
      auth_date: String(nowSeconds)
    });

    expect(() => validateTelegramInitData(raw, botToken, {
      nowSeconds,
      maxAgeSeconds: 300
    })).toThrow("user");
  });
});

function createSignedInitData(
  fields: Readonly<Record<string, string>>
): string {
  const dataCheckString = Object.entries(fields)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData")
    .update(botToken)
    .digest();
  const hash = createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");
  const params = new URLSearchParams(fields);
  params.set("hash", hash);
  return params.toString();
}
