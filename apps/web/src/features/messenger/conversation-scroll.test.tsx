// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { Conversation } from "./Conversation.js";
import type { MessengerChat, MessengerMessage } from "./types.js";

const SCROLL_HEIGHT = 2_000;
const CLIENT_HEIGHT = 500;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

beforeEach(() => {
  // jsdom performs no layout, so the scroll geometry is supplied here.
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get: () => SCROLL_HEIGHT
  });
  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get: () => CLIENT_HEIGHT
  });
});

function chat(id: string): MessengerChat {
  return {
    id,
    title: "Собеседник",
    preview: "",
    timestamp: "2026-08-07T09:00:00.000Z",
    unreadCount: 0,
    muted: false,
    kind: "direct"
  };
}

function message(id: string, sentAt: string): MessengerMessage {
  return {
    id,
    text: `Сообщение ${id}`,
    direction: "incoming",
    sentAt
  };
}

function messageList(): HTMLElement {
  return screen.getByTestId("conversation")
    .querySelector(".conversation__messages") as HTMLElement;
}

describe("Conversation scrolling", () => {
  it("opens on the newest messages rather than the top of the history", () => {
    render(
      <Conversation
        chat={chat("chat-1")}
        messages={[
          message("1", "2026-08-05T09:00:00.000Z"),
          message("2", "2026-08-07T09:00:00.000Z")
        ]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
      />
    );

    expect(messageList().scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("follows new messages while the reader sits at the bottom", () => {
    const { rerender } = render(
      <Conversation
        chat={chat("chat-1")}
        messages={[message("1", "2026-08-07T09:00:00.000Z")]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
      />
    );
    const list = messageList();
    list.scrollTop = 0;

    rerender(
      <Conversation
        chat={chat("chat-1")}
        messages={[
          message("1", "2026-08-07T09:00:00.000Z"),
          message("2", "2026-08-07T09:05:00.000Z")
        ]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
      />
    );

    expect(list.scrollTop).toBe(SCROLL_HEIGHT);
  });

  it("leaves a reader who scrolled up where they are", () => {
    const { rerender } = render(
      <Conversation
        chat={chat("chat-1")}
        messages={[message("1", "2026-08-07T09:00:00.000Z")]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
      />
    );
    const list = messageList();
    list.scrollTop = 200;
    fireEvent.scroll(list);

    rerender(
      <Conversation
        chat={chat("chat-1")}
        messages={[
          message("1", "2026-08-07T09:00:00.000Z"),
          message("2", "2026-08-07T09:05:00.000Z")
        ]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
      />
    );

    expect(list.scrollTop).toBe(200);
  });

  it("returns to the bottom when another chat is opened", () => {
    const { rerender } = render(
      <Conversation
        chat={chat("chat-1")}
        messages={[message("1", "2026-08-07T09:00:00.000Z")]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
      />
    );
    const list = messageList();
    list.scrollTop = 200;
    fireEvent.scroll(list);

    rerender(
      <Conversation
        chat={chat("chat-2")}
        messages={[message("9", "2026-08-07T10:00:00.000Z")]}
        wide={false}
        onOpenChats={vi.fn()}
        onSend={vi.fn()}
      />
    );

    expect(messageList().scrollTop).toBe(SCROLL_HEIGHT);
  });
});
