import { describe, expect, it, vi } from "vitest";

import type { WorkerRequest } from "@maxbridge/protocol";

import {
  WorkerRuntimeRequestHandler,
  type RuntimeMaxSession,
  type RuntimeSessionFactory
} from "./request-handler.js";

const handle = "s_AbCdEfGhIjKlMnOpQrStUv";

describe("WorkerRuntimeRequestHandler", () => {
  it("opens one isolated runtime session and routes chat operations", async () => {
    const session = fakeSession();
    const open = vi.fn<RuntimeSessionFactory["open"]>(
      () => Promise.resolve(session)
    );
    const close = vi.fn<RuntimeSessionFactory["close"]>(
      () => Promise.resolve()
    );
    const runtime = new WorkerRuntimeRequestHandler({
      factory: { open, close },
      healthy: () => true
    });

    await expect(runtime.handle(request("session.open", {
      storageStateBase64: Buffer.from('{"cookies":[],"origins":[]}')
        .toString("base64")
    }))).resolves.toMatchObject({ ok: true });
    await expect(runtime.handle(request("chats.list")))
      .resolves.toMatchObject({
        ok: true,
        payload: { chats: [] }
      });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toBe(handle);
    expect(open.mock.calls[0]?.[1]).toBeInstanceOf(Uint8Array);
    await runtime.close();
    expect(close).toHaveBeenCalledWith(handle, session);
  });

  it("rejects operations for a different or unopened session", async () => {
    const runtime = new WorkerRuntimeRequestHandler({
      factory: {
        open: () => Promise.resolve(fakeSession()),
        close: () => Promise.resolve()
      },
      healthy: () => true
    });

    await expect(runtime.handle(request("messages.history", {
      chatId: "1"
    }))).resolves.toMatchObject({
      ok: false,
      errorCode: "session_not_found"
    });
  });

  it("passes the history cursor through to the session", async () => {
    const history = vi.fn<RuntimeMaxSession["history"]>(
      () => Promise.resolve([])
    );
    const runtime = new WorkerRuntimeRequestHandler({
      factory: {
        open: () => Promise.resolve({ ...fakeSession(), history }),
        close: () => Promise.resolve()
      },
      healthy: () => true
    });
    await runtime.handle(request("session.open", {
      storageStateBase64: Buffer.from('{"cookies":[],"origins":[]}')
        .toString("base64")
    }));

    await runtime.handle(request("messages.history", {
      chatId: "1",
      cursor: "2026-08-04T08:01:25.766Z"
    }));

    // The payload already tolerated a cursor but only ever read chatId, so
    // every page request answered with the same newest messages.
    expect(history).toHaveBeenCalledWith("1", "2026-08-04T08:01:25.766Z");
    await runtime.close();
  });

  it("never reflects private login or message payloads in failures", async () => {
    const runtime = new WorkerRuntimeRequestHandler({
      factory: {
        open: () => Promise.resolve(fakeSession()),
        close: () => Promise.resolve()
      },
      healthy: () => true
    });
    const response = await runtime.handle(request("login.phone", {
      phone: "CANARY_PRIVATE_PHONE"
    }));

    expect(response).toEqual({
      kind: "response",
      requestId: "r_AbCdEfGhIjKlMnOpQrStUv",
      ok: false,
      errorCode: "session_not_found"
    });
    expect(JSON.stringify(response)).not.toContain("CANARY");
  });

  it("accepts only normalized CAPTCHA pointer coordinates", async () => {
    const session = fakeSession();
    const sendCaptchaPointer = vi.spyOn(session, "sendCaptchaPointer");
    const runtime = new WorkerRuntimeRequestHandler({
      factory: {
        open: () => Promise.resolve(session),
        close: () => Promise.resolve()
      },
      healthy: () => true
    });
    await runtime.handle(request("session.open"));

    await expect(runtime.handle(request("login.captcha.pointer", {
      phase: "move",
      x: 0.4,
      y: 0.6
    }))).resolves.toMatchObject({
      ok: true,
      payload: { state: "captcha_required" }
    });
    expect(sendCaptchaPointer).toHaveBeenCalledWith({
      phase: "move",
      x: 0.4,
      y: 0.6
    });

    await expect(runtime.handle(request("login.captcha.pointer", {
      phase: "down",
      x: -1,
      y: 0.5
    }))).resolves.toMatchObject({
      ok: false,
      errorCode: "worker_failure"
    });
  });

  it("serializes page operations within one MAX account", async () => {
    let releaseStatus: (() => void) | undefined;
    const session = fakeSession();
    const statusMock = vi.fn<RuntimeMaxSession["status"]>(
      () => new Promise((resolve) => {
        releaseStatus = () => {
          resolve({ state: "authenticated" });
        };
      })
    );
    const listChatsMock = vi.fn(() => Promise.resolve([]));
    session.status = statusMock;
    session.listChats = listChatsMock;
    const runtime = new WorkerRuntimeRequestHandler({
      factory: {
        open: () => Promise.resolve(session),
        close: () => Promise.resolve()
      },
      healthy: () => true
    });
    await runtime.handle(request("session.open"));

    const status = runtime.handle(request("login.status"));
    await vi.waitFor(() => {
      expect(statusMock).toHaveBeenCalledOnce();
    });
    const chats = runtime.handle(request("chats.list"));
    await Promise.resolve();

    expect(listChatsMock).not.toHaveBeenCalled();
    releaseStatus?.();
    await expect(status).resolves.toMatchObject({ ok: true });
    await expect(chats).resolves.toMatchObject({
      ok: true,
      payload: { chats: [] }
    });
  });

  it("routes bounded message and chat mutations", async () => {
    const session = fakeSession();
    const sendText = vi.spyOn(session, "sendText");
    const sendAttachment = vi.spyOn(session, "sendAttachment");
    const editMessage = vi.spyOn(session, "editMessage");
    const deleteMessage = vi.spyOn(session, "deleteMessage");
    const forwardMessage = vi.spyOn(session, "forwardMessage");
    const setReaction = vi.spyOn(session, "setReaction");
    const chatAction = vi.spyOn(session, "chatAction");
    const listStickers = vi.spyOn(session, "listStickers");
    const sendSticker = vi.spyOn(session, "sendSticker");
    const runtime = new WorkerRuntimeRequestHandler({
      factory: {
        open: () => Promise.resolve(session),
        close: () => Promise.resolve()
      },
      healthy: () => true
    });
    await runtime.handle(request("session.open"));

    await runtime.handle(request("message.send", {
      chatId: "chat-1",
      clientRequestId: "request-1",
      text: "Ответ",
      replyToId: "message-0"
    }));
    await runtime.handle(request("message.sendAttachment", {
      chatId: "chat-1",
      filePath: "/run/maxbridge/media/upload/file.bin",
      kind: "file",
      clientRequestId: "request-attachment"
    }));
    await runtime.handle(request("message.edit", {
      chatId: "chat-1",
      messageId: "message-1",
      clientRequestId: "request-2",
      text: "Исправлено"
    }));
    await runtime.handle(request("message.delete", {
      chatId: "chat-1",
      messageId: "message-1",
      clientRequestId: "request-3",
      confirmedByUser: true
    }));
    await runtime.handle(request("message.forward", {
      sourceChatId: "chat-1",
      sourceMessageId: "message-1",
      destinationIds: ["chat-2", "channel-3"],
      clientRequestId: "request-forward"
    }));
    await runtime.handle(request("message.reaction.set", {
      chatId: "chat-1",
      messageId: "message-2",
      clientRequestId: "request-4",
      reaction: "heart"
    }));
    await runtime.handle(request("chat.action", {
      chatId: "chat-1",
      clientRequestId: "request-5",
      action: "mute"
    }));
    await runtime.handle(request("stickers.list", {
      chatId: "chat-1"
    }));
    await runtime.handle(request("sticker.send", {
      chatId: "chat-1",
      stickerId: "sticker-1",
      clientRequestId: "request-6"
    }));

    expect(sendText).toHaveBeenCalledWith(
      "chat-1",
      "Ответ",
      "message-0"
    );
    expect(sendAttachment).toHaveBeenCalledWith({
      chatId: "chat-1",
      filePath: "/run/maxbridge/media/upload/file.bin",
      kind: "file"
    });
    expect(editMessage).toHaveBeenCalledWith(
      "chat-1",
      "message-1",
      "Исправлено"
    );
    expect(deleteMessage).toHaveBeenCalledWith(
      "chat-1",
      "message-1",
      false
    );
    expect(forwardMessage).toHaveBeenCalledWith(
      "chat-1",
      "message-1",
      ["chat-2", "channel-3"]
    );
    expect(setReaction).toHaveBeenCalledWith(
      "chat-1",
      "message-2",
      "heart"
    );
    expect(chatAction).toHaveBeenCalledWith("chat-1", "mute");
    expect(listStickers).toHaveBeenCalledWith("chat-1");
    expect(sendSticker).toHaveBeenCalledWith("chat-1", "sticker-1");
  });

  it("rejects forward payload identity fields and duplicate targets", async () => {
    const session = fakeSession();
    const forwardMessage = vi.spyOn(session, "forwardMessage");
    const runtime = new WorkerRuntimeRequestHandler({
      factory: {
        open: () => Promise.resolve(session),
        close: () => Promise.resolve()
      },
      healthy: () => true
    });
    await runtime.handle(request("session.open"));

    await expect(runtime.handle(request("message.forward", {
      sourceChatId: "chat-1",
      sourceMessageId: "message-1",
      destinationIds: ["chat-2"],
      clientRequestId: "request-1",
      telegramId: "765023410"
    }))).resolves.toMatchObject({
      ok: false,
      errorCode: "worker_failure"
    });
    await expect(runtime.handle(request("message.forward", {
      sourceChatId: "chat-1",
      sourceMessageId: "message-1",
      destinationIds: ["chat-2", "chat-2"],
      clientRequestId: "request-2"
    }))).resolves.toMatchObject({
      ok: false,
      errorCode: "worker_failure"
    });
    expect(forwardMessage).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation for destructive operations", async () => {
    const session = fakeSession();
    const runtime = new WorkerRuntimeRequestHandler({
      factory: {
        open: () => Promise.resolve(session),
        close: () => Promise.resolve()
      },
      healthy: () => true
    });
    await runtime.handle(request("session.open"));

    await expect(runtime.handle(request("message.delete", {
      chatId: "chat-1",
      messageId: "message-1",
      clientRequestId: "request-1",
      confirmedByUser: false
    }))).resolves.toMatchObject({
      ok: false,
      errorCode: "worker_failure"
    });
    await expect(runtime.handle(request("chat.action", {
      chatId: "chat-1",
      clientRequestId: "request-2",
      action: "clear"
    }))).resolves.toMatchObject({
      ok: false,
      errorCode: "worker_failure"
    });
  });
});

function request(
  operation: WorkerRequest["operation"],
  payload?: unknown
): WorkerRequest {
  return {
    kind: "request",
    requestId: "r_AbCdEfGhIjKlMnOpQrStUv",
    operation,
    sessionHandle: handle,
    ...(payload === undefined ? {} : { payload })
  };
}

function fakeSession(): RuntimeMaxSession {
  return {
    background: () => Promise.resolve(),
    submitPhone: () => Promise.resolve({ state: "code_required" }),
    submitCode: () => Promise.resolve({
      result: { state: "authenticated" },
      storageStateBase64: "e30="
    }),
    getQrPng: () => Promise.resolve(Buffer.from("png")),
    getCaptchaPng: () => Promise.resolve(Buffer.from("captcha")),
    sendCaptchaPointer: () => Promise.resolve({
      state: "captcha_required"
    }),
    status: () => Promise.resolve({ state: "authenticated" }),
    listChats: () => Promise.resolve([]),
    history: () => Promise.resolve([]),
    sendText: () => Promise.resolve({
      state: "confirmed",
      operationId: "1",
      messageId: "2"
    }),
    sendAttachment: () => Promise.resolve({
      state: "confirmed",
      operationId: "attachment-1"
    }),
    editMessage: () => Promise.resolve({
      state: "confirmed",
      operationId: "edit-1"
    }),
    deleteMessage: () => Promise.resolve({
      state: "confirmed",
      operationId: "delete-1"
    }),
    forwardMessage: () => Promise.resolve({
      state: "confirmed",
      operationId: "forward-1"
    }),
    setReaction: () => Promise.resolve({
      state: "confirmed",
      operationId: "reaction-1"
    }),
    chatAction: () => Promise.resolve({
      state: "confirmed",
      operationId: "chat-action-1"
    }),
    searchChats: () => Promise.resolve([]),
    describeContact: () => Promise.resolve(null),
    resolveChat: () => Promise.resolve(null),
    markRead: () => Promise.resolve(true),
    readSettings: () => Promise.resolve({
      profile: { title: "Профиль" },
      sessions: [],
      blocked: []
    }),
    subscribeToChat: () => Promise.resolve(null),
    unsubscribeFromChat: () => Promise.resolve(true),
    comments: () => Promise.resolve([]),
    openMedia: () => Promise.resolve({
      path: "/run/maxbridge/media/abc.bin",
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
      size: 3,
      expiresAt: Date.now() + 60_000
    }),
    listStickers: () => Promise.resolve([{
      id: "sticker-1",
      previewUrl: "https://i.oneme.ru/getSmile?smileId=abc"
    }]),
    sendSticker: () => Promise.resolve({
      state: "confirmed",
      operationId: "sticker-1"
    }),
    close: () => Promise.resolve()
  };
}
