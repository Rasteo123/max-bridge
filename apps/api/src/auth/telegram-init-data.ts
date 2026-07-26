import {
  createHmac,
  timingSafeEqual
} from "node:crypto";

export type TelegramInitIdentity = Readonly<{
  telegramId: string;
  firstName: string;
  lastName?: string;
  username?: string;
  authDate: number;
}>;

export type TelegramValidationOptions = Readonly<{
  nowSeconds?: number;
  maxAgeSeconds?: number;
  futureToleranceSeconds?: number;
}>;

export class TelegramInitDataError extends Error {
  readonly code = "telegram_init_data_invalid";

  constructor(readonly reason: string) {
    super(`Telegram init data ${reason}`);
    this.name = "TelegramInitDataError";
  }
}

export function validateTelegramInitData(
  rawInitData: string,
  botToken: string,
  options: TelegramValidationOptions = {}
): TelegramInitIdentity {
  if (rawInitData.length === 0 || rawInitData.length > 8192) {
    throw new TelegramInitDataError("has invalid size");
  }
  if (botToken.length === 0) {
    throw new TelegramInitDataError("cannot be verified");
  }

  const params = new URLSearchParams(rawInitData);
  assertNoDuplicateFields(params);
  const suppliedHash = params.get("hash");
  if (suppliedHash === null || !/^[a-f0-9]{64}$/u.test(suppliedHash)) {
    throw new TelegramInitDataError("has invalid hash");
  }

  const checkString = [...params.entries()]
    .filter(([key]) => key !== "hash")
    .sort(([left], [right]) => compareAscii(left, right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData")
    .update(botToken, "utf8")
    .digest();
  const expectedHash = createHmac("sha256", secretKey)
    .update(checkString, "utf8")
    .digest();
  const suppliedHashBytes = Buffer.from(suppliedHash, "hex");
  if (
    suppliedHashBytes.byteLength !== expectedHash.byteLength
    || !timingSafeEqual(suppliedHashBytes, expectedHash)
  ) {
    throw new TelegramInitDataError("signature mismatch");
  }

  const authDate = parseAuthDate(params.get("auth_date"));
  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const maxAgeSeconds = options.maxAgeSeconds ?? 300;
  const futureToleranceSeconds = options.futureToleranceSeconds ?? 30;
  if (authDate > nowSeconds + futureToleranceSeconds) {
    throw new TelegramInitDataError("is from the future");
  }
  if (nowSeconds - authDate > maxAgeSeconds) {
    throw new TelegramInitDataError("has expired");
  }

  return parseSignedUser(params.get("user"), authDate);
}

function assertNoDuplicateFields(params: URLSearchParams): void {
  const seen = new Set<string>();
  for (const [key] of params) {
    if (seen.has(key)) {
      throw new TelegramInitDataError("contains duplicate fields");
    }
    seen.add(key);
  }
}

function parseAuthDate(value: string | null): number {
  if (value === null || !/^\d{1,12}$/u.test(value)) {
    throw new TelegramInitDataError("has invalid auth_date");
  }
  const authDate = Number(value);
  if (!Number.isSafeInteger(authDate) || authDate <= 0) {
    throw new TelegramInitDataError("has invalid auth_date");
  }
  return authDate;
}

function parseSignedUser(
  value: string | null,
  authDate: number
): TelegramInitIdentity {
  if (value === null || value.length > 4096) {
    throw new TelegramInitDataError("has no valid user");
  }

  let user: unknown;
  try {
    user = JSON.parse(value) as unknown;
  } catch {
    throw new TelegramInitDataError("has no valid user");
  }
  if (typeof user !== "object" || user === null) {
    throw new TelegramInitDataError("has no valid user");
  }
  const record = user as Record<string, unknown>;
  if (
    typeof record["id"] !== "number"
    || !Number.isSafeInteger(record["id"])
    || record["id"] <= 0
    || typeof record["first_name"] !== "string"
    || record["first_name"].length === 0
    || record["first_name"].length > 256
  ) {
    throw new TelegramInitDataError("has no valid user");
  }
  const lastName = parseOptionalUserField(record["last_name"]);
  const username = parseOptionalUserField(record["username"]);
  return {
    telegramId: String(record["id"]),
    firstName: record["first_name"],
    ...(lastName === undefined ? {} : { lastName }),
    ...(username === undefined ? {} : { username }),
    authDate
  };
}

function parseOptionalUserField(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0 || value.length > 256) {
    throw new TelegramInitDataError("has no valid user");
  }
  return value;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
