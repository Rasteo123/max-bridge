// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { ForwardMessagePicker } from "./ForwardMessagePicker.js";
import type { MessengerChat } from "./types.js";

afterEach(cleanup);

describe("ForwardMessagePicker", () => {
  it("searches, selects up to ten destinations, and confirms once", async () => {
    const onConfirm = vi.fn().mockResolvedValue({
      state: "confirmed",
      operationId: "forward-1"
    });
    render(
      <ForwardMessagePicker
        chats={chats()}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    );

    const confirm = screen.getByRole("button", { name: "Переслать" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "канал" }
    });
    expect(screen.getByText("Новости")).toBeVisible();
    expect(screen.queryByText("Даниил")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });
    expect(onConfirm).toHaveBeenCalledWith(["channel-2"]);
    expect(await screen.findByText("Сообщение переслано")).toBeVisible();
  });

  it("never retries an ambiguous operation without an explicit click", async () => {
    const onConfirm = vi.fn()
      .mockResolvedValueOnce({
        state: "ambiguous",
        operationId: "forward-1"
      })
      .mockResolvedValueOnce({
        state: "confirmed",
        operationId: "forward-2"
      });
    render(
      <ForwardMessagePicker
        chats={chats()}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    );

    fireEvent.click(screen.getAllByRole("checkbox")[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Переслать" }));
    expect(await screen.findByText(
      "MAX не подтвердил пересылку. Проверьте чат перед повтором."
    )).toBeVisible();
    expect(onConfirm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", {
      name: "Повторить пересылку"
    }));
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(2);
    });
  });
});

function chats(): readonly MessengerChat[] {
  return [
    {
      id: "chat-1",
      title: "Даниил",
      preview: "Привет",
      timestamp: "2026-07-27T10:00:00.000Z",
      unreadCount: 0,
      muted: false,
      kind: "direct"
    },
    {
      id: "channel-2",
      title: "Новости",
      preview: "",
      timestamp: "2026-07-27T10:00:00.000Z",
      unreadCount: 0,
      muted: false,
      kind: "channel"
    }
  ];
}
