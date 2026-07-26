import { Type, type Static } from "@sinclair/typebox";

import {
  isoTimestampOptions,
  opaqueIdOptions,
  parseSchema,
  strictObjectOptions
} from "./schema.js";

export const USER_STATES = [
  "pending",
  "approved_unbound",
  "authenticating",
  "active",
  "reauth_required",
  "disabled",
  "deleted"
] as const;

export const UserStateSchema = Type.Union(
  USER_STATES.map((state) => Type.Literal(state))
);

export const UserRecordSchema = Type.Object({
  lookupId: Type.String(opaqueIdOptions),
  state: UserStateSchema,
  createdAt: Type.String(isoTimestampOptions),
  updatedAt: Type.String(isoTimestampOptions)
}, strictObjectOptions);

export type UserState = Static<typeof UserStateSchema>;
export type UserRecord = Static<typeof UserRecordSchema>;

export function parseUserRecord(value: unknown): UserRecord {
  return parseSchema(UserRecordSchema, value);
}
