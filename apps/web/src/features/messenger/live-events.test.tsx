// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { MediaMessage } from "./MediaMessage.js";
import { MessengerStore } from "./messenger-store.js";
import type {
  MessengerChat,
  MessengerEvent,
  MessengerMessage
} from "./types.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("MessengerStore", () => {
  it("merges paginated history and live events without duplicates", () => {
    const store = new MessengerStore();
    store.replaceChats([chat()]);
    store.selectChat("chat-1");
    store.mergeHistory([message("m2", "Второе"), message("m1", "Первое")]);
    store.mergeHistory([message("m1", "Первое")]);
    store.applyEvent(messageEvent(message("m2", "Второе")));
    store.applyEvent(messageEvent(message("m3", "Третье")));

    expect(store.getSnapshot().messages.map((item) => item.id))
      .toEqual(["m1", "m2", "m3"]);
  });

  it("updates unread counts but clears the currently open chat", () => {
    const store = new MessengerStore();
    store.replaceChats([
      chat(),
      { ...chat(), id: "chat-2", title: "Друзья", unreadCount: 1 }
    ]);
    store.selectChat("chat-1");

    store.applyEvent(messageEvent({
      ...message("m4", "В открытом чате"),
      chatId: "chat-1"
    }));
    store.applyEvent(messageEvent({
      ...message("m5", "В другом чате"),
      chatId: "chat-2"
    }));

    expect(store.getSnapshot().chats.find((item) => item.id === "chat-1")
      ?.unreadCount).toBe(0);
    expect(store.getSnapshot().chats.find((item) => item.id === "chat-2")
      ?.unreadCount).toBe(2);
  });

  it("exposes reconnect state without persisting browser storage", () => {
    const store = new MessengerStore();
    store.applyEvent({
      type: "connection.state",
      sequence: 4,
      occurredAt: "2026-07-26T15:00:00.000Z",
      state: "reconnecting"
    });

    expect(store.getSnapshot().connection).toBe("reconnecting");
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });
});

describe("MediaMessage", () => {
  it("uses a short-lived same-origin URL and revokes the object URL", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(new Blob(["image"]), {
        status: 200,
        headers: { "content-type": "image/png" }
      })
    );
    const createObjectURL = vi.fn(() => "blob:local-preview");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    vi.stubGlobal("URL", {
      createObjectURL,
      revokeObjectURL
    });

    const view = render(
      <MediaMessage
        kind="image"
        media={{
          handle: "media-safe_123",
          mimeType: "image/png",
          size: 5
        }}
      />
    );

    expect(fetcher).toHaveBeenCalledWith(
      "/api/media/media-safe_123",
      expect.objectContaining({
        credentials: "include",
        cache: "no-store"
      })
    );
    expect(await screen.findByRole("img", {
      name: "Изображение"
    })).toHaveAttribute("src", "blob:local-preview");

    view.unmount();
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:local-preview");
    });
  });
});

function chat(): MessengerChat {
  return {
    id: "chat-1",
    title: "Алексей",
    preview: "Привет",
    timestamp: "2026-07-26T13:40:00.000Z",
    unreadCount: 2,
    muted: false,
    kind: "direct"
  };
}

function message(id: string, text: string): MessengerMessage {
  return {
    id,
    chatId: "chat-1",
    kind: "text",
    text,
    direction: "incoming",
    sentAt: `2026-07-26T13:4${id.slice(-1)}:00.000Z`,
    formattedTime: "13:40"
  };
}

function messageEvent(messageValue: MessengerMessage): MessengerEvent {
  return {
    type: "message.upsert",
    sequence: Number(messageValue.id.slice(-1)),
    occurredAt: "2026-07-26T15:00:00.000Z",
    message: messageValue
  };
}
