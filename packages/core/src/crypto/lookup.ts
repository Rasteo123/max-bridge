import { createHmac } from "node:crypto";

import { assertKey } from "./envelope.js";
import { CryptoConfigurationError } from "./errors.js";

const TELEGRAM_ID_PATTERN = /^[1-9]\d{0,19}$/u;

export function createUserLookup(
  lookupKey: Uint8Array,
  telegramId: string
): string {
  assertKey(lookupKey);
  if (!TELEGRAM_ID_PATTERN.test(telegramId)) {
    throw new CryptoConfigurationError("Invalid Telegram user id");
  }

  const digest = createHmac("sha256", lookupKey)
    .update(`maxbridge|telegram-user|v1|${telegramId}`, "utf8")
    .digest("base64url");
  return `u_${digest}`;
}
