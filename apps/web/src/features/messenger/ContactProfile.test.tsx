// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import {
  backHandlerDepth,
  resetBackHandlers,
  runTopBackHandler
} from "./back-navigation.js";
import { Conversation } from "./Conversation.js";
import type { MessengerChat } from "./types.js";

afterEach(() => {
  cleanup();
  resetBackHandlers();
  vi.restoreAllMocks();
});

function chat(overrides: Partial<MessengerChat> = {}): MessengerChat {
  return {
    id: "chat-1",
    title: "Наталия Токмакова",
    preview: "",
    timestamp: "2026-08-07T09:00:00.000Z",
    unreadCount: 0,
    muted: false,
    kind: "direct",
    ...overrides
  };
}

function openProfile(): void {
  fireEvent.click(screen.getByRole("button", {
    name: /^Профиль: /u
  }));
}

function renderConversation(value: MessengerChat) {
  return render(
    <Conversation
      chat={value}
      messages={[]}
      wide={false}
      onOpenChats={vi.fn()}
      onSend={vi.fn()}
    />
  );
}

describe("ContactProfile", () => {
  it("opens from the name in the header", () => {
    renderConversation(chat());

    expect(screen.queryByTestId("contact-profile")).toBeNull();
    openProfile();

    expect(screen.getByRole("dialog")).toHaveTextContent("Наталия Токмакова");
  });

  it("shows the public address when the contact has one", () => {
    renderConversation(chat({
      link: "https://max.ru/natalia",
      verified: true
    }));
    openProfile();

    const link = screen.getByRole("link", { name: "max.ru/natalia" });
    expect(link).toHaveAttribute("href", "https://max.ru/natalia");
    // The badge is an image with a label, not text.
    expect(screen.getAllByRole("img", {
      name: "Подтверждённый аккаунт"
    }).length).toBeGreaterThan(0);
  });

  it("omits the address when there is none", () => {
    renderConversation(chat());
    openProfile();

    expect(screen.queryByRole("link")).toBeNull();
  });

  it.each([
    ["direct", "Контакт"],
    ["group", "Группа"],
    ["channel", "Канал"]
  ] as const)("names a %s chat as %s", (kind, expected) => {
    renderConversation(chat({ kind }));
    openProfile();

    expect(screen.getByRole("dialog")).toHaveTextContent(expected);
  });

  it("closes on the back button and releases the handler", () => {
    renderConversation(chat());
    openProfile();

    expect(backHandlerDepth()).toBe(1);
    act(() => {
      expect(runTopBackHandler()).toBe(true);
    });

    expect(screen.queryByTestId("contact-profile")).toBeNull();
    expect(backHandlerDepth()).toBe(0);
  });

  it("closes on a tap outside the card", () => {
    renderConversation(chat());
    openProfile();

    fireEvent.pointerDown(screen.getByTestId("contact-profile"));

    expect(screen.queryByTestId("contact-profile")).toBeNull();
  });
});
