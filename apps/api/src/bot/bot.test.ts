import { describe, expect, it } from "vitest";

import type { UserState } from "@maxbridge/core";

import {
  handleApprovalDecision,
  handleStart,
  type BotTransport,
  type FriendAccessGateway,
  type OutboundBotMessage
} from "./bot.js";
import { formatPrivateNotification } from "./notifications.js";

const actor = {
  telegramId: "123456789",
  firstName: "Синтетический",
  username: "synthetic_user"
} as const;

describe("friend approval bot", () => {
  it("creates one pending request and does not duplicate it", async () => {
    const transport = new FakeTransport();
    const gateway = new FakeAccessGateway();

    await handleStart(actor, {
      adminTelegramId: "999999999",
      miniAppUrl: "https://max-users.online",
      gateway,
      transport
    });
    await handleStart(actor, {
      adminTelegramId: "999999999",
      miniAppUrl: "https://max-users.online",
      gateway,
      transport
    });

    expect(gateway.requestCount).toBe(2);
    expect(transport.messages.filter(
      (message) => message.chatId === "999999999"
    )).toHaveLength(1);
    expect(transport.messages.filter(
      (message) => message.chatId === actor.telegramId
    )).toHaveLength(2);
  });

  it("puts an opaque request handle, not Telegram ID, in callbacks", async () => {
    const transport = new FakeTransport();
    const gateway = new FakeAccessGateway();

    await handleStart(actor, {
      adminTelegramId: "999999999",
      miniAppUrl: "https://max-users.online",
      gateway,
      transport
    });

    const adminMessage = transport.messages.find(
      (message) => message.chatId === "999999999"
    );
    const firstButton = adminMessage?.buttons?.[0];
    const callbackData = firstButton !== undefined
      && "callbackData" in firstButton
      ? firstButton.callbackData
      : "";
    expect(callbackData).toBe(
      "approval:allow:AbCdEfGhIjKlMnOpQrStUv"
    );
    expect(callbackData).not.toContain(actor.telegramId);
  });

  it("allows only the configured admin to decide", async () => {
    const transport = new FakeTransport();
    const gateway = new FakeAccessGateway();

    await handleApprovalDecision({
      actorTelegramId: "111111111",
      decision: "allow",
      requestHandle: "AbCdEfGhIjKlMnOpQrStUv"
    }, {
      adminTelegramId: "999999999",
      miniAppUrl: "https://max-users.online",
      gateway,
      transport
    });

    expect(gateway.decisions).toHaveLength(0);
    expect(transport.callbackAnswers).toContainEqual({
      telegramId: "111111111",
      text: "Недостаточно прав"
    });
  });

  it("notifies an approved user and gives the Mini App button", async () => {
    const transport = new FakeTransport();
    const gateway = new FakeAccessGateway();

    await handleApprovalDecision({
      actorTelegramId: "999999999",
      decision: "allow",
      requestHandle: "AbCdEfGhIjKlMnOpQrStUv"
    }, {
      adminTelegramId: "999999999",
      miniAppUrl: "https://max-users.online",
      gateway,
      transport
    });

    const userMessage = transport.messages.find(
      (message) => message.chatId === actor.telegramId
    );
    expect(userMessage?.buttons?.[0]).toEqual({
      text: "Открыть MAX",
      webAppUrl: "https://max-users.online"
    });
  });

  it("does not give a disabled user the Mini App button", async () => {
    const transport = new FakeTransport();
    const gateway = new FakeAccessGateway();
    gateway.state = "disabled";

    await handleStart(actor, {
      adminTelegramId: "999999999",
      miniAppUrl: "https://max-users.online",
      gateway,
      transport
    });

    expect(transport.messages[0]?.buttons).toBeUndefined();
    expect(transport.messages[0]?.text).toContain("отключён");
  });
});

describe("private notifications", () => {
  it("omits message body and media URL by default", () => {
    const notification = formatPrivateNotification({
      senderName: "Алексей",
      kind: "image",
      messageBody: "CANARY_PRIVATE_MESSAGE",
      mediaUrl: "https://private.invalid/CANARY_MEDIA_TOKEN"
    });

    expect(notification).toBe("Вам пришло сообщение от Алексей · Фото");
    expect(notification).not.toContain("CANARY_PRIVATE_MESSAGE");
    expect(notification).not.toContain("CANARY_MEDIA_TOKEN");
  });
});

class FakeTransport implements BotTransport {
  readonly messages: OutboundBotMessage[] = [];
  readonly callbackAnswers: Array<{
    telegramId: string;
    text: string;
  }> = [];

  send(message: OutboundBotMessage): Promise<void> {
    this.messages.push(message);
    return Promise.resolve();
  }

  answerCallback(telegramId: string, text: string): Promise<void> {
    this.callbackAnswers.push({ telegramId, text });
    return Promise.resolve();
  }
}

class FakeAccessGateway implements FriendAccessGateway {
  state: UserState = "pending";
  requestCount = 0;
  readonly decisions: Array<{
    requestHandle: string;
    decision: "allow" | "reject";
  }> = [];

  requestAccess(): Promise<{
    state: UserState;
    created: boolean;
    requestHandle?: string;
  }> {
    this.requestCount += 1;
    return Promise.resolve({
      state: this.state,
      created: this.requestCount === 1,
      ...(this.requestCount === 1
        ? { requestHandle: "AbCdEfGhIjKlMnOpQrStUv" }
        : {})
    });
  }

  decide(
    requestHandle: string,
    decision: "allow" | "reject"
  ): Promise<{
    telegramId: string;
    state: UserState;
  } | null> {
    this.decisions.push({ requestHandle, decision });
    if (decision === "allow") {
      return Promise.resolve({
        telegramId: actor.telegramId,
        state: "approved_unbound"
      });
    }
    return Promise.resolve({
      telegramId: actor.telegramId,
      state: "disabled"
    });
  }
}
