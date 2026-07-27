import { describe, expect, it, vi } from "vitest";

import type { BridgeEvent, UserRecord } from "@maxbridge/core";
import type { WorkerEvent } from "@maxbridge/protocol";

import {
  BridgeRuntimeGateway,
  type RuntimeUsers,
  type RuntimeWorker
} from "./bridge-runtime-gateway.js";

describe("BridgeRuntimeGateway", () => {
  it("restores one encrypted MAX session per opaque user lookup", async () => {
    const requests: unknown[] = [];
    const worker = fakeWorker((request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      if (request.operation === "chats.list") {
        return Promise.resolve({ chats: [] });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const users = fakeUsers();
    const gateway = new BridgeRuntimeGateway({ worker, users });

    await expect(gateway.list("u_AbCdEfGhIjKlMnOpQrStUv"))
      .resolves.toEqual([]);
    await gateway.list("u_AbCdEfGhIjKlMnOpQrStUv");

    expect(requests).toHaveLength(3);
    expect(requests[0]).toMatchObject({
      operation: "session.open",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv"
    });
    expect(JSON.stringify(requests[0])).not.toContain("123456789");
  });

  it("encrypts returned storage state and activates the user after SMS", async () => {
    const worker = fakeWorker((request) => {
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      if (request.operation === "login.code") {
        return Promise.resolve({
          result: { state: "authenticated" },
          storageStateBase64: Buffer.from(
            '{"cookies":[],"origins":[]}'
          ).toString("base64")
        });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const users = fakeUsers();
    const gateway = new BridgeRuntimeGateway({ worker, users });

    await expect(gateway.submitCode(
      "u_AbCdEfGhIjKlMnOpQrStUv",
      new TextEncoder().encode("123456")
    )).resolves.toEqual({ state: "authenticated" });

    expect(users.saveMock).toHaveBeenCalledOnce();
    expect(users.transitionMock).toHaveBeenCalledWith(
      "u_AbCdEfGhIjKlMnOpQrStUv",
      "active"
    );
  });

  it("returns the MAX page to the chat list after the last Mini App closes", async () => {
    vi.useFakeTimers();
    const requests: unknown[] = [];
    const worker = fakeWorker((request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      if (request.operation === "chats.list") {
        return Promise.resolve({ chats: [] });
      }
      if (request.operation === "session.background") {
        return Promise.resolve({ background: true });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });

    await gateway.list("u_AbCdEfGhIjKlMnOpQrStUv");
    const unsubscribe = gateway.subscribe(
      "u_AbCdEfGhIjKlMnOpQrStUv",
      () => undefined
    );
    unsubscribe();
    await vi.advanceTimersByTimeAsync(250);

    expect(requests).toContainEqual(expect.objectContaining({
      operation: "session.background",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv"
    }));
    vi.useRealTimers();
  });

  it("routes live events only to the matching Telegram user's MAX session", () => {
    let emit: ((event: WorkerEvent) => void) | undefined;
    const worker: RuntimeWorker = {
      request: () => Promise.resolve({ opened: true }),
      subscribe: (listener) => {
        emit = listener;
        return () => undefined;
      }
    };
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });
    const userA = "u_AbCdEfGhIjKlMnOpQrStUv";
    const userB = "u_ZyXwVuTsRqPoNmLkJiHgFe";
    const receivedA: BridgeEvent[] = [];
    const receivedB: BridgeEvent[] = [];
    gateway.subscribe(userA, (event) => receivedA.push(event));
    gateway.subscribe(userB, (event) => receivedB.push(event));
    const eventA = messageEvent("message-a", "chat-a");
    const eventB = messageEvent("message-b", "chat-b");

    emit?.({
      kind: "event",
      event: "session.event",
      sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
      payload: eventA
    });
    emit?.({
      kind: "event",
      event: "session.event",
      sessionHandle: "s_ZyXwVuTsRqPoNmLkJiHgFe",
      payload: eventB
    });

    expect(receivedA).toEqual([eventA]);
    expect(receivedB).toEqual([eventB]);
  });

  it("routes each forward through only that user's opaque session", async () => {
    const requests: unknown[] = [];
    const worker = fakeWorker((request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      return Promise.resolve({
        state: "confirmed",
        operationId: "forward"
      });
    });
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });

    await gateway.forwardMessage("u_AbCdEfGhIjKlMnOpQrStUv", {
      sourceChatId: "source-a",
      sourceMessageId: "message-a",
      destinationIds: ["destination-a"],
      clientRequestId: "request-a"
    });
    await gateway.forwardMessage("u_ZyXwVuTsRqPoNmLkJiHgFe", {
      sourceChatId: "source-b",
      sourceMessageId: "message-b",
      destinationIds: ["destination-b"],
      clientRequestId: "request-b"
    });

    const forwardRequests = requests.filter((value) => (
      value as { operation?: string }
    ).operation === "message.forward");
    expect(forwardRequests).toEqual([
      {
        operation: "message.forward",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          sourceChatId: "source-a",
          sourceMessageId: "message-a",
          destinationIds: ["destination-a"],
          clientRequestId: "request-a"
        }
      },
      {
        operation: "message.forward",
        sessionHandle: "s_ZyXwVuTsRqPoNmLkJiHgFe",
        payload: {
          sourceChatId: "source-b",
          sourceMessageId: "message-b",
          destinationIds: ["destination-b"],
          clientRequestId: "request-b"
        }
      }
    ]);
  });

  it("routes message and chat mutations through the user's session", async () => {
    const requests: unknown[] = [];
    const worker = fakeWorker((request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      if (request.operation === "stickers.list") {
        return Promise.resolve({
          stickers: [{
            id: "sticker-1",
            previewDataUrl: `data:image/png;base64,${"A".repeat(32)}`
          }]
        });
      }
      return Promise.resolve({
        state: "confirmed",
        operationId: `op-${request.operation}`
      });
    });
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });
    const userLookup = "u_AbCdEfGhIjKlMnOpQrStUv";

    await gateway.sendText(userLookup, {
      chatId: "chat-1",
      clientRequestId: "request-1",
      text: new TextEncoder().encode("Ответ"),
      replyToId: "message-0"
    });
    await gateway.editMessage(userLookup, {
      chatId: "chat-1",
      messageId: "message-1",
      clientRequestId: "request-2",
      text: new TextEncoder().encode("Исправлено")
    });
    await gateway.deleteMessage(userLookup, {
      chatId: "chat-1",
      messageId: "message-1",
      clientRequestId: "request-3",
      confirmedByUser: true
    });
    await gateway.forwardMessage(userLookup, {
      sourceChatId: "chat-1",
      sourceMessageId: "message-1",
      destinationIds: ["chat-2", "channel-3"],
      clientRequestId: "request-forward"
    });
    await gateway.setReaction(userLookup, {
      chatId: "chat-1",
      messageId: "message-2",
      clientRequestId: "request-4",
      reaction: "heart"
    });
    await gateway.chatAction(userLookup, {
      chatId: "chat-1",
      clientRequestId: "request-5",
      action: "mute"
    });
    await expect(gateway.listStickers(userLookup, "chat-1"))
      .resolves.toHaveLength(1);
    await gateway.sendSticker(userLookup, {
      chatId: "chat-1",
      stickerId: "sticker-1",
      clientRequestId: "request-6"
    });

    expect(requests.slice(1)).toEqual([
      {
        operation: "message.send",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          chatId: "chat-1",
          clientRequestId: "request-1",
          text: "Ответ",
          replyToId: "message-0"
        }
      },
      {
        operation: "message.edit",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          chatId: "chat-1",
          messageId: "message-1",
          clientRequestId: "request-2",
          text: "Исправлено"
        }
      },
      {
        operation: "message.delete",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          chatId: "chat-1",
          messageId: "message-1",
          clientRequestId: "request-3",
          confirmedByUser: true
        }
      },
      {
        operation: "message.forward",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          sourceChatId: "chat-1",
          sourceMessageId: "message-1",
          destinationIds: ["chat-2", "channel-3"],
          clientRequestId: "request-forward"
        }
      },
      {
        operation: "message.reaction.set",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          chatId: "chat-1",
          messageId: "message-2",
          clientRequestId: "request-4",
          reaction: "heart"
        }
      },
      {
        operation: "chat.action",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          chatId: "chat-1",
          clientRequestId: "request-5",
          action: "mute"
        }
      },
      {
        operation: "stickers.list",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          chatId: "chat-1"
        }
      },
      {
        operation: "sticker.send",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          chatId: "chat-1",
          stickerId: "sticker-1",
          clientRequestId: "request-6"
        }
      }
    ]);
  });
});

function messageEvent(id: string, chatId: string): BridgeEvent {
  return {
    type: "message.upsert",
    sequence: 1,
    occurredAt: "2026-01-01T00:00:00.000Z",
    message: {
      id,
      chatId,
      senderId: "sender",
      direction: "incoming",
      sentAt: "2026-01-01T00:00:00.000Z",
      status: "delivered",
      kind: "text",
      text: "Изолированное сообщение"
    }
  };
}

function fakeWorker(
  request: RuntimeWorker["request"]
): RuntimeWorker {
  return {
    request,
    subscribe: () => () => undefined
  };
}

function fakeUsers(): RuntimeUsers & {
  saveMock: ReturnType<typeof vi.fn>;
  transitionMock: ReturnType<typeof vi.fn>;
} {
  const saveMock = vi.fn(() => Promise.resolve());
  const transitionMock = vi.fn(
    (lookupId: string, state: UserRecord["state"]) => ({
      lookupId,
      state,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    })
  );
  return {
    saveMock,
    transitionMock,
    loadMaxSessionByLookup: () => Promise.resolve(
      new TextEncoder().encode('{"cookies":[],"origins":[]}')
    ),
    saveMaxSessionByLookup: saveMock,
    clearMaxSessionByLookup: vi.fn(),
    findUserByLookup: () => ({
      lookupId: "u_AbCdEfGhIjKlMnOpQrStUv",
      state: "authenticating",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    } satisfies UserRecord),
    transitionByLookup: transitionMock
  };
}
