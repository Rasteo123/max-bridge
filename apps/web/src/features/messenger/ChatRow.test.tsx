// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { ChatRow } from "./ChatRow.js";
import type { MessengerChat } from "./types.js";

afterEach(cleanup);

describe("ChatRow", () => {
  it("places the contact name above the message preview", () => {
    render(
      <ChatRow chat={chat()} selected={false} onSelect={vi.fn()} />
    );

    const name = screen.getByText("Ольга");
    const preview = screen.getByText("Привет, хорошо");
    expect(name.compareDocumentPosition(preview) &
      Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(name).toHaveClass("chat-row__name");
    expect(preview).toHaveClass("chat-row__preview");
  });

  it("keeps time and unread count in the right metadata column", () => {
    render(
      <ChatRow chat={chat()} selected={false} onSelect={vi.fn()} />
    );

    expect(screen.getByText("15:00").parentElement)
      .toHaveClass("chat-row__meta");
    expect(screen.getByLabelText("3 непрочитанных сообщения"))
      .toHaveClass("chat-row__unread");
  });

  it("preserves long preview text for accessible truncation", () => {
    const preview = "Очень длинное сообщение ".repeat(20).trim();
    render(
      <ChatRow
        chat={{ ...chat(), preview }}
        selected={false}
        onSelect={vi.fn()}
      />
    );

    expect(screen.getByTitle(preview)).toHaveClass("chat-row__preview");
  });
});

function chat(): MessengerChat {
  return {
    id: "chat-olga",
    title: "Ольга",
    preview: "Привет, хорошо",
    timestamp: "2026-07-26T15:00:00.000Z",
    formattedTime: "15:00",
    unreadCount: 3,
    muted: false,
    kind: "direct"
  };
}
