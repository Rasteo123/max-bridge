import { MaxCompatibilityError } from "./errors.js";

export type WireRecord = Readonly<Record<string, unknown>>;

export function asWireRecord(value: unknown): WireRecord {
  if (
    value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    throw new MaxCompatibilityError();
  }
  return value as WireRecord;
}

export function optionalWireRecord(
  value: unknown
): WireRecord | undefined {
  if (
    value === undefined
    || value === null
    || typeof value !== "object"
    || Array.isArray(value)
  ) {
    return undefined;
  }
  return value as WireRecord;
}

export function readWireArray(
  record: WireRecord,
  ...keys: readonly string[]
): readonly unknown[] | undefined {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      return value.map((item: unknown): unknown => item);
    }
  }
  return undefined;
}

export function readWireString(
  record: WireRecord,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

export function readWireBoolean(
  record: WireRecord,
  ...keys: readonly string[]
): boolean | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "boolean") {
      return value;
    }
  }
  return undefined;
}

export function readWireNumber(
  record: WireRecord,
  ...keys: readonly string[]
): number | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "bigint") {
      const converted = Number(value);
      if (Number.isSafeInteger(converted)) {
        return converted;
      }
    }
  }
  return undefined;
}

export function readOpaqueId(
  record: WireRecord,
  ...keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (
      typeof value === "string"
      || typeof value === "number"
      || typeof value === "bigint"
    ) {
      const normalized = String(value);
      if (
        normalized.length > 0
        && normalized.length <= 512
        && hasNoControlCharacters(normalized)
      ) {
        return normalized;
      }
    }
  }
  return undefined;
}

export function requireOpaqueId(
  record: WireRecord,
  ...keys: readonly string[]
): string {
  const value = readOpaqueId(record, ...keys);
  if (value === undefined) {
    throw new MaxCompatibilityError();
  }
  return value;
}

function hasNoControlCharacters(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      return false;
    }
  }
  return true;
}

export function toIsoTimestamp(value: unknown): string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  let numeric: number | undefined;
  if (typeof value === "number" && Number.isFinite(value)) {
    numeric = value;
  } else if (typeof value === "bigint") {
    const converted = Number(value);
    if (Number.isSafeInteger(converted)) {
      numeric = converted;
    }
  }
  if (numeric === undefined) {
    return new Date(0).toISOString();
  }
  const milliseconds = Math.abs(numeric) < 100_000_000_000
    ? numeric * 1_000
    : numeric;
  const date = new Date(milliseconds);
  return Number.isNaN(date.getTime())
    ? new Date(0).toISOString()
    : date.toISOString();
}

export function boundedText(
  value: string | undefined,
  maxLength: number,
  fallback = ""
): string {
  const selected = value ?? fallback;
  return selected.slice(0, maxLength);
}

export function boundedInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback = minimum
): number {
  if (value === undefined) {
    return fallback;
  }
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}
