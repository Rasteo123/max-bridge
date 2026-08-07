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
import {
  DEFAULT_NOTIFICATIONS,
  SettingsPane,
  type MessengerAccountSettings
} from "./SettingsPane.js";

afterEach(() => {
  cleanup();
  resetBackHandlers();
  vi.restoreAllMocks();
});

const settings: MessengerAccountSettings = {
  profile: {
    title: "Вячеслав",
    description: "Тестовый профиль",
    link: "https://max.ru/rasteo"
  },
  sessions: [
    {
      client: "MAX WEB",
      info: "Electron, macOS",
      location: "Russian Federation, Sverdlovsk",
      seenAt: "2026-08-07T14:37:16.871Z",
      current: true
    },
    {
      client: "MAX WEB",
      info: "Chrome, macOS",
      location: "Russian Federation, Sverdlovsk",
      seenAt: "2026-08-07T13:34:05.322Z",
      current: false
    }
  ],
  blocked: [{
    id: "50785221",
    kind: "direct",
    title: "Заблокированный",
    preview: "",
    timestamp: "2026-08-07T14:00:00.000Z",
    unreadCount: 0,
    muted: false
  }]
};

function renderPane(
  overrides: Partial<Parameters<typeof SettingsPane>[0]> = {}
) {
  return render(
    <SettingsPane
      settings={settings}
      loading={false}
      theme="system"
      onThemeChange={() => undefined}
      notifications={DEFAULT_NOTIFICATIONS}
      onNotificationsChange={() => undefined}
      onClose={() => undefined}
      {...overrides}
    />
  );
}

describe("settings screen", () => {
  it("lists the sections MAX has, with the account on top", () => {
    renderPane();

    const pane = screen.getByTestId("settings-pane");
    expect(pane.textContent).toContain("Вячеслав");
    expect(pane.textContent).toContain("max.ru/rasteo");
    for (const label of [
      "Папки",
      "Безопасность",
      "Устройства",
      "Уведомления",
      "Оформление",
      "О приложении",
      "Помощь"
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("shows every signed-in device and marks the current one", () => {
    renderPane();

    fireEvent.click(screen.getByRole("button", { name: /Устройства/u }));

    const pane = screen.getByTestId("settings-pane");
    expect(pane.textContent).toContain("Electron, macOS");
    expect(pane.textContent).toContain("Chrome, macOS");
    expect(screen.getByText("этот сеанс")).toBeTruthy();
  });

  it("shows the blocked list under security", () => {
    renderPane();

    fireEvent.click(screen.getByRole("button", { name: /Безопасность/u }));

    expect(screen.getByText("Заблокированный")).toBeTruthy();
  });

  it("saves a notification toggle", () => {
    const onNotificationsChange = vi.fn();
    renderPane({ onNotificationsChange });

    fireEvent.click(screen.getByRole("button", { name: /Уведомления/u }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Звук" }));

    expect(onNotificationsChange).toHaveBeenCalledWith({
      ...DEFAULT_NOTIFICATIONS,
      sound: false
    });
  });

  it("changes the theme from appearance", () => {
    const onThemeChange = vi.fn();
    renderPane({ onThemeChange });

    fireEvent.click(screen.getByRole("button", { name: /Оформление/u }));
    fireEvent.click(screen.getByRole("radio", { name: "Тёмная" }));

    expect(onThemeChange).toHaveBeenCalledWith("dark");
  });

  it("returns to the root section before closing on back", async () => {
    const onClose = vi.fn();
    renderPane({ onClose });
    fireEvent.click(screen.getByRole("button", { name: /Устройства/u }));

    expect(backHandlerDepth()).toBe(1);
    await act(async () => {
      runTopBackHandler();
      await Promise.resolve();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("Папки")).toBeTruthy();

    await act(async () => {
      runTopBackHandler();
      await Promise.resolve();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says so when the account could not be read", () => {
    render(
      <SettingsPane
        loading={false}
        failed
        theme="system"
        onThemeChange={() => undefined}
        notifications={DEFAULT_NOTIFICATIONS}
        onNotificationsChange={() => undefined}
        onClose={() => undefined}
      />
    );

    expect(screen.getByText("Не удалось загрузить профиль")).toBeTruthy();
  });
});
