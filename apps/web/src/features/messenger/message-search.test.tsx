// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { resetBackHandlers } from "./back-navigation.js";
import { Conversation } from "./Conversation.js";
import type {
  MessengerChat,
  MessengerMessage
} from "./types.js";

afterEach(() => {
  cleanup();
  resetBackHandlers();
  vi.restoreAllMocks();
});

const chat: MessengerChat = {
  id: "chat-1",
  title: "Наталия Токмакова",
  preview: "",
  timestamp: "2026-08-07T09:00:00.000Z",
  unreadCount: 0,
  muted: false,
  kind: "direct"
};

const messages: readonly MessengerMessage[] = [
  {
    id: "m1",
    kind: "text",
    text: "Совещание в десять",
    direction: "incoming",
    sentAt: "2026-08-07T09:00:00.000Z"
  },
  {
    id: "m2",
    kind: "text",
    text: "Хорошо, узнаю",
    direction: "outgoing",
    sentAt: "2026-08-07T09:05:00.000Z"
  }
];

function renderConversation(onReply = vi.fn()) {
  render(
    <Conversation
      chat={chat}
      messages={messages}
      wide={false}
      onOpenChats={vi.fn()}
      onSend={vi.fn()}
      onReactMessage={onReply}
    />
  );
}

function openSearch(): void {
  fireEvent.click(screen.getByRole("button", { name: "Поиск сообщений" }));
}

describe("message search", () => {
  it("closes when a tap lands outside the field", () => {
    renderConversation();
    openSearch();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "совещание" }
    });
    expect(screen.getByText("Найдено: 1")).toBeTruthy();

    fireEvent.click(screen.getByTestId("message-search-backdrop"));

    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("forgets the query, so reopening starts clean", () => {
    renderConversation();
    openSearch();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "совещание" }
    });
    fireEvent.click(screen.getByTestId("message-search-backdrop"));
    openSearch();

    expect(screen.getByRole("searchbox")).toHaveValue("");
    expect(screen.getByText("Хорошо, узнаю")).toBeTruthy();
  });

  it("keeps the tap off the message underneath", () => {
    renderConversation();
    const clicked = vi.fn();
    openSearch();
    const bubble = screen.getByText("Совещание в десять")
      .closest("article");
    expect(bubble).not.toBeNull();
    bubble?.addEventListener("click", clicked);

    fireEvent.click(screen.getByTestId("message-search-backdrop"));

    expect(clicked).not.toHaveBeenCalled();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("stays open while the field itself is used", () => {
    renderConversation();
    openSearch();
    const field = screen.getByRole("searchbox");

    fireEvent.click(field);
    fireEvent.change(field, { target: { value: "узнаю" } });

    expect(screen.getByRole("searchbox")).toHaveValue("узнаю");
    expect(screen.getByText("Найдено: 1")).toBeTruthy();
  });

  it("closes from the search button as before", () => {
    renderConversation();
    openSearch();
    expect(screen.getByRole("searchbox")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Поиск сообщений" }));

    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});
