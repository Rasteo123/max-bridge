import { Type, type Static } from "@sinclair/typebox";

import { DeliveryStatusSchema } from "./chat.js";
import {
  isoTimestampOptions,
  opaqueIdOptions,
  parseSchema,
  strictObjectOptions
} from "./schema.js";

export const MessageDirectionSchema = Type.Union([
  Type.Literal("incoming"),
  Type.Literal("outgoing")
]);

export const MediaMetadataSchema = Type.Object({
  handle: Type.String(opaqueIdOptions),
  mimeType: Type.String({ minLength: 1, maxLength: 255 }),
  size: Type.Integer({ minimum: 0, maximum: 1_073_741_824 }),
  sourceUrl: Type.Optional(Type.String({ minLength: 1, maxLength: 4_096 })),
  fileName: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  durationMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 86_400_000 })),
  width: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_535 })),
  height: Type.Optional(Type.Integer({ minimum: 1, maximum: 65_535 }))
}, strictObjectOptions);

const MessageBaseProperties = {
  id: Type.String(opaqueIdOptions),
  chatId: Type.String(opaqueIdOptions),
  senderId: Type.String(opaqueIdOptions),
  senderName: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
  direction: MessageDirectionSchema,
  sentAt: Type.String(isoTimestampOptions),
  status: DeliveryStatusSchema,
  replyToId: Type.Optional(Type.String(opaqueIdOptions)),
  edited: Type.Optional(Type.Boolean()),
  deleted: Type.Optional(Type.Boolean())
} as const;

const TextMessageSchema = Type.Object({
  ...MessageBaseProperties,
  kind: Type.Union([Type.Literal("text"), Type.Literal("system")]),
  text: Type.String({ minLength: 1, maxLength: 65_536 })
}, strictObjectOptions);

const MediaMessageSchema = Type.Object({
  ...MessageBaseProperties,
  kind: Type.Union([
    Type.Literal("image"),
    Type.Literal("video"),
    Type.Literal("voice"),
    Type.Literal("file")
  ]),
  media: MediaMetadataSchema,
  text: Type.Optional(Type.String({ maxLength: 65_536 }))
}, strictObjectOptions);

export const MessageSchema = Type.Union([
  TextMessageSchema,
  MediaMessageSchema
]);

export type MessageDirection = Static<typeof MessageDirectionSchema>;
export type MediaMetadata = Static<typeof MediaMetadataSchema>;
export type Message = Static<typeof MessageSchema>;

export function parseMessage(value: unknown): Message {
  return parseSchema(MessageSchema, value);
}
