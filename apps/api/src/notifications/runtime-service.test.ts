import { describe, expect, it, vi } from "vitest";

import type {
  BridgeEvent,
  ChatSummary,
  UserRecord
} from "@maxbridge/core";

import {
  RuntimeNotificationService,
  type RuntimeNotificationSource,
  type RuntimeNotificationUsers
} from "./runtime-service.js";

describe("RuntimeNotificationService", () => {
  it("opens active MAX sessions and forwards incoming messages to Telegram", async () => {
    const source = new FakeSource();
    const handle = vi.fn().mockResolvedValue(undefined);
    const service = new RuntimeNotificationService({
      source,
      users: activeUsers(),
      router: { handle }
    });

    await service.start();
    source.emit(messageEvent("incoming"));
    await vi.waitFor(() => {
      expect(handle).toHaveBeenCalledWith(expect.objectContaining({
        telegramId: "123456789",
        senderName: "Алексей",
        body: "Привет"
      }));
    });

    expect(source.list).toHaveBeenCalledWith("u_AbCdEfGhIjKlMnOpQrStUv");
    service.stop();
  });

  it("does not notify about outgoing or system messages", async () => {
    const source = new FakeSource();
    const handle = vi.fn().mockResolvedValue(undefined);
    const service = new RuntimeNotificationService({
      source,
      users: activeUsers(),
      router: { handle }
    });

    await service.start();
    source.emit(messageEvent("outgoing"));
    source.emit({
      ...messageEvent("incoming"),
      message: {
        ...messageEvent("incoming").message,
        kind: "system",
        text: "Системное"
      }
    });
    await Promise.resolve();

    expect(handle).not.toHaveBeenCalled();
    service.stop();
  });
});

class FakeSource implements RuntimeNotificationSource {
  private listener:
    ((userLookup: string, event: BridgeEvent) => void) | undefined;

  readonly list = vi.fn().mockResolvedValue([
    chat()
  ] satisfies readonly ChatSummary[]);

  subscribeAll(
    listener: (userLookup: string, event: BridgeEvent) => void
  ): () => void {
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  emit(event: BridgeEvent): void {
    this.listener?.("u_AbCdEfGhIjKlMnOpQrStUv", event);
  }
}

function activeUsers(): RuntimeNotificationUsers {
  return {
    listUsersByState: () => [{
      lookupId: "u_AbCdEfGhIjKlMnOpQrStUv",
      state: "active",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    } satisfies UserRecord],
    findIdentityByLookup: vi.fn().mockResolvedValue({
      telegramId: "123456789"
    })
  };
}

function chat(): ChatSummary {
  return {
    id: "chat-1",
    title: "Алексей",
    preview: "",
    timestamp: "2026-07-26T19:00:00.000Z",
    unreadCount: 0,
    muted: false,
    kind: "direct"
  };
}

function messageEvent(
  direction: "incoming" | "outgoing"
): Extract<BridgeEvent, { type: "message.upsert" }> {
  return {
    type: "message.upsert",
    sequence: 7,
    occurredAt: "2026-07-26T19:00:00.000Z",
    message: {
      id: "message-1",
      chatId: "chat-1",
      senderId: "contact-1",
      direction,
      sentAt: "2026-07-26T19:00:00.000Z",
      status: "delivered",
      kind: "text",
      text: "Привет"
    }
  };
}
