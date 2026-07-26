// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
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
  installMatchMedia(false);
});

describe("narrow messenger gestures", () => {
  it("opens the chat list with a right swipe from the left edge", () => {
    renderShell("conversation");
    swipe(8, 170);
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "list");
  });

  it("hides the chat list with a left swipe", () => {
    renderShell("list");
    swipe(260, 70);
    expect(screen.getByTestId("messenger-shell"))
      .toHaveAttribute("data-pane", "conversation");
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
