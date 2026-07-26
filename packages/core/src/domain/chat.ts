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

export const ChatSummarySchema = Type.Object({
  id: Type.String(opaqueIdOptions),
  kind: ChatKindSchema,
  title: Type.String({ minLength: 1, maxLength: 256 }),
  preview: Type.String({ maxLength: 2048 }),
  timestamp: Type.String(isoTimestampOptions),
  unreadCount: Type.Integer({ minimum: 0, maximum: 9999 }),
  muted: Type.Boolean(),
  avatarHandle: Type.Optional(Type.String(opaqueIdOptions)),
  avatarUrl: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 2048,
    format: "uri"
  })),
  deliveryStatus: Type.Optional(DeliveryStatusSchema)
}, strictObjectOptions);

export type ChatKind = Static<typeof ChatKindSchema>;
export type DeliveryStatus = Static<typeof DeliveryStatusSchema>;
export type ChatSummary = Static<typeof ChatSummarySchema>;

export function parseChatSummary(value: unknown): ChatSummary {
  return parseSchema(ChatSummarySchema, value);
}
