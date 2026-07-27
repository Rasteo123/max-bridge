// @vitest-environment jsdom

import {
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

    fireEvent.pointerDown(bubble, pointer(180, 100, 1));
    fireEvent.pointerMove(bubble, pointer(110, 102, 1));
    fireEvent.pointerCancel(bubble, pointer(110, 102, 1));

    expect(onReply).not.toHaveBeenCalled();
    expect(bubble).toHaveStyle({ "--reply-drag": "0px" });
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
  }> = {}
) {
  return {
    clientX,
    clientY,
    pointerId,
    pointerType: "touch",
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
