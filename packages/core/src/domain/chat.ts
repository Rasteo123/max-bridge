import { Type, type Static } from "@sinclair/typebox";

import {
  isoTimestampOptions,
  opaqueIdOptions,
  parseSchema,
  strictObjectOptions
} from "./schema.js";

export const ChatKindSchema = Type.Union([
  Type.Literal("direct"),
  Type.Literal("group"),
  Type.Literal("channel")
]);

export const DeliveryStatusSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("sent"),
  Type.Literal("delivered"),
  Type.Literal("read"),
  Type.Literal("failed")
]);

export const PresenceSchema = Type.Union([
  Type.Literal("online"),
  Type.Literal("offline"),
  Type.Literal("recently"),
  Type.Literal("long_ago"),
  Type.Literal("unknown")
]);

export const LastMessageDirectionSchema = Type.Union([
  Type.Literal("incoming"),
  Type.Literal("outgoing")
]);

export const CHAT_ACTIONS = [
  "pin",
  "unpin",
  "mark_unread",
  "mute",
  "unmute",
  "clear",
  "delete"
] as const;

export const ChatActionSchema = Type.Union(
  CHAT_ACTIONS.map((action) => Type.Literal(action))
);

export const ChatSummarySchema = Type.Object({
  id: Type.String(opaqueIdOptions),
  kind: ChatKindSchema,
  title: Type.String({ minLength: 1, maxLength: 256 }),
  preview: Type.String({ maxLength: 2048 }),
  timestamp: Type.String(isoTimestampOptions),
  unreadCount: Type.Integer({ minimum: 0, maximum: 9999 }),
  muted: Type.Boolean(),
  pinned: Type.Optional(Type.Boolean()),
  avatarHandle: Type.Optional(Type.String(opaqueIdOptions)),
  avatarUrl: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 2048,
    pattern: "^https://i\\.oneme\\.ru(?:/|$)"
  })),
  // MAX marks official accounts and channels with a badge beside the name.
  verified: Type.Optional(Type.Boolean()),
  // The public max.ru address of the contact or channel, when it has one.
  link: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 2048,
    pattern: "^https://max\\.ru/"
  })),
  presence: Type.Optional(PresenceSchema),
  lastSeenAt: Type.Optional(Type.Integer({
    minimum: 946_684_800_000,
    maximum: 4_102_444_800_000
  })),
  lastMessageDirection: Type.Optional(LastMessageDirectionSchema),
  deliveryStatus: Type.Optional(DeliveryStatusSchema)
}, strictObjectOptions);

export type ChatKind = Static<typeof ChatKindSchema>;
export type ChatAction = Static<typeof ChatActionSchema>;
export type DeliveryStatus = Static<typeof DeliveryStatusSchema>;
export type Presence = Static<typeof PresenceSchema>;
export type LastMessageDirection = Static<typeof LastMessageDirectionSchema>;
export type ChatSummary = Static<typeof ChatSummarySchema>;

export function parseChatSummary(value: unknown): ChatSummary {
  return parseSchema(ChatSummarySchema, value);
}
