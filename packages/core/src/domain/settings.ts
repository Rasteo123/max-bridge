import { Type, type Static } from "@sinclair/typebox";

import { ChatSummarySchema } from "./chat.js";
import {
  isoTimestampOptions,
  parseSchema,
  strictObjectOptions
} from "./schema.js";

/**
 * One signed-in device, as MAX lists them under "Устройства". The location
 * string is whatever MAX itself shows the account owner, including the IP it
 * saw; it is only ever sent back to that same owner.
 */
export const DeviceSessionSchema = Type.Object({
  client: Type.String({ minLength: 1, maxLength: 64 }),
  info: Type.String({ maxLength: 128 }),
  location: Type.String({ maxLength: 256 }),
  seenAt: Type.String(isoTimestampOptions),
  current: Type.Boolean()
}, strictObjectOptions);

export const AccountProfileSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 256 }),
  avatarUrl: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 2048,
    pattern: "^https://i\\.oneme\\.ru(?:/|$)"
  })),
  description: Type.Optional(Type.String({ maxLength: 512 })),
  link: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 2048,
    pattern: "^https://max\\.ru/"
  }))
}, strictObjectOptions);

export const AccountSettingsSchema = Type.Object({
  profile: AccountProfileSchema,
  sessions: Type.Array(DeviceSessionSchema, { maxItems: 64 }),
  blocked: Type.Array(ChatSummarySchema, { maxItems: 256 })
}, strictObjectOptions);

export type DeviceSession = Static<typeof DeviceSessionSchema>;
export type AccountProfile = Static<typeof AccountProfileSchema>;
export type AccountSettings = Static<typeof AccountSettingsSchema>;

export function parseAccountSettings(value: unknown): AccountSettings {
  return parseSchema(AccountSettingsSchema, value);
}
