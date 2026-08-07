// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import type { TelegramWebApp } from "../auth/telegram.js";
import { MessengerShell } from "./MessengerShell.js";
import type {
  MessengerChat,
  MessengerMessage
} from "./types.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
  Object.defineProperty(navigator, "maxTouchPoints", {
    configurable: true,
    value: 0
  });
  installMatchMedia(false);
});

describe("narrow messenger gestures", () => {
  it("opens the chat list with a right swipe from the left edge", () => {
    renderShell("conversation");
    swipe(8, 170);
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("opens the chat list with a right swipe from the middle of the chat", () => {
    renderShell("conversation");
    swipe(140, 300);
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("lets a nested message own a left swipe to reply", () => {
    const onSend = vi.fn();
    renderShell("conversation", onSend);
    const surface = screen.getByTestId("messenger-surface");
    const capture = vi.fn();
    Object.assign(surface, { setPointerCapture: capture });
    const bubble = messageBubble("Привет! Ты видел фото?");

    fireEvent.pointerDown(bubble, pointer(180, 100, 1, 0));
    fireEvent.pointerMove(bubble, pointer(116, 103, 1, 100));
    expect(bubble).toHaveStyle({ "--reply-drag": "-64px" });
    expect(capture).not.toHaveBeenCalled();

    fireEvent.pointerUp(bubble, pointer(116, 103, 1, 150));

    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "conversation");
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
    expect(screen.getAllByText("Ответ на сообщение")).toHaveLength(1);

    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: { value: "Ответ" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(onSend).toHaveBeenCalledOnce();
    expect(onSend).toHaveBeenCalledWith("Ответ", "message-1");
  });

  it("lets the parent own a right swipe that starts on a message", () => {
    renderShell("conversation");
    const bubble = messageBubble("Привет! Ты видел фото?");

    fireEvent.pointerDown(bubble, pointer(100, 100, 1, 0));
    fireEvent.pointerMove(bubble, pointer(260, 103, 1, 100));
    fireEvent.pointerUp(bubble, pointer(260, 103, 1, 150));

    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("pages folders with a left swipe instead of opening the chat", () => {
    renderShell("list");
    expect(screen.getByRole("tab", { name: "Все" }))
      .toHaveAttribute("aria-selected", "true");

    swipe(260, 70);

    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
    expect(screen.getByRole("tab", { name: "Новые" }))
      .toHaveAttribute("aria-selected", "true");
  });

  it("pages back to the previous folder with a right swipe", () => {
    renderShell("list");
    swipe(260, 70);
    swipe(70, 260);

    expect(screen.getByRole("tab", { name: "Все" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("stays on the last folder when swiping past the end", () => {
    renderShell("list");
    swipe(260, 70);
    swipe(260, 70);
    swipe(260, 70);

    expect(screen.getByRole("tab", { name: "Каналы" }))
      .toHaveAttribute("aria-selected", "true");
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("snaps back after an insufficient horizontal gesture", () => {
    renderShell("conversation");
    swipe(8, 34);
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "conversation");
  });

  it("accepts a short fast swipe that passes the velocity threshold", () => {
    renderShell("conversation");
    swipe(8, 46, 8);
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("does not intercept vertical scrolling", () => {
    renderShell("conversation");
    swipe(8, 24, 120, 8);
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "conversation");
  });

  it("cancels an unfinished gesture", () => {
    renderShell("conversation");
    const surface = screen.getByTestId("messenger-surface");
    fireEvent.pointerDown(surface, pointer(8, 120, 1, 0));
    fireEvent.pointerMove(surface, pointer(150, 124, 1, 80));
    fireEvent.pointerCancel(surface, pointer(150, 124, 1, 90));
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "conversation");
  });

  it("tracks the panel during a horizontal gesture", () => {
    renderShell("conversation");
    const surface = screen.getByTestId("messenger-surface");
    fireEvent.pointerDown(surface, pointer(8, 120, 1, 0));
    fireEvent.pointerMove(surface, pointer(150, 124, 1, 80));

    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-dragging", "true");
    expect(screen.getByTestId("chat-list").parentElement)
      .toHaveStyle({ "--swipe-offset": "142px" });
  });

  it("does not capture a tap before it becomes a swipe", () => {
    renderShell("list");
    const surface = screen.getByTestId("messenger-surface");
    const capture = vi.fn();
    Object.assign(surface, { setPointerCapture: capture });

    fireEvent.pointerDown(surface, pointer(40, 120, 1, 0));

    expect(capture).not.toHaveBeenCalled();
  });

  it("supports native touch gestures in embedded mobile WebViews", () => {
    Object.defineProperty(navigator, "maxTouchPoints", {
      configurable: true,
      value: 5
    });
    renderShell("conversation");
    const surface = screen.getByTestId("messenger-surface");
    fireEvent.touchStart(surface, {
      touches: [{ clientX: 8, clientY: 120 }]
    });
    fireEvent.touchMove(surface, {
      touches: [{ clientX: 170, clientY: 124 }]
    });
    fireEvent.touchEnd(surface, {
      touches: [],
      changedTouches: [{ clientX: 170, clientY: 124 }]
    });

    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("finishes from the last captured movement when pointerup loses coordinates", () => {
    renderShell("conversation");
    const surface = screen.getByTestId("messenger-surface");
    fireEvent.pointerDown(surface, pointer(8, 120, 1, 0));
    fireEvent.pointerMove(surface, pointer(170, 124, 1, 80));
    fireEvent.pointerUp(surface, pointer(0, 0, 1, 100));

    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("maps horizontal trackpad movement to the same navigation", () => {
    renderShell("conversation");
    const surface = screen.getByTestId("messenger-surface");
    fireEvent.wheel(surface, { deltaX: -90, deltaY: 4 });
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("keeps ordinary buttons usable", () => {
    const send = vi.fn();
    renderShell("conversation", send);
    fireEvent.change(screen.getByLabelText("Сообщение"), {
      target: { value: "Проверка" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(send).toHaveBeenCalledOnce();
  });

  it("uses Telegram BackButton with exact callback cleanup", () => {
    const callbacks = new Set<() => void>();
    const backButton = {
      show: vi.fn(),
      hide: vi.fn(),
      onClick: vi.fn((callback: () => void) => {
        callbacks.add(callback);
      }),
      offClick: vi.fn((callback: () => void) => {
        callbacks.delete(callback);
      })
    };
    vi.stubGlobal("Telegram", {
      WebApp: {
        initData: "signed",
        themeParams: {},
        ready: vi.fn(),
        expand: vi.fn(),
        BackButton: backButton
      } satisfies TelegramWebApp
    });

    const view = renderShell("conversation");
    expect(backButton.show).toHaveBeenCalled();
    const callback = backButton.onClick.mock.calls[0]?.[0];
    expect(callback).toBeTypeOf("function");

    act(() => {
      callback?.();
    });
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
    expect(backButton.offClick).toHaveBeenCalledWith(callback);
    expect(callbacks).not.toContain(callback);
    expect(backButton.hide).toHaveBeenCalled();

    view.unmount();
    expect(callbacks).toHaveLength(0);
  });

  it("uses Telegram stable viewport and safe-area variables", () => {
    const css = messengerCss();

    expect(css).toContain("--tg-viewport-stable-height");
    expect(css).toContain("--tg-safe-area-inset-bottom");
    expect(css).toContain("--tg-content-safe-area-inset-bottom");
  });

  // Telegram draws its own back button, so reserving a column for one only
  // pushed the contact away from the edge.
  it("puts the contact against the leading edge of the header", () => {
    const css = messengerCss();

    expect(css).toMatch(
      /\.conversation__header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\) auto;/u
    );
    expect(css).toMatch(
      /\.conversation__contact\s*\{[\s\S]*?justify-content:\s*start;/u
    );
    expect(css).not.toMatch(
      /\.conversation__actions\s*\{[\s\S]*?min-width:\s*84px;/u
    );
  });

  it("preserves Telegram inline safe areas in the narrow layout", () => {
    const css = messengerCss();
    const narrow = css.slice(css.indexOf("@media (max-width: 819.98px)"));

    expect(narrow).not.toMatch(/\.messenger-page\s*\{\s*padding:\s*0;/u);
    expect(narrow).toMatch(
      /\.messenger-page\s*\{[\s\S]*?--tg-safe-area-inset-right[\s\S]*?--tg-content-safe-area-inset-right[\s\S]*?--tg-safe-area-inset-left[\s\S]*?--tg-content-safe-area-inset-left/u
    );
  });
});

describe("responsive panes", () => {
  it("switches modes on resize without remounting", () => {
    const media = installMatchMedia(false);
    renderShell("conversation");
    const shell = screen.getByTestId("messenger-shell");
    expect(shell).toHaveAttribute("data-mode", "narrow");

    act(() => {
      media.setMatches(true);
    });

    expect(shell).toHaveAttribute("data-mode", "wide");
    expect(screen.getByTestId("chat-list")).toBeVisible();
    expect(screen.getByTestId("conversation")).toBeVisible();
  });
});

function renderShell(
  initialPane: "list" | "conversation",
  onSend = vi.fn()
) {
  return render(
    <MessengerShell
      chats={chats}
      messages={messages}
      initialChatId="chat-alex"
      initialPane={initialPane}
      onSelectChat={vi.fn()}
      onSend={onSend}
    />
  );
}

function messageBubble(text: string): HTMLElement {
  const bubble = screen.getAllByText(text)
    .map((element) => element.closest("article"))
    .find((element) => element !== null);
  expect(bubble).toBeDefined();
  return bubble as HTMLElement;
}

function swipe(
  startX: number,
  endX: number,
  elapsed = 250,
  endY = 123
) {
  const surface = screen.getByTestId("messenger-surface");
  fireEvent.pointerDown(surface, pointer(startX, 120, 1, 0));
  fireEvent.pointerMove(
    surface,
    pointer(endX, endY, 1, Math.max(1, elapsed - 1))
  );
  fireEvent.pointerUp(surface, pointer(endX, endY, 1, elapsed));
}

function pointer(
  clientX: number,
  clientY: number,
  pointerId: number,
  timeStamp: number
) {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType: "touch",
    button: 0,
    isPrimary: true,
    timeStamp
  };
}

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly isPrimary: boolean;

  constructor(
    type: string,
    init: PointerEventInit
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? "";
    this.isPrimary = init.isPrimary ?? false;
  }
}

type MatchMediaHarness = MediaQueryList & {
  setMatches(value: boolean): void;
};

function installMatchMedia(initial: boolean): MatchMediaHarness {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const harness = {
    matches: initial,
    media: "(min-width: 820px)",
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn((
      _type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      if (typeof listener === "function") {
        listeners.add(listener);
      }
    }),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setMatches(value: boolean) {
      Object.assign(harness, { matches: value });
      const event = { matches: value } as MediaQueryListEvent;
      for (const listener of listeners) {
        listener(event);
      }
    }
  } as unknown as MatchMediaHarness;
  vi.stubGlobal("matchMedia", vi.fn(() => harness));
  return harness;
}

function messengerCss(): string {
  return readFileSync(
    "apps/web/src/features/messenger/messenger.css",
    "utf8"
  );
}

const chats: readonly MessengerChat[] = [
  {
    id: "chat-alex",
    title: "Алексей",
    preview: "Привет! Ты видел фото?",
    timestamp: "2026-07-26T13:42:00.000Z",
    formattedTime: "13:42",
    unreadCount: 2,
    muted: false,
    kind: "direct"
  },
  {
    id: "chat-friends",
    title: "Друзья",
    preview: "Лена: Встречаемся в семь?",
    timestamp: "2026-07-26T13:10:00.000Z",
    formattedTime: "13:10",
    unreadCount: 5,
    muted: false,
    kind: "group"
  }
];

const messages: readonly MessengerMessage[] = [
  {
    id: "message-1",
    text: "Привет! Ты видел фото?",
    direction: "incoming",
    sentAt: "13:40"
  },
  {
    id: "message-2",
    text: "Да, сейчас отвечу",
    direction: "outgoing",
    sentAt: "13:42"
  }
];
