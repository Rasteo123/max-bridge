// @vitest-environment jsdom

import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { AuthGate } from "./AuthGate.js";
import type {
  TelegramEvent,
  TelegramWebApp
} from "./telegram.js";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("Telegram Mini App host integration", () => {
  it("reapplies the current theme and removes the exact callback", async () => {
    let themeParams = { bg_color: "#112233" };
    const callbacks = new Map<TelegramEvent, () => void>();
    const onEvent = vi.fn((event: TelegramEvent, callback: () => void) => {
      callbacks.set(event, callback);
    });
    const offEvent = vi.fn();
    const telegram: TelegramWebApp = {
      initData: "signed-init-data",
      get themeParams() {
        return themeParams;
      },
      ready: vi.fn(),
      expand: vi.fn(),
      onEvent,
      offEvent
    };
    const client = {
      authenticateTelegram: vi.fn().mockResolvedValue(undefined),
      getMe: vi.fn().mockResolvedValue({ state: "active" as const })
    };

    const view = render(createElement(
      AuthGate,
      {
        client,
        telegram,
        children: createElement("div", null, "Чаты")
      }
    ));

    expect(await screen.findByText("Чаты")).toBeInTheDocument();
    expect(document.documentElement.style.getPropertyValue(
      "--tg-theme-bg-color"
    )).toBe("#112233");

    themeParams = { bg_color: "#445566" };
    callbacks.get("themeChanged")?.();
    expect(document.documentElement.style.getPropertyValue(
      "--tg-theme-bg-color"
    )).toBe("#445566");

    const themeCallback = callbacks.get("themeChanged");
    view.unmount();
    expect(offEvent).toHaveBeenCalledWith("themeChanged", themeCallback);
  });

  it("safely supports older hosts without optional capabilities or storage", async () => {
    const telegram: TelegramWebApp = {
      initData: "signed-init-data",
      themeParams: {},
      ready: vi.fn(),
      expand: vi.fn()
    };
    const client = {
      authenticateTelegram: vi.fn().mockResolvedValue(undefined),
      getMe: vi.fn().mockResolvedValue({ state: "active" as const })
    };

    render(createElement(
      AuthGate,
      {
        client,
        telegram,
        children: createElement("div", null, "Готово")
      }
    ));

    await waitFor(() => {
      expect(screen.getByText("Готово")).toBeInTheDocument();
    });
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });
});
