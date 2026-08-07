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
import { resetBackHandlers } from "./back-navigation.js";
import { ChatList } from "./ChatList.js";
import type { MessengerChat } from "./types.js";
import { SEARCH_DEBOUNCE_MS } from "./useChatSearch.js";

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  cleanup();
  resetBackHandlers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ownChat: MessengerChat = {
  id: "chat-1",
  title: "Новости отдела",
  preview: "Совещание в 10",
  timestamp: "2026-08-07T09:00:00.000Z",
  unreadCount: 0,
  muted: false,
  kind: "group"
};

const globalChat: MessengerChat = {
  id: "-71825987409954",
  title: "Москва Новости",
  preview: "",
  timestamp: "2026-08-07T09:00:00.000Z",
  unreadCount: 0,
  muted: false,
  kind: "channel",
  verified: true,
  description: "Новости города",
  membersCount: 47_242,
  link: "https://max.ru/moscwlife_vmax"
};

function renderList(
  onSearch: (
    query: string,
    signal: AbortSignal
  ) => Promise<readonly MessengerChat[]>
) {
  return render(
    <ChatList
      chats={[ownChat]}
      onSelectChat={() => undefined}
      onSearch={onSearch}
    />
  );
}

async function typeQuery(value: string): Promise<void> {
  fireEvent.change(screen.getByRole("searchbox"), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    await Promise.resolve();
  });
}

describe("global chat search", () => {
  it("lists the viewer's own chats above the global results", async () => {
    renderList(() => Promise.resolve([globalChat]));

    await typeQuery("новости");

    expect(screen.getByText("Ваши чаты")).toBeTruthy();
    expect(screen.getByText("Глобальный поиск")).toBeTruthy();
    const titles = [...document.querySelectorAll(".chat-row__name")]
      .map((node) => node.textContent);
    expect(titles).toEqual(["Новости отдела", "Москва Новости"]);
    expect(screen.getByText("Новости города")).toBeTruthy();
  });

  it("waits for typing to stop before asking MAX", async () => {
    const onSearch = vi.fn(
      (query: string, signal: AbortSignal) => {
        expect(signal.aborted).toBe(false);
        return Promise.resolve(query === "новости" ? [globalChat] : []);
      }
    );
    renderList(onSearch);

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "но" }
    });
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "нов" }
    });
    await typeQuery("новости");

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch.mock.calls[0]?.[0]).toBe("новости");
  });

  it("does not search for a single character", async () => {
    const onSearch = vi.fn(
      (query: string, signal: AbortSignal) => {
        expect([query, signal.aborted]).toEqual(["", false]);
        return Promise.resolve([] as readonly MessengerChat[]);
      }
    );
    renderList(onSearch);

    await typeQuery("н");

    expect(onSearch).not.toHaveBeenCalled();
  });

  it("opens a profile card for a chat the viewer has not joined", async () => {
    renderList(() => Promise.resolve([globalChat]));
    await typeQuery("новости");

    fireEvent.click(screen.getByRole("button", { name: /Москва Новости/u }));

    const profile = screen.getByTestId("contact-profile");
    expect(profile.textContent.replace(/\s/gu, " "))
      .toContain("47 242 подписчика");
    expect(profile.textContent).toContain("Москва Новости");
    expect(profile.textContent).toContain("Новости города");
    expect(profile.textContent).toContain("max.ru/moscwlife_vmax");
  });

  it("reports a failed search instead of showing an empty folder", async () => {
    renderList(() => Promise.reject(new Error("offline")));

    await typeQuery("абвгд");

    expect(screen.getByText("Не удалось выполнить поиск")).toBeTruthy();
  });
});
