import { describe, expect, it, vi } from "vitest";

import type { BotTransport } from "../bot/contracts.js";
import { NotificationDeduplicator } from "./deduplicator.js";
import {
  NotificationRouter,
  type NotificationEvent,
  type NotificationSettings
} from "./router.js";

describe("NotificationRouter", () => {
  it("omits message bodies and media by default", async () => {
    const { router, transport } = createRouter(defaultSettings());

    await router.handle(event({
      body: "CANARY_PRIVATE_BODY",
      mediaUrl: "https://private.invalid/CANARY_MEDIA"
    }));

    const sent = transport.send.mock.calls[0]?.[0];
    expect(sent?.text).toBe("Вам пришло сообщение от Алексей");
    expect(JSON.stringify(sent)).not.toContain("CANARY_PRIVATE_BODY");
    expect(JSON.stringify(sent)).not.toContain("CANARY_MEDIA");
  });

  it("includes a bounded preview only after per-chat opt-in", async () => {
    const { router, transport } = createRouter({
      ...defaultSettings(),
      previewChatIds: ["chat-1"]
    });

    await router.handle(event({ body: "Короткий приватный текст" }));

    expect(transport.send.mock.calls[0]?.[0]?.text)
      .toContain("Короткий приватный текст");
  });

  it("does not push a muted chat", async () => {
    const { router, transport } = createRouter({
      ...defaultSettings(),
      mutedChatIds: ["chat-1"]
    });

    await router.handle(event());

    expect(transport.send).not.toHaveBeenCalled();
  });

  it("restores numeric cursors and suppresses an obvious duplicate", () => {
    const first = new NotificationDeduplicator();
    expect(first.accept("user-1", 42, "message-1")).toBe(true);
    const restored = new NotificationDeduplicator(first.snapshotCursors());

    expect(restored.accept("user-1", 42, "message-1")).toBe(false);
    expect(JSON.stringify(restored.snapshotCursors()))
      .not.toContain("message-1");
  });
});

function createRouter(settings: NotificationSettings) {
  const transport = {
    send: vi.fn<BotTransport["send"]>().mockResolvedValue(undefined),
    answerCallback: vi.fn<BotTransport["answerCallback"]>()
      .mockResolvedValue(undefined)
  };
  return {
    transport,
    router: new NotificationRouter({
      transport,
      settings: {
        load: vi.fn().mockResolvedValue(settings)
      },
      deduplicator: new NotificationDeduplicator()
    })
  };
}

function defaultSettings(): NotificationSettings {
  return {
    enabled: true,
    mutedChatIds: [],
    previewChatIds: []
  };
}

function event(
  overrides: Partial<NotificationEvent> = {}
): NotificationEvent {
  return {
    userLookup: "user-1",
    telegramId: "123456789",
    sequence: 1,
    messageId: "message-1",
    chatId: "chat-1",
    senderName: "Алексей",
    kind: "text" as const,
    body: "Секретное сообщение",
    ...overrides
  };
}
