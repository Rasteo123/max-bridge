// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import "../../test-setup.js";
import { ApiClient } from "../../api/client.js";
import { AuthGate } from "../auth/AuthGate.js";
import type { TelegramWebApp } from "../auth/telegram.js";
import { PhoneLogin } from "./PhoneLogin.js";
import { QrLogin } from "./QrLogin.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Telegram onboarding", () => {
  const rawInitData = "query_id=secret%2Braw&hash=signed";

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("passes raw initData only to the same-origin auth endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ state: "approved_unbound" }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      ));
    const client = new ApiClient(fetcher);

    await client.authenticateTelegram(rawInitData);
    await client.getMe();

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/auth/telegram",
      expect.objectContaining({
        credentials: "include",
        body: JSON.stringify({ initData: rawInitData })
      })
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/me",
      expect.objectContaining({ credentials: "include" })
    );
    expect(fetcher.mock.contexts).toEqual([globalThis, globalThis]);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
  });

  it("calls ready and expand, then shows the approval screen", async () => {
    const ready = vi.fn();
    const expand = vi.fn();
    const telegram = telegramStub(rawInitData, ready, expand);
    const client = {
      authenticateTelegram: vi.fn().mockRejectedValue(
        Object.assign(new Error("forbidden"), {
          status: 403,
          code: "friend_approval_required"
        })
      ),
      getMe: vi.fn()
    };

    render(
      <AuthGate client={client} telegram={telegram}>
        <div>Секретная часть</div>
      </AuthGate>
    );

    expect(ready).toHaveBeenCalledOnce();
    expect(expand).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", {
      name: "Ожидаем подтверждения"
    })).toBeInTheDocument();
    expect(screen.queryByText("Секретная часть")).not.toBeInTheDocument();
  });

  it("does not trust an empty browser launch outside Telegram", async () => {
    const telegram = telegramStub("");
    const client = {
      authenticateTelegram: vi.fn(),
      getMe: vi.fn()
    };

    render(
      <AuthGate client={client} telegram={telegram}>
        <div>Секретная часть</div>
      </AuthGate>
    );

    expect(await screen.findByText(
      "Откройте приложение из доверенного Telegram-бота."
    )).toBeInTheDocument();
    expect(client.authenticateTelegram).not.toHaveBeenCalled();
  });

  it("blocks a disabled account", async () => {
    const client = {
      authenticateTelegram: vi.fn().mockResolvedValue(undefined),
      getMe: vi.fn().mockResolvedValue({ state: "disabled" })
    };

    render(
      <AuthGate client={client} telegram={telegramStub(rawInitData)}>
        <div>Секретная часть</div>
      </AuthGate>
    );

    expect(await screen.findByRole("heading", {
      name: "Доступ отключён"
    })).toBeInTheDocument();
    expect(screen.queryByText("Секретная часть")).not.toBeInTheDocument();
  });

  it("allows a user whose MAX session needs reauthentication", async () => {
    const client = {
      authenticateTelegram: vi.fn().mockResolvedValue(undefined),
      getMe: vi.fn().mockResolvedValue({ state: "reauth_required" })
    };

    render(
      <AuthGate client={client} telegram={telegramStub(rawInitData)}>
        <div>Повторный вход в MAX</div>
      </AuthGate>
    );

    expect(await screen.findByText("Повторный вход в MAX"))
      .toBeInTheDocument();
  });
});

describe("MAX login", () => {
  it("submits phone and SMS code without Telegram sendData", async () => {
    const user = userEvent.setup();
    const telegramSendData = vi.fn();
    const client = {
      submitPhone: vi.fn().mockResolvedValue({ state: "code_required" }),
      submitCode: vi.fn().mockResolvedValue({ state: "authenticated" })
    };
    const authenticated = vi.fn();

    render(
      <PhoneLogin
        client={client}
        initialState="method_required"
        onAuthenticated={authenticated}
      />
    );

    await user.type(screen.getByLabelText("Номер телефона"), "+79991234567");
    await user.click(screen.getByRole("button", { name: "Получить код" }));
    expect(client.submitPhone).toHaveBeenCalledWith("+79991234567");

    const code = await screen.findByLabelText("Код из SMS");
    await user.type(code, "123456");
    await user.click(screen.getByRole("button", { name: "Войти" }));

    expect(client.submitCode).toHaveBeenCalledWith("123456");
    expect(authenticated).toHaveBeenCalledOnce();
    expect(telegramSendData).not.toHaveBeenCalled();
    await waitFor(() => expect(code).toHaveValue(""));
  });

  it("clears the phone field when the screen unmounts", async () => {
    const user = userEvent.setup();
    const client = {
      submitPhone: vi.fn(),
      submitCode: vi.fn()
    };
    const view = render(
      <PhoneLogin
        client={client}
        initialState="method_required"
        onAuthenticated={vi.fn()}
      />
    );

    await user.type(screen.getByLabelText("Номер телефона"), "+79991234567");
    view.unmount();
    render(
      <PhoneLogin
        client={client}
        initialState="method_required"
        onAuthenticated={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Номер телефона")).toHaveValue("");
  });

  it("refreshes an expired QR without caching it", async () => {
    const user = userEvent.setup();
    render(<QrLogin refreshAfterMs={60_000} />);
    const image = screen.getByRole("img", { name: "QR-код для входа в MAX" });
    const firstSrc = image.getAttribute("src");

    await user.click(screen.getByRole("button", { name: "Обновить QR-код" }));

    expect(image.getAttribute("src")).not.toBe(firstSrc);
    expect(image.getAttribute("src")).toMatch(
      /^\/api\/max\/login\/qr\?nonce=/
    );
  });

  it("automatically rotates an expired QR", () => {
    vi.useFakeTimers();
    render(<QrLogin refreshAfterMs={1_000} />);
    const image = screen.getByRole("img", { name: "QR-код для входа в MAX" });
    const firstSrc = image.getAttribute("src");

    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(image.getAttribute("src")).not.toBe(firstSrc);
  });
});

function telegramStub(
  initData: string,
  ready = vi.fn(),
  expand = vi.fn()
): TelegramWebApp {
  return {
    initData,
    ready,
    expand,
    themeParams: {}
  };
}
