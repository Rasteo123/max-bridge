// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { ApiClient } from "../../api/client.js";
import { ConnectedMessenger } from "./ConnectedMessenger.js";

vi.mock("./useLiveEvents.js", () => ({
  useLiveEvents: () => undefined
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ConnectedMessenger startup", () => {
  it("keeps the chat list available when initial history times out", async () => {
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      media: "(min-width: 900px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn()
    }));
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        chats: [{
          id: "0",
          title: "Избранное",
          preview: "",
          timestamp: "2026-07-26T20:00:00.000Z",
          unreadCount: 0,
          muted: false,
          kind: "saved"
        }]
      }))
      .mockResolvedValueOnce(jsonResponse(
        { code: "max_timeout" },
        500
      ));

    render(
      <ConnectedMessenger
        client={new ApiClient(fetcher)}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    expect((await screen.findAllByText("Избранное"))[0]).toBeVisible();
    expect(screen.queryByText("MAX временно недоступен")).toBeNull();
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}
