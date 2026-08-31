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

  it("keeps delivering after the worker restarts its sequence counter", () => {
    const deduplicator = new NotificationDeduplicator();
    expect(deduplicator.accept("user-1", 5_000, "message-old")).toBe(true);

    // The counter lives in the worker process and starts over with it, so a
    // sequence below the cursor means a new epoch, not a replay. Dropping
    // these silenced every notification until the counter caught up again.
    expect(deduplicator.accept("user-1", 1, "message-new")).toBe(true);
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

describe("muted chats", () => {
  it("stays quiet about a chat muted in MAX itself", async () => {
    const sent: unknown[] = [];
    const router = new NotificationRouter({
      transport: {
        send: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve()
      },
      settings: {
        load: () => Promise.resolve({
          enabled: true,
          mutedChatIds: [],
          previewChatIds: []
        })
      },
      deduplicator: new NotificationDeduplicator()
    });

    await router.handle({
      userLookup: "u_0123456789abcdef",
      telegramId: "4242",
      sequence: 1,
      messageId: "message-1",
      chatId: "chat-1",
      senderName: "Канал",
      kind: "text",
      chatMuted: true
    });

    expect(sent).toEqual([]);
  });

  it("stays quiet about a chat muted for the bot alone", async () => {
    const sent: unknown[] = [];
    const router = new NotificationRouter({
      transport: {
        send: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve()
      },
      settings: {
        load: () => Promise.resolve({
          enabled: true,
          mutedChatIds: ["chat-1"],
          previewChatIds: []
        })
      },
      deduplicator: new NotificationDeduplicator()
    });

    await router.handle({
      userLookup: "u_0123456789abcdef",
      telegramId: "4242",
      sequence: 1,
      messageId: "message-1",
      chatId: "chat-1",
      senderName: "Канал",
      kind: "text"
    });

    expect(sent).toEqual([]);
  });

  it("still notifies about a chat that is not muted anywhere", async () => {
    const sent: { chatId: string; text: string }[] = [];
    const router = new NotificationRouter({
      transport: {
        send: (message) => {
          sent.push(message);
          return Promise.resolve();
        },
        answerCallback: () => Promise.resolve()
      },
      settings: {
        load: () => Promise.resolve({
          enabled: true,
          mutedChatIds: ["chat-2"],
          previewChatIds: []
        })
      },
      deduplicator: new NotificationDeduplicator()
    });

    await router.handle({
      userLookup: "u_0123456789abcdef",
      telegramId: "4242",
      sequence: 1,
      messageId: "message-1",
      chatId: "chat-1",
      senderName: "Вера",
      kind: "text",
      chatMuted: false
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.text).toContain("Вера");
  });
});
