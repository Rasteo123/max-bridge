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
        client={new ApiClient(withNotifications(fetcher))}
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
        client={new ApiClient(withNotifications(fetcher))}
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
        client={new ApiClient(withNotifications(fetcher))}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole("button", {
      name: "ВСЕ ОТКРЫТКИ ТУТ"
    }));

    expect(await screen.findByText("Сообщение источника")).toBeVisible();
    // Opening the source also tells MAX it has been read, so the chat does not
    // stay bold in whatever else the account is signed in to.
    expect(fetcher.mock.calls.map(([request]) => requestPath(request))).toEqual([
      "/api/chats",
      "/api/chats/original/messages",
      "/api/chats/-68429202642371/messages",
      "/api/chats/-68429202642371/read"
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
        client={new ApiClient(withNotifications(fetcher))}
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
        client={new ApiClient(withNotifications(fetcher))}
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

  it("shows attachment progress and only retries after an explicit action", async () => {
    vi.stubGlobal("matchMedia", wideMatchMediaStub);
    const upload = deferred<Response>();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(originalChats()))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockImplementationOnce(() => upload.promise)
      .mockResolvedValueOnce(jsonResponse({
        state: "confirmed",
        operationId: "attachment-retry"
      }))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }));

    render(
      <ConnectedMessenger
        client={new ApiClient(withNotifications(fetcher))}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    await screen.findAllByText("Исходный чат");
    const file = new File(["photo"], "photo.jpg", {
      type: "image/jpeg"
    });
    chooseAttachment(file, "media");

    expect(await screen.findByText("Отправляем photo.jpg…")).toBeVisible();
    expect(screen.getByRole("button", {
      name: "Прикрепить файл"
    })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", {
      name: "Прикрепить файл"
    }));
    expect(fetcher).toHaveBeenCalledTimes(3);

    upload.reject(new Error("network"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось отправить photo.jpg"
    );
    expect(fetcher).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(5);
    });
    expect(screen.queryByText(/photo\.jpg/)).toBeNull();
  });

  it("keeps an ambiguous attachment for deliberate retry and clears it on chat change", async () => {
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
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(jsonResponse({
        state: "ambiguous",
        operationId: "attachment-unknown"
      }))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }));

    render(
      <ConnectedMessenger
        client={new ApiClient(withNotifications(fetcher))}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    await screen.findAllByText("Исходный чат");
    chooseAttachment(new File(["photo"], "photo.jpg"), "media");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "MAX не подтвердил отправку photo.jpg"
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("button", { name: "Повторить" })).toBeVisible();

    fireEvent.click(screen.getByText("Получатель"));
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(4);
    });
    expect(screen.queryByText(/photo\.jpg/)).toBeNull();
  });

  it("rejects attachments over 20 MB before starting a request", async () => {
    vi.stubGlobal("matchMedia", wideMatchMediaStub);
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(originalChats()))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }));

    render(
      <ConnectedMessenger
        client={new ApiClient(withNotifications(fetcher))}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    await screen.findAllByText("Исходный чат");
    const file = new File(["large"], "large.zip");
    Object.defineProperty(file, "size", {
      configurable: true,
      value: 20 * 1024 * 1024 + 1
    });
    chooseAttachment(file, "file");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Файл large.zip больше 20 МБ"
    );
    expect(screen.queryByRole("button", { name: "Повторить" })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

/**
 * Two requests happen on the side: the bot's notification preferences on
 * mount, and the description of a chat opened from a forward. Answering them
 * here keeps each test's ordered stubs — and its call count — about the chats
 * and messages it is actually checking.
 */
function withNotifications(fetcher: typeof fetch): typeof fetch {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes("/api/notifications")) {
      return Promise.resolve(jsonResponse({
        enabled: true,
        mutedChatIds: [],
        previewChatIds: []
      }));
    }
    if (url.includes("/info")) {
      return Promise.resolve(jsonResponse({ code: "chat_not_found" }, 404));
    }
    return fetcher(input, init);
  });
}

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

function chooseAttachment(file: File, kind: "media" | "file") {
  const attachmentButton = screen.getByRole("button", {
    name: "Прикрепить файл"
  });
  if (!attachmentButton.hasAttribute("disabled")) {
    fireEvent.click(attachmentButton);
  }
  const selector = kind === "media"
    ? 'input[type="file"][accept="image/*,video/*"]'
    : 'input[type="file"]:not([accept])';
  const input = document.querySelector<HTMLInputElement>(selector);
  if (input === null) {
    throw new Error(`Missing ${kind} attachment input`);
  }
  fireEvent.change(input, { target: { files: [file] } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
