import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { DomainValidationError } from "./errors.js";

export const strictObjectOptions = {
  additionalProperties: false
} as const;

export const isoTimestampOptions = {
  maxLength: 30,
  minLength: 20,
  pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?Z$"
} as const;

export const opaqueIdOptions = {
  maxLength: 512,
  minLength: 1,
  pattern: "^[^\\u0000-\\u001f\\u007f]+$"
} as const;

export function parseSchema<T extends TSchema>(
  schema: T,
  value: unknown
): Static<T> {
  if (!Value.Check(schema, value)) {
    const issues = [...Value.Errors(schema, value)].map((issue) => ({
      path: issue.path,
      message: issue.message
    }));
    throw new DomainValidationError(issues);
  }

  return value;
}
