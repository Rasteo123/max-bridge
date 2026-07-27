// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi
} from "vitest";

import "../../test-setup.js";
import { ChatRow } from "./ChatRow.js";
import { Composer } from "./Composer.js";
import { Conversation } from "./Conversation.js";
import { MessageBubble } from "./MessageBubble.js";
import type {
  MessengerChat,
  MessengerMessage,
  MessengerSticker
} from "./types.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "clipboard");
});

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});

describe("message context menu", () => {
  it("replaces the native right-click menu and copies the real message text", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>()
      .mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText }
    });
    render(<MessageBubble message={outgoingMessage()} />);

    const bubble = screen.getByText("Исходящее сообщение").closest("article");
    expect(bubble).not.toBeNull();
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 90,
      clientY: 120
    });
    fireEvent(bubble as Element, event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("menu", {
      name: "Действия с сообщением"
    })).toBeVisible();
    fireEvent.click(screen.getByRole("menuitem", {
      name: "Копировать текст"
    }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("Исходящее сообщение");
    });
  });

  it("opens after a long press and cancels after pointer movement", () => {
    vi.useFakeTimers();
    const onReply = vi.fn();
    const { rerender } = render(
      <MessageBubble message={incomingMessage()} onReply={onReply} />
    );
    const firstBubble = screen.getByText("Входящее сообщение")
      .closest("article");
    expect(firstBubble).not.toBeNull();

    fireEvent.pointerDown(firstBubble as Element, pointer(30, 40, 1));
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(screen.queryByRole("menu")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("menu")).toBeVisible();

    fireEvent.keyDown(document, { key: "Escape" });
    rerender(
      <MessageBubble message={incomingMessage()} onReply={onReply} />
    );
    const secondBubble = screen.getByText("Входящее сообщение")
      .closest("article");
    fireEvent.pointerDown(secondBubble as Element, pointer(30, 40, 2));
    fireEvent.pointerMove(secondBubble as Element, pointer(45, 40, 2));
    act(() => {
      vi.advanceTimersByTime(600);
    });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders existing reactions and toggles the user's selected reaction", () => {
    const onReact = vi.fn();
    render(
      <MessageBubble
        message={{
          ...incomingMessage(),
          reactions: [{
            key: "heart",
            emoji: "❤️",
            count: 3,
            selectedByMe: true
          }]
        }}
        onReact={onReact}
      />
    );

    const reaction = screen.getByRole("button", { name: "❤️ 3" });
    expect(reaction).toHaveAttribute("aria-pressed", "true");
    expect(reaction).toHaveClass("message__reaction--selected");
    fireEvent.click(reaction);
    expect(onReact).toHaveBeenCalledWith("message-in", null);

    openMessageMenu("Входящее сообщение");
    fireEvent.click(screen.getByRole("menuitemcheckbox", {
      name: "Огонь"
    }));
    expect(onReact).toHaveBeenLastCalledWith("message-in", "fire");
  });

  it("shows the original source for a forwarded message", () => {
    render(
      <MessageBubble
        message={{
          ...incomingMessage(),
          forwardedFrom: "ВСЕ ОТКРЫТКИ ТУТ"
        }}
      />
    );

    expect(screen.getByText("Переслано:")).toBeVisible();
    expect(screen.getByText("ВСЕ ОТКРЫТКИ ТУТ")).toBeVisible();
  });

  it("closes on an outside press and clamps to the viewport", () => {
    render(<MessageBubble message={incomingMessage()} />);
    const bubble = screen.getByText("Входящее сообщение").closest("article");
    fireEvent.contextMenu(bubble as Element, {
      clientX: window.innerWidth + 500,
      clientY: window.innerHeight + 500
    });
    const menu = screen.getByRole("menu");
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(
      window.innerWidth
    );
    expect(Number.parseFloat(menu.style.top)).toBeLessThanOrEqual(
      window.innerHeight
    );

    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("reply and edit composer state", () => {
  it("sends a reply with replyToId", () => {
    const onSend = vi.fn();
    render(
      <Conversation
        chat={chat()}
        messages={[incomingMessage()]}
        wide
        onOpenChats={vi.fn()}
        onSend={onSend}
      />
    );

    openMessageMenu("Входящее сообщение");
    fireEvent.click(screen.getByRole("menuitem", { name: "Ответить" }));
    expect(screen.getByText("Ответ на сообщение")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: { value: "Мой ответ" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onSend).toHaveBeenCalledWith("Мой ответ", "message-in");
  });

  it("edits only an outgoing text message instead of sending a new one", () => {
    const onSend = vi.fn();
    const onEditMessage = vi.fn();
    render(
      <Conversation
        chat={chat()}
        messages={[outgoingMessage()]}
        wide
        onOpenChats={vi.fn()}
        onSend={onSend}
        onEditMessage={onEditMessage}
      />
    );

    openMessageMenu("Исходящее сообщение");
    fireEvent.click(screen.getByRole("menuitem", {
      name: "Редактировать"
    }));
    expect(screen.getByText("Редактирование")).toBeVisible();
    expect(screen.getByLabelText("Сообщение"))
      .toHaveValue("Исходящее сообщение");
    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: { value: "Исправленный текст" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));

    expect(onEditMessage).toHaveBeenCalledWith(
      "message-out",
      "Исправленный текст"
    );
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("chat context menu", () => {
  it("offers MAX-like chat actions without opening the chat on right-click", () => {
    const onSelect = vi.fn();
    const onChatAction = vi.fn();
    render(
      <ChatRow
        chat={chat()}
        selected={false}
        onSelect={onSelect}
        onChatAction={onChatAction}
      />
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /Даниил/u }), {
      clientX: 80,
      clientY: 120
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole("menuitem", { name: "Закрепить" })).toBeVisible();
    expect(screen.getByRole("menuitem", {
      name: "Отметить непрочитанным"
    })).toBeVisible();
    expect(screen.getByRole("menuitem", {
      name: "Отключить уведомления"
    })).toBeVisible();
  });

  it("confirms destructive chat actions", () => {
    const onChatAction = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <ChatRow
        chat={chat()}
        selected={false}
        onSelect={vi.fn()}
        onChatAction={onChatAction}
      />
    );

    fireEvent.contextMenu(screen.getByRole("button", { name: /Даниил/u }));
    fireEvent.click(screen.getByRole("menuitem", {
      name: "Стереть переписку"
    }));
    expect(onChatAction).toHaveBeenCalledWith("chat-1", "clear");
  });

  it("does not open the chat after a long press", () => {
    vi.useFakeTimers();
    const onSelect = vi.fn();
    render(
      <ChatRow
        chat={chat()}
        selected={false}
        onSelect={onSelect}
        onChatAction={vi.fn()}
      />
    );
    const row = screen.getByRole("button", { name: /Даниил/u });
    fireEvent.pointerDown(row, pointer(30, 40, 8));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    fireEvent.pointerUp(row, pointer(30, 40, 8));
    fireEvent.click(row);

    expect(screen.getByRole("menu")).toBeVisible();
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("sticker picker", () => {
  it("inserts MAX emoji into the current message", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);

    fireEvent.click(screen.getByRole("button", {
      name: "Эмодзи и стикеры"
    }));
    fireEvent.click(screen.getByRole("button", { name: "Вставить 😀" }));

    expect(screen.getByRole("textbox", { name: "Сообщение" }))
      .toHaveValue("😀");
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onSend).toHaveBeenCalledWith("😀", undefined);
  });

  it("loads stickers on opening, sends one, and closes after selection", async () => {
    let resolveStickers: (value: readonly MessengerSticker[]) => void =
      () => undefined;
    const onLoadStickers = vi.fn(() =>
      new Promise<readonly MessengerSticker[]>((resolve) => {
      resolveStickers = resolve;
      })
    );
    const onSendSticker = vi.fn<() => Promise<void>>().mockResolvedValue();
    render(
      <Composer
        onSend={vi.fn()}
        onLoadStickers={onLoadStickers}
        onSendSticker={onSendSticker}
      />
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Эмодзи и стикеры"
    }));
    fireEvent.click(screen.getByRole("tab", { name: "Стикеры" }));
    expect(screen.getByRole("status"))
      .toHaveTextContent("Загружаем стикеры");
    expect(onLoadStickers).toHaveBeenCalledOnce();

    await act(async () => {
      resolveStickers([{
        id: "sticker-wave",
        previewDataUrl: "data:image/png;base64,AA=="
      }]);
      await Promise.resolve();
    });
    fireEvent.click(screen.getByRole("button", {
      name: "Отправить стикер sticker-wave"
    }));
    expect(onSendSticker).toHaveBeenCalledWith("sticker-wave");
    expect(screen.queryByRole("dialog", {
      name: "Эмодзи и стикеры"
    })).toBeNull();
  });

  it("closes the sticker popover outside and with Escape", async () => {
    render(
      <Composer
        onSend={vi.fn()}
        onLoadStickers={vi.fn().mockResolvedValue([])}
        onSendSticker={vi.fn()}
      />
    );
    const button = screen.getByRole("button", {
      name: "Эмодзи и стикеры"
    });

    fireEvent.click(button);
    fireEvent.click(screen.getByRole("tab", { name: "Стикеры" }));
    expect(await screen.findByText("Стикеров пока нет")).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", {
      name: "Эмодзи и стикеры"
    })).toBeNull();

    fireEvent.click(button);
    expect(screen.getByRole("dialog", {
      name: "Эмодзи и стикеры"
    })).toBeVisible();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", {
      name: "Эмодзи и стикеры"
    })).toBeNull();
  });

  it("shows a retry action when sticker loading fails", async () => {
    const onLoadStickers = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce([]);
    render(
      <Composer
        onSend={vi.fn()}
        onLoadStickers={onLoadStickers}
        onSendSticker={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", {
      name: "Эмодзи и стикеры"
    }));
    fireEvent.click(screen.getByRole("tab", { name: "Стикеры" }));
    expect(await screen.findByRole("alert"))
      .toHaveTextContent("Не удалось загрузить стикеры");
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    expect(await screen.findByText("Стикеров пока нет")).toBeVisible();
    expect(onLoadStickers).toHaveBeenCalledTimes(2);
  });
});

function openMessageMenu(text: string) {
  const bubble = screen.getByText(text).closest("article");
  fireEvent.contextMenu(bubble as Element, {
    clientX: 80,
    clientY: 120
  });
}

function pointer(clientX: number, clientY: number, pointerId: number) {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType: "touch",
    button: 0,
    isPrimary: true
  };
}

function chat(): MessengerChat {
  return {
    id: "chat-1",
    title: "Даниил",
    preview: "Привет",
    timestamp: "2026-07-26T19:00:00.000Z",
    unreadCount: 0,
    muted: false,
    kind: "direct"
  };
}

function incomingMessage(): MessengerMessage {
  return {
    id: "message-in",
    text: "Входящее сообщение",
    direction: "incoming",
    sentAt: "2026-07-26T19:00:00.000Z"
  };
}

function outgoingMessage(): MessengerMessage {
  return {
    id: "message-out",
    text: "Исходящее сообщение",
    direction: "outgoing",
    sentAt: "2026-07-26T19:01:00.000Z"
  };
}

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(type: string, init: PointerEventInit) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "";
    this.isPrimary = init.isPrimary ?? false;
  }
}
