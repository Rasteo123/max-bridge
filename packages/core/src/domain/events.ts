import { Type, type Static } from "@sinclair/typebox";

import { ChatSummarySchema } from "./chat.js";
import { MessageSchema } from "./message.js";
import {
  isoTimestampOptions,
  opaqueIdOptions,
  parseSchema,
  strictObjectOptions
} from "./schema.js";

const EventBaseProperties = {
  sequence: Type.Integer({ minimum: 0 }),
  occurredAt: Type.String(isoTimestampOptions)
} as const;

const ChatsSnapshotEventSchema = Type.Object({
  ...EventBaseProperties,
  type: Type.Literal("chats.snapshot"),
  chats: Type.Array(ChatSummarySchema, { maxItems: 10_000 })
}, strictObjectOptions);

const ChatUpsertEventSchema = Type.Object({
  ...EventBaseProperties,
  type: Type.Literal("chat.upsert"),
  chat: ChatSummarySchema
}, strictObjectOptions);

const MessageUpsertEventSchema = Type.Object({
  ...EventBaseProperties,
  type: Type.Literal("message.upsert"),
  message: MessageSchema
}, strictObjectOptions);

const MessageDeletedEventSchema = Type.Object({
  ...EventBaseProperties,
  type: Type.Literal("message.deleted"),
  chatId: Type.String(opaqueIdOptions),
  messageId: Type.String(opaqueIdOptions)
}, strictObjectOptions);

const ConnectionStateEventSchema = Type.Object({
  ...EventBaseProperties,
  type: Type.Literal("connection.state"),
  state: Type.Union([
    Type.Literal("connected"),
    Type.Literal("reconnecting"),
    Type.Literal("disconnected")
  ])
}, strictObjectOptions);

const AuthenticationStateEventSchema = Type.Object({
  ...EventBaseProperties,
  type: Type.Literal("authentication.state"),
  state: Type.Union([
    Type.Literal("active"),
    Type.Literal("reauth_required")
  ])
}, strictObjectOptions);

export const BridgeEventSchema = Type.Union([
  ChatsSnapshotEventSchema,
  ChatUpsertEventSchema,
  MessageUpsertEventSchema,
  MessageDeletedEventSchema,
  ConnectionStateEventSchema,
  AuthenticationStateEventSchema
]);

export type BridgeEvent = Static<typeof BridgeEventSchema>;

export function parseBridgeEvent(value: unknown): BridgeEvent {
  return parseSchema(BridgeEventSchema, value);
}
