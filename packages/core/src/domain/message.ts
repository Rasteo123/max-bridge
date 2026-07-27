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

export const REACTION_KEYS = [
  "like",
  "heart",
  "laugh",
  "fire",
  "cry",
  "celebrate"
] as const;

export const ReactionKeySchema = Type.Union(
  REACTION_KEYS.map((key) => Type.Literal(key))
);

export const MessageReactionSchema = Type.Object({
  key: ReactionKeySchema,
  emoji: Type.String({ minLength: 1, maxLength: 32 }),
  count: Type.Integer({ minimum: 1, maximum: 999_999 }),
  selectedByMe: Type.Boolean()
}, strictObjectOptions);

export const StickerSummarySchema = Type.Object({
  id: Type.String(opaqueIdOptions),
  previewDataUrl: Type.String({
    minLength: 32,
    maxLength: 40 * 1024,
    pattern: "^data:image/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$"
  })
}, strictObjectOptions);

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

export const ForwardedSourceSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 256 }),
  chatId: Type.String(opaqueIdOptions),
  kind: Type.Union([
    Type.Literal("direct"),
    Type.Literal("group"),
    Type.Literal("channel")
  ])
}, strictObjectOptions);

export const MessageTextLinkSchema = Type.Object({
  offset: Type.Integer({ minimum: 0, maximum: 65_536 }),
  length: Type.Integer({ minimum: 1, maximum: 65_536 }),
  url: Type.String({
    minLength: 9,
    maxLength: 4_096,
    pattern: "^https://(?![^/?#]*@)[A-Za-z0-9.-]+(?::[0-9]{1,5})?(?:[/?:#][^\\s]*)?$"
  })
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
  forwardedFrom: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 256
  })),
  forwardedSource: Type.Optional(ForwardedSourceSchema),
  textLinks: Type.Optional(Type.Array(
    MessageTextLinkSchema,
    { maxItems: 64 }
  )),
  edited: Type.Optional(Type.Boolean()),
  deleted: Type.Optional(Type.Boolean()),
  reactions: Type.Optional(Type.Array(
    MessageReactionSchema,
    { maxItems: REACTION_KEYS.length }
  ))
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

const UnsupportedMessageSchema = Type.Object({
  ...MessageBaseProperties,
  kind: Type.Literal("unsupported"),
  text: Type.String({ minLength: 1, maxLength: 65_536 }),
  attachmentType: Type.Optional(Type.String({
    minLength: 1,
    maxLength: 64
  }))
}, strictObjectOptions);

export const MessageSchema = Type.Union([
  TextMessageSchema,
  MediaMessageSchema,
  UnsupportedMessageSchema
]);

export type MessageDirection = Static<typeof MessageDirectionSchema>;
export type ReactionKey = Static<typeof ReactionKeySchema>;
export type MessageReaction = Static<typeof MessageReactionSchema>;
export type StickerSummary = Static<typeof StickerSummarySchema>;
export type MediaMetadata = Static<typeof MediaMetadataSchema>;
export type ForwardedSource = Static<typeof ForwardedSourceSchema>;
export type MessageTextLink = Static<typeof MessageTextLinkSchema>;
export type Message = Static<typeof MessageSchema>;

export function parseMessage(value: unknown): Message {
  return parseSchema(MessageSchema, value);
}

export function parseStickerSummary(value: unknown): StickerSummary {
  return parseSchema(StickerSummarySchema, value);
}
