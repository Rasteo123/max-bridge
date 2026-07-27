// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import type { AuthClient } from "../auth/AuthGate.js";
import type {
  TelegramEvent,
  TelegramWebApp
} from "../auth/telegram.js";
import { MediaMessage } from "./MediaMessage.js";
import { MessengerStore } from "./messenger-store.js";
import type {
  MessengerChat,
  MessengerEvent,
  MessengerMessage
} from "./types.js";
import { useLiveEvents } from "./useLiveEvents.js";

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

describe("Telegram live-event lifecycle", () => {
  it("pauses while inactive and refreshes exactly once after current-data auth", async () => {
    const telegram = telegramLifecycleStub();
    const sockets: LiveFakeSocket[] = [];
    const store = new MessengerStore();
    const authenticateTelegram = vi.fn().mockResolvedValue(undefined);
    const refreshCurrentData = vi.fn().mockResolvedValue(undefined);
    const markRead = vi.fn();

    const view = render(
      <LiveEventsHarness
        store={store}
        client={{ authenticateTelegram, markRead }}
        telegram={telegram.webApp}
        createSocket={() => {
          const socket = new LiveFakeSocket();
          sockets.push(socket);
          return socket as unknown as WebSocket;
        }}
        onActivatedRefresh={refreshCurrentData}
      />
    );

    expect(sockets).toHaveLength(1);
    act(() => {
      telegram.emit("deactivated");
    });
    expect(sockets[0]?.close).toHaveBeenCalledWith(1_000, "client_pause");
    expect(store.getSnapshot().connection).toBe("disconnected");

    telegram.setInitData("new-current-signed-data");
    await act(async () => {
      telegram.emit("activated");
      telegram.emit("activated");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(sockets).toHaveLength(2);
    });

    expect(authenticateTelegram).toHaveBeenCalledTimes(1);
    expect(authenticateTelegram).toHaveBeenCalledWith(
      "new-current-signed-data"
    );
    expect(refreshCurrentData).toHaveBeenCalledTimes(1);
    expect(markRead).not.toHaveBeenCalled();

    view.unmount();
    expect(telegram.offEvent).toHaveBeenCalledWith(
      "activated",
      telegram.callbacks.get("activated")
    );
    expect(telegram.offEvent).toHaveBeenCalledWith(
      "deactivated",
      telegram.callbacks.get("deactivated")
    );
  });

  it("does not connect while Telegram reports the Mini App inactive", async () => {
    const telegram = telegramLifecycleStub(false);
    const createSocket = vi.fn(() =>
      new LiveFakeSocket() as unknown as WebSocket
    );
    const authenticateTelegram = vi.fn().mockResolvedValue(undefined);

    render(
      <LiveEventsHarness
        store={new MessengerStore()}
        client={{ authenticateTelegram }}
        telegram={telegram.webApp}
        createSocket={createSocket}
        onActivatedRefresh={vi.fn()}
      />
    );

    expect(createSocket).not.toHaveBeenCalled();
    await act(async () => {
      telegram.setActive(true);
      telegram.emit("activated");
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(createSocket).toHaveBeenCalledTimes(1);
    });
    expect(authenticateTelegram).toHaveBeenCalledTimes(1);
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

type LiveEventsHarnessProps = Readonly<{
  store: MessengerStore;
  client: Pick<AuthClient, "authenticateTelegram"> &
    Readonly<{ markRead?: () => void }>;
  telegram: TelegramWebApp;
  createSocket: (url: string) => WebSocket;
  onActivatedRefresh(): Promise<void>;
}>;

function LiveEventsHarness(props: LiveEventsHarnessProps) {
  useLiveEvents(props);
  return null;
}

function telegramLifecycleStub(initiallyActive = true) {
  let initData = "initial-signed-data";
  let active = initiallyActive;
  const callbacks = new Map<TelegramEvent, () => void>();
  const offEvent = vi.fn();
  const webApp: TelegramWebApp = {
    get initData() {
      return initData;
    },
    get isActive() {
      return active;
    },
    themeParams: {},
    ready: vi.fn(),
    expand: vi.fn(),
    onEvent(event, callback) {
      callbacks.set(event, callback);
    },
    offEvent
  };
  return {
    webApp,
    callbacks,
    offEvent,
    emit(event: TelegramEvent) {
      callbacks.get(event)?.();
    },
    setInitData(value: string) {
      initData = value;
    },
    setActive(value: boolean) {
      active = value;
    }
  };
}

class LiveFakeSocket {
  addEventListener(): void {}
  close = vi.fn();
}
