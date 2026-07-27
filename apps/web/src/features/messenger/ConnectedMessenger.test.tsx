// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { ApiClient } from "../../api/client.js";
import { ConnectedMessenger } from "./ConnectedMessenger.js";

const useLiveEventsMock = vi.hoisted(() => vi.fn());
vi.mock("./useLiveEvents.js", () => ({
  useLiveEvents: useLiveEventsMock
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useLiveEventsMock.mockClear();
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

  it("wires activation to one current chat and selected-history refresh", async () => {
    vi.stubGlobal("matchMedia", matchMediaStub);
    const chats = {
      chats: [{
        id: "0",
        title: "Избранное",
        preview: "",
        timestamp: "2026-07-26T20:00:00.000Z",
        unreadCount: 0,
        muted: false,
        kind: "saved"
      }]
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(chats))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }))
      .mockResolvedValueOnce(jsonResponse(chats))
      .mockResolvedValueOnce(jsonResponse({ messages: [] }));

    render(
      <ConnectedMessenger
        client={new ApiClient(fetcher)}
        theme="dark"
        onThemeChange={vi.fn()}
        onLoggedOut={vi.fn()}
      />
    );

    expect((await screen.findAllByText("Избранное"))[0]).toBeVisible();
    await waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(2);
    });
    const options = useLiveEventsMock.mock.calls.at(-1)?.[0] as {
      onActivatedRefresh(): Promise<void>;
    };
    await options.onActivatedRefresh();

    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls.map(([request]) => requestPath(request))).toEqual([
      "/api/chats",
      "/api/chats/0/messages",
      "/api/chats",
      "/api/chats/0/messages"
    ]);
    expect(fetcher.mock.calls.some(([request]) =>
      requestPath(request).includes("read")
    )).toBe(false);
  });
});

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function matchMediaStub() {
  return {
    matches: false,
    media: "(min-width: 900px)",
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn()
  };
}

function requestPath(request: RequestInfo | URL): string {
  if (typeof request === "string") {
    return request;
  }
  return request instanceof URL ? request.href : request.url;
}
