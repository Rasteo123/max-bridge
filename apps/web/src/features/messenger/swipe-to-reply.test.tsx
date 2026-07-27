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
import { MessageBubble } from "./MessageBubble.js";
import type { MessengerMessage } from "./types.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.stubGlobal("PointerEvent", TestPointerEvent);
});

describe("message swipe to reply", () => {
  it("follows a right-to-left drag and replies once after the threshold", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(116, 103, 1));

    expect(bubble).toHaveStyle({ "--reply-drag": "-64px" });

    fireEvent.pointerUp(bubble, pointer(116, 103, 1));

    expect(onReply).toHaveBeenCalledOnce();
    expect(onReply).toHaveBeenCalledWith(
      expect.objectContaining({ id: "m1" })
    );
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
  });

  it("snaps back without replying below 56 pixels", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(140, 102, 1));
    expect(bubble).toHaveStyle({ "--reply-drag": "-40px" });

    fireEvent.pointerUp(bubble, pointer(140, 102, 1));

    expect(onReply).not.toHaveBeenCalled();
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
  });

  it("ignores rightward and vertical gestures", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();

    fireEvent.pointerDown(bubble, pointer(100, 100, 1));
    fireEvent.pointerMove(bubble, pointer(180, 103, 1));
    fireEvent.pointerUp(bubble, pointer(180, 103, 1));

    fireEvent.pointerDown(bubble, pointer(180, 100, 2));
    fireEvent.pointerMove(bubble, pointer(170, 180, 2));
    fireEvent.pointerUp(bubble, pointer(100, 180, 2));

    expect(onReply).not.toHaveBeenCalled();
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
  });

  it("resets an unfinished drag after pointer cancellation", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();
    const releasePointerCapture = vi.fn();
    Object.assign(bubble, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture
    });

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(110, 102, 1));
    fireEvent.pointerCancel(bubble, pointer(110, 102, 1));

    expect(onReply).not.toHaveBeenCalled();
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("does not start from an interactive media control", () => {
    const onReply = vi.fn();
    render(
      <MessageBubble
        message={{
          ...message(),
          kind: "voice",
          media: {
            handle: "voice-1",
            mimeType: "audio/ogg",
            size: 128,
            sourceUrl: "https://i.oneme.ru/voice.ogg"
          }
        }}
        onReply={onReply}
      />
    );
    const bubble = messageBubble();
    const audio = document.querySelector("audio");
    expect(audio).not.toBeNull();

    fireEvent.pointerDown(audio as Element, pointer(180, 100, 1));
    fireEvent.pointerMove(audio as Element, pointer(100, 102, 1));
    fireEvent.pointerUp(audio as Element, pointer(100, 102, 1));

    expect(onReply).not.toHaveBeenCalled();
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
  });

  it("cancels the active drag when another pointer appears", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(110, 102, 1));
    fireEvent.pointerDown(bubble, pointer(120, 105, 2, {
      isPrimary: false
    }));
    fireEvent.pointerUp(bubble, pointer(110, 102, 1));

    expect(onReply).not.toHaveBeenCalled();
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
  });

  it("starts only from a primary pointer and the primary button", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();

    fireEvent.pointerDown(bubble, pointer(180, 100, 1, {
      isPrimary: false
    }));
    fireEvent.pointerMove(bubble, pointer(100, 102, 1, {
      isPrimary: false
    }));
    fireEvent.pointerUp(bubble, pointer(100, 102, 1, {
      isPrimary: false
    }));

    fireEvent.pointerDown(bubble, pointer(180, 100, 2, { button: 2 }));
    fireEvent.pointerMove(bubble, pointer(100, 102, 2, { button: 2 }));
    fireEvent.pointerUp(bubble, pointer(100, 102, 2, { button: 2 }));

    expect(onReply).not.toHaveBeenCalled();
  });

  it("uses Telegram light haptics once while the drag stays armed", () => {
    const impactOccurred = vi.fn();
    vi.stubGlobal("Telegram", {
      WebApp: {
        HapticFeedback: { impactOccurred }
      }
    });
    render(<MessageBubble message={message()} onReply={vi.fn()} />);
    const bubble = messageBubble();

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(120, 101, 1));
    fireEvent.pointerMove(bubble, pointer(100, 102, 1));
    fireEvent.pointerMove(bubble, pointer(96, 102, 1));

    expect(impactOccurred).toHaveBeenCalledOnce();
    expect(impactOccurred).toHaveBeenCalledWith("light");
  });

  it("uses haptics once for each new threshold crossing", () => {
    const impactOccurred = vi.fn();
    vi.stubGlobal("Telegram", {
      WebApp: {
        HapticFeedback: { impactOccurred }
      }
    });
    render(<MessageBubble message={message()} onReply={vi.fn()} />);
    const bubble = messageBubble();

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(120, 101, 1));
    fireEvent.pointerMove(bubble, pointer(150, 101, 1));
    fireEvent.pointerMove(bubble, pointer(120, 101, 1));

    expect(impactOccurred).toHaveBeenCalledTimes(2);
  });

  it("is safe outside Telegram and without the haptic capability", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();
    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(110, 101, 1));
    fireEvent.pointerUp(bubble, pointer(110, 101, 1));
    expect(onReply).toHaveBeenCalledOnce();

    cleanup();
    vi.stubGlobal("Telegram", { WebApp: {} });
    render(<MessageBubble message={message()} onReply={onReply} />);
    const secondBubble = messageBubble();
    fireEvent.pointerDown(secondBubble, pointer(180, 100, 2));
    fireEvent.pointerMove(secondBubble, pointer(110, 101, 2));
    fireEvent.pointerUp(secondBubble, pointer(110, 101, 2));
    expect(onReply).toHaveBeenCalledTimes(2);
  });

  it("cancels a pending reply gesture when long press opens the menu", () => {
    vi.useFakeTimers();
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(176, 102, 1));
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByRole("menu", {
      name: "Действия с сообщением"
    })).toBeVisible();
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });

    fireEvent.pointerMove(bubble, pointer(100, 102, 1));
    fireEvent.pointerUp(bubble, pointer(100, 102, 1));

    expect(onReply).not.toHaveBeenCalled();
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
  });

  it("cancels a pending reply gesture before the right-click menu opens", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.contextMenu(bubble, { clientX: 160, clientY: 100 });

    expect(screen.getByRole("menu", {
      name: "Действия с сообщением"
    })).toBeVisible();
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });

    fireEvent.pointerMove(bubble, pointer(100, 102, 1));
    fireEvent.pointerUp(bubble, pointer(100, 102, 1));

    expect(onReply).not.toHaveBeenCalled();
  });

  it("cancels a mouse gesture that leaves before horizontal lock", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();
    Object.assign(bubble, {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn()
    });

    fireEvent.pointerDown(bubble, pointer(180, 100, 1, {
      pointerType: "mouse"
    }));
    fireEvent.pointerMove(bubble, pointer(176, 102, 1, {
      pointerType: "mouse"
    }));
    fireEvent.pointerLeave(bubble, pointer(176, 102, 1, {
      pointerType: "mouse"
    }));

    fireEvent.pointerDown(bubble, pointer(180, 100, 2, {
      pointerType: "mouse"
    }));
    fireEvent.pointerMove(bubble, pointer(110, 102, 2, {
      pointerType: "mouse"
    }));
    fireEvent.pointerUp(bubble, pointer(110, 102, 2, {
      pointerType: "mouse"
    }));

    expect(onReply).toHaveBeenCalledOnce();
  });

  it("resets after losing pointer capture during a locked drag", () => {
    const onReply = vi.fn();
    const setPointerCapture = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();
    Object.assign(bubble, {
      setPointerCapture,
      hasPointerCapture: vi.fn(() => false),
      releasePointerCapture: vi.fn()
    });

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(110, 102, 1));
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(bubble).toHaveStyle({ "--reply-drag": "-70px" });

    fireEvent.lostPointerCapture(bubble, pointer(110, 102, 1));
    fireEvent.pointerUp(bubble, pointer(110, 102, 1));

    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
    expect(onReply).not.toHaveBeenCalled();
  });

  it("keeps an armed mouse drag active outside after capture", () => {
    const onReply = vi.fn();
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();
    Object.assign(bubble, {
      setPointerCapture,
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture
    });

    fireEvent.pointerDown(bubble, pointer(180, 100, 1, {
      pointerType: "mouse"
    }));
    fireEvent.pointerMove(bubble, pointer(110, 102, 1, {
      pointerType: "mouse"
    }));
    fireEvent.pointerLeave(bubble, pointer(90, 102, 1, {
      pointerType: "mouse"
    }));
    fireEvent.pointerUp(bubble, pointer(-10, 102, 1, {
      pointerType: "mouse"
    }));

    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    expect(onReply).toHaveBeenCalledOnce();
  });

  it("stays safe when pointer capture APIs are unavailable or throw", () => {
    const onReply = vi.fn();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const bubble = messageBubble();
    Object.assign(bubble, {
      setPointerCapture: vi.fn(() => {
        throw new Error("capture unavailable");
      }),
      hasPointerCapture: vi.fn(() => {
        throw new Error("capture unavailable");
      }),
      releasePointerCapture: vi.fn(() => {
        throw new Error("capture unavailable");
      })
    });

    expect(() => {
      fireEvent.pointerDown(bubble, pointer(180, 100, 1));
      fireEvent.pointerMove(bubble, pointer(110, 102, 1));
      fireEvent.pointerUp(bubble, pointer(110, 102, 1));
    }).not.toThrow();
    expect(onReply).toHaveBeenCalledOnce();

    cleanup();
    render(<MessageBubble message={message()} onReply={onReply} />);
    const withoutCapture = messageBubble();
    expect(() => {
      fireEvent.pointerDown(withoutCapture, pointer(180, 100, 2));
      fireEvent.pointerMove(withoutCapture, pointer(110, 102, 2));
      fireEvent.pointerUp(withoutCapture, pointer(110, 102, 2));
    }).not.toThrow();
    expect(onReply).toHaveBeenCalledTimes(2);
  });
});

function messageBubble(): HTMLElement {
  const bubble = screen.getByText("Проверка свайпа").closest("article");
  expect(bubble).not.toBeNull();
  return bubble as HTMLElement;
}

function message(): MessengerMessage {
  return {
    id: "m1",
    text: "Проверка свайпа",
    direction: "incoming",
    sentAt: "2026-07-27T10:00:00.000Z"
  };
}

function pointer(
  clientX: number,
  clientY: number,
  pointerId: number,
  overrides: Readonly<{
    button?: number;
    isPrimary?: boolean;
    pointerType?: string;
  }> = {}
) {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType: overrides.pointerType ?? "touch",
    button: overrides.button ?? 0,
    isPrimary: overrides.isPrimary ?? true
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
