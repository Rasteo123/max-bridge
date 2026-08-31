// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { Conversation } from "./Conversation.js";
import type { MessengerChat, MessengerMessage } from "./types.js";

const CLIENT_HEIGHT = 500;
let scrollHeight = 2_000;

beforeEach(() => {
  scrollHeight = 2_000;
  // jsdom performs no layout, so the scroll geometry is supplied here. Unlike
  // the sibling suite this one grows, because a page arriving above the reader
  // is exactly what has to be handled.
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => CLIENT_HEIGHT
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function chat(): MessengerChat {
  return {
    id: "chat-1",
    title: "Собеседник",
    preview: "",
    timestamp: "2026-08-07T09:00:00.000Z",
    unreadCount: 0,
    muted: false,
    kind: "direct"
  };
}

function message(id: string, sentAt: string): MessengerMessage {
  return { id, text: `Сообщение ${id}`, direction: "incoming", sentAt };
}

function messageList(): HTMLElement {
  return screen.getByTestId("conversation")
    .querySelector(".conversation__messages") as HTMLElement;
}

const NEWER = message("2", "2026-08-07T09:00:00.000Z");
const OLDER = message("1", "2026-08-05T09:00:00.000Z");

describe("loading older history", () => {
  it("asks for an older page once the reader reaches the top", () => {
    const onLoadOlder = vi.fn();
    render(
      <Conversation
        chat={chat()}
        messages={[NEWER]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
        onLoadOlder={onLoadOlder}
      />
    );
    const list = messageList();

    list.scrollTop = 0;
    fireEvent.scroll(list);

    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it("does not ask while the reader is away from the top", () => {
    const onLoadOlder = vi.fn();
    render(
      <Conversation
        chat={chat()}
        messages={[NEWER]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
        onLoadOlder={onLoadOlder}
      />
    );
    const list = messageList();

    list.scrollTop = 900;
    fireEvent.scroll(list);

    expect(onLoadOlder).not.toHaveBeenCalled();
  });

  it("keeps the reader in place when an older page is prepended", () => {
    const { rerender } = render(
      <Conversation
        chat={chat()}
        messages={[NEWER]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
        onLoadOlder={vi.fn()}
      />
    );
    const list = messageList();
    list.scrollTop = 640;
    fireEvent.scroll(list);

    // The page lands above the reader, so the list grows upwards by 1000px.
    scrollHeight = 3_000;
    rerender(
      <Conversation
        chat={chat()}
        messages={[OLDER, NEWER]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
        onLoadOlder={vi.fn()}
      />
    );

    // Without anchoring the reader would be thrown to the top of the new page.
    expect(list.scrollTop).toBe(1_640);
  });
});
