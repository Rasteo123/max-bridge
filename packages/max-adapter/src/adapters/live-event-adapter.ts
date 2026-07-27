import {
  parseBridgeEvent,
  type BridgeEvent
} from "@maxbridge/core";

import {
  adaptWireMessage,
  type MessageAdapterContext
} from "./history-adapter.js";
import type { RuntimeMediaAdapter } from "./media-adapter.js";
import {
  asWireRecord,
  readOpaqueId,
  readWireArray,
  readWireBoolean,
  requireOpaqueId,
  toIsoTimestamp
} from "./wire-values.js";
import { MaxCompatibilityError } from "./errors.js";

export class LiveEventAdapter {
  private readonly context: Omit<MessageAdapterContext, "chatId">;
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly maxSeen: number;
  private sequence = 0;
  private cursor: string | undefined;

  constructor(options: Readonly<{
    viewerId: string;
    media: RuntimeMediaAdapter;
    maxSeen?: number;
  }>) {
    this.context = {
      viewerId: options.viewerId,
      media: options.media
    };
    this.maxSeen = Math.max(1, options.maxSeen ?? 2_048);
  }

  get reconnectCursor(): string | undefined {
    return this.cursor;
  }

  adapt(payload: unknown): readonly BridgeEvent[] {
    const root = asWireRecord(payload);
    this.updateCursor(root);

    const singleMessage = root["message"];
    if (singleMessage !== undefined) {
      return this.adaptMessages(
        [singleMessage],
        requireOpaqueId(root, "chatId", "id")
      );
    }
    const messages = readWireArray(root, "messages");
    if (messages !== undefined) {
      const chatId = readOpaqueId(root, "chatId");
      return messages.flatMap((message) => {
        const messageRecord = asWireRecord(message);
        const resolvedChatId = chatId
          ?? requireOpaqueId(messageRecord, "chatId");
        return this.adaptMessages([message], resolvedChatId);
      });
    }

    const messageId = readOpaqueId(root, "messageId");
    if (
      messageId !== undefined
      && readWireBoolean(root, "deleted", "isDeleted") === true
    ) {
      const chatId = requireOpaqueId(root, "chatId");
      const identity = `delete:${chatId}:${messageId}`;
      if (!this.markSeen(identity)) {
        return [];
      }
      return [parseBridgeEvent({
        sequence: this.nextSequence(),
        occurredAt: new Date().toISOString(),
        type: "message.deleted",
        chatId,
        messageId
      })];
    }
    throw new MaxCompatibilityError();
  }

  clear(): void {
    this.seen.clear();
    this.seenOrder.length = 0;
    this.cursor = undefined;
  }

  private adaptMessages(
    messages: readonly unknown[],
    chatId: string
  ): readonly BridgeEvent[] {
    const output: BridgeEvent[] = [];
    for (const value of messages) {
      const messageRecord = asWireRecord(value);
      const messageId = requireOpaqueId(
        messageRecord,
        "id",
        "messageId",
        "cid"
      );
      const revision = readOpaqueId(
        messageRecord,
        "updateTime",
        "editTime",
        "time"
      ) ?? "0";
      const reactions = reactionRevision(messageRecord);
      if (!this.markSeen(
        `upsert:${chatId}:${messageId}:${revision}:${reactions}`
      )) {
        continue;
      }
      const message = adaptWireMessage(value, {
        ...this.context,
        chatId
      });
      output.push(parseBridgeEvent({
        sequence: this.nextSequence(),
        occurredAt: toIsoTimestamp(messageRecord["time"]),
        type: "message.upsert",
        message
      }));
    }
    return output;
  }

  private updateCursor(root: Readonly<Record<string, unknown>>): void {
    const cursor = readOpaqueId(root, "mark", "cursor", "sequence");
    if (cursor !== undefined) {
      this.cursor = cursor;
    }
  }

  private markSeen(identity: string): boolean {
    if (this.seen.has(identity)) {
      return false;
    }
    this.seen.add(identity);
    this.seenOrder.push(identity);
    while (this.seenOrder.length > this.maxSeen) {
      const oldest = this.seenOrder.shift();
      if (oldest !== undefined) {
        this.seen.delete(oldest);
      }
    }
    return true;
  }

  private nextSequence(): number {
    const value = this.sequence;
    this.sequence += 1;
    return value;
  }
}

function reactionRevision(message: Readonly<Record<string, unknown>>): string {
  const values = readWireArray(message, "reactions", "reactionSummary") ?? [];
  return values.slice(0, 32).map((value) => {
    const reaction = asWireRecord(value);
    return [
      reactionRevisionValue(reaction["key"] ?? reaction["type"]),
      reactionRevisionValue(reaction["count"] ?? reaction["total"]),
      reaction["selectedByMe"] === true || reaction["mine"] === true
        ? "mine"
        : ""
    ].join(":");
  }).join(",");
}

function reactionRevisionValue(value: unknown): string {
  return typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
    ? String(value)
    : "";
}
