// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { ApiClient } from "../../api/client.js";
import { ConnectedMessenger } from "./ConnectedMessenger.js";

const useLiveEventsMock = vi.hoisted(() => vi.fn());
vi.mock("./useLiveEvents.js", () => ({
  useLiveEvents: useLiveEventsMock
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useLiveEventsMock.mockClear();
});

describe("ConnectedMessenger startup", () => {
  it("keeps the chat list available when initial history times out", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      media: "(min-width: 900px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        chats: [{
          id: "0",
          title: "Избранное",
          preview: "",
          timestamp: "2026-07-26T20:00:00.000Z",
          unreadCount: 0,
          muted: false,
          kind: "saved"
        }]
      }))
      .mockResolvedValueOnce(jsonResponse(
        { code: "max_timeout" },
        500
      ));

    render(
      <ConnectedMessenger
        client={new ApiClient(fetcher)}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    expect((await screen.findAllByText("Избранное"))[0]).toBeVisible();
    expect(screen.queryByText("MAX временно недоступен")).toBeNull();
  });

  it("wires activation to one current chat and selected-history refresh", async () => {
    vi.stubGlobal("matchMedia", matchMediaStub);
    const chats = {
      chats: [{
        id: "0",
        title: "Избранное",
        preview: "",
        timestamp: "2026-07-26T20:00:00.000Z",
        unreadCount: 0,
        muted: false,
        kind: "saved"
      }]
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(chats))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(jsonResponse(chats))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }));

    render(
      <ConnectedMessenger
        client={new ApiClient(fetcher)}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    expect((await screen.findAllByText("Избранное"))[0]).toBeVisible();
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    const options = useLiveEventsMock.mock.calls.at(-1)?.[0] as {
      onActivatedRefresh(): Promise<void>;
    };
    await options.onActivatedRefresh();

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.map(([request]) => requestPath(request))).toEqual([
      "/api/chats",
      "/api/chats/0/messages",
      "/api/chats",
      "/api/chats/0/messages"
    ]);
    expect(fetcher.mock.calls.some(([request]) =>
      requestPath(request).includes("read")
    )).toBe(false);
  });

  it("opens a rich forwarded source even when it is absent from the chat list", async () => {
    vi.stubGlobal("matchMedia", wideMatchMediaStub);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(originalChats()))
      .mockResolvedValueOnce(jsonResponse(forwardedHistory()))
      .mockResolvedValueOnce(jsonResponse({
        messages: [{
          id: "source-message",
          chatId: "-68429202642371",
          senderId: "source-user",
          direction: "incoming",
          kind: "text",
          text: "Сообщение источника",
          sentAt: "2026-07-27T10:00:00.000Z",
          status: "delivered"
        }]
      }));

    render(
      <ConnectedMessenger
        client={new ApiClient(fetcher)}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", {
      name: "ВСЕ ОТКРЫТКИ ТУТ"
    }));

    expect(await screen.findByText("Сообщение источника")).toBeVisible();
    expect(fetcher.mock.calls.map(([request]) => requestPath(request))).toEqual([
      "/api/chats",
      "/api/chats/original/messages",
      "/api/chats/-68429202642371/messages"
    ]);
  });

  it("returns to the original chat when a forwarded source is unavailable", async () => {
    vi.stubGlobal("matchMedia", wideMatchMediaStub);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(originalChats()))
      .mockResolvedValueOnce(jsonResponse(forwardedHistory()))
      .mockResolvedValueOnce(jsonResponse(
        { code: "not_found" },
        404
      ));

    render(
      <ConnectedMessenger
        client={new ApiClient(fetcher)}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", {
      name: "ВСЕ ОТКРЫТКИ ТУТ"
    }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось открыть источник пересланного сообщения."
    );
    expect(screen.getByRole("button", {
      name: "ВСЕ ОТКРЫТКИ ТУТ"
    }).closest("article")).toHaveTextContent("Подпись 🌻 открыть");
    expect(screen.getAllByText("Исходный чат").length).toBeGreaterThan(0);
  });

  it("forwards from the selected chat through the strict API route", async () => {
    vi.stubGlobal("matchMedia", wideMatchMediaStub);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        chats: [
          ...originalChats().chats,
          {
            id: "destination",
            title: "Получатель",
            preview: "",
            timestamp: "2026-07-27T09:00:00.000Z",
            unreadCount: 0,
            muted: false,
            kind: "direct"
          }
        ]
      }))
      .mockResolvedValueOnce(jsonResponse(forwardedHistory()))
      .mockResolvedValueOnce(jsonResponse({
        state: "confirmed",
        operationId: "forward-1"
      }));
    render(
      <ConnectedMessenger
        client={new ApiClient(fetcher)}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    const messageLink = await screen.findByRole("link", {
      name: "открыть"
    });
    const sourceMessage = messageLink.closest("article") as HTMLElement;
    fireEvent.contextMenu(sourceMessage);
    fireEvent.click(screen.getByRole("menuitem", {
      name: "Переслать"
    }));
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
    await waitFor(() => {
      expect(document.activeElement).toBe(sourceMessage);
    });

    fireEvent.contextMenu(sourceMessage);
    fireEvent.click(screen.getByRole("menuitem", {
      name: "Переслать"
    }));
    const destination = screen.getAllByRole("checkbox")[1];
    expect(destination).toBeDefined();
    fireEvent.click(destination as Element);
    fireEvent.click(screen.getByRole("button", { name: "Переслать" }));

    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(3);
    });
    expect(requestPath(fetcher.mock.calls[2]?.[0] as RequestInfo)).toBe(
      "/api/chats/original/messages/forwarded-message/forward"
    );
    const requestInit = fetcher.mock.calls[2]?.[1];
    expect(requestInit).toMatchObject({ method: "POST" });
    const requestBody = requestInit?.body;
    if (typeof requestBody !== "string") {
      throw new TypeError("Expected a JSON request body");
    }
    const parsedBody = JSON.parse(requestBody) as unknown as {
      destinationIds?: unknown;
      clientRequestId?: unknown;
    };
    expect(parsedBody.destinationIds).toEqual(["destination"]);
    expect(typeof parsedBody.clientRequestId).toBe("string");
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function matchMediaStub() {
  return {
    matches: false,
    media: "(min-width: 900px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  };
}

function wideMatchMediaStub() {
  return {
    ...matchMediaStub(),
    matches: true
  };
}

function originalChats() {
  return {
    chats: [{
      id: "original",
      title: "Исходный чат",
      preview: "Подпись",
      timestamp: "2026-07-27T09:00:00.000Z",
      unreadCount: 0,
      muted: false,
      kind: "direct"
    }]
  };
}

function forwardedHistory() {
  return {
    messages: [{
      id: "forwarded-message",
      chatId: "original",
      senderId: "other-user",
      direction: "incoming",
      kind: "text",
      text: "Подпись 🌻 открыть",
      textLinks: [{
        offset: 10,
        length: 7,
        url: "https://max.ru/channel/synthetic"
      }],
      sentAt: "2026-07-27T09:01:00.000Z",
      status: "delivered",
      forwardedFrom: "ВСЕ ОТКРЫТКИ ТУТ",
      forwardedSource: {
        title: "ВСЕ ОТКРЫТКИ ТУТ",
        chatId: "-68429202642371",
        kind: "channel"
      }
    }]
  };
}

function requestPath(request: RequestInfo | URL): string {
  if (typeof request === "string") {
    return request;
  }
  return request instanceof URL ? request.href : request.url;
}
