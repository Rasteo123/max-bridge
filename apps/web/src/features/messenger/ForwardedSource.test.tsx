// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { MessengerStore } from "./messenger-store.js";
import type { MessengerChat } from "./types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const source = {
  title: "ВСЕ ОТКРЫТКИ ТУТ",
  chatId: "-68429202642371",
  kind: "channel"
} as const;

describe("a channel opened from a forwarded message", () => {
  it("appears in the list straight away, before MAX describes it", () => {
    const store = new MessengerStore();

    store.addTransientChat(source);

    const chat = store.getSnapshot().chats
      .find((entry) => entry.id === source.chatId);
    expect(chat).toMatchObject({
      id: "-68429202642371",
      title: "ВСЕ ОТКРЫТКИ ТУТ",
      kind: "channel"
    });
  });

  it("is not treated as joined until MAX says so", () => {
    const store = new MessengerStore();

    store.addTransientChat(source);

    expect(store.getSnapshot().chats
      .find((entry) => entry.id === source.chatId)?.joined).toBe(false);
  });

  it("takes on the avatar and public address MAX answers with", () => {
    const store = new MessengerStore();
    store.addTransientChat(source);

    store.describeTransientChat({
      id: source.chatId,
      kind: "channel",
      title: "ВСЕ ОТКРЫТКИ ТУТ",
      preview: "",
      timestamp: "2026-08-07T09:00:00.000Z",
      unreadCount: 0,
      muted: false,
      avatarUrl: "https://i.oneme.ru/i?id=synthetic",
      link: "https://max.ru/otkrytki",
      membersCount: 4_210
    });

    expect(store.getSnapshot().chats
      .find((entry) => entry.id === source.chatId)).toMatchObject({
      avatarUrl: "https://i.oneme.ru/i?id=synthetic",
      link: "https://max.ru/otkrytki",
      membersCount: 4_210
    });
  });

  it("leaves a chat the viewer really has alone", () => {
    const store = new MessengerStore();
    const own: MessengerChat = {
      id: "chat-1",
      kind: "direct",
      title: "Вера Алфёрова",
      preview: "Привет",
      timestamp: "2026-08-07T09:00:00.000Z",
      unreadCount: 2,
      muted: false
    };
    store.replaceChats([own]);

    store.describeTransientChat({ ...own, title: "Подменённое имя" });

    expect(store.getSnapshot().chats[0]).toMatchObject({
      title: "Вера Алфёрова",
      unreadCount: 2
    });
  });
});
