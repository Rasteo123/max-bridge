import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionPrincipal } from "../auth/session-store.js";
import {
  registerMessageRoutes,
  type MessageGateway
} from "./messages.js";

const allowedOrigin = "https://max-users.online";
const principal: SessionPrincipal = {
  userLookup: "u_synthetic",
  userState: "active"
};

let app: FastifyInstance;
let gateway: FakeMessageGateway;
let authenticated = true;

beforeEach(async () => {
  authenticated = true;
  gateway = new FakeMessageGateway();
  app = Fastify({
    logger: false,
    ajv: {
      customOptions: {
        removeAdditional: false
      }
    }
  });
  await app.register(registerMessageRoutes, {
    gateway,
    allowedOrigins: new Set([allowedOrigin]),
    resolvePrincipal: () => authenticated ? principal : null
  });
});

afterEach(async () => {
  await app.close();
});

describe("message routes", () => {
  it("requires an authenticated session and same-origin mutation", async () => {
    authenticated = false;
    const unauthenticated = await sendText();
    expect(unauthenticated.statusCode).toBe(401);

    authenticated = true;
    const wrongOrigin = await sendText("https://attacker.invalid");
    expect(wrongOrigin.statusCode).toBe(403);
    expect(gateway.sendCalls).toBe(0);
  });

  it("rejects client-supplied user identity", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/messages",
      headers: { origin: allowedOrigin },
      payload: {
        kind: "text",
        chatId: "1001",
        clientRequestId: "client-request-1",
        text: "hello",
        userId: "someone-else"
      }
    });

    expect(response.statusCode).toBe(400);
  });

  it("zeros temporary message bytes after handing them to the gateway", async () => {
    const response = await sendText();

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      state: "confirmed",
      operationId: "op-1",
      messageId: "message-1"
    });
    expect(gateway.observedText?.every((byte) => byte === 0)).toBe(true);
  });

  it("sends replies without exposing a user identity field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/messages",
      headers: { origin: allowedOrigin },
      payload: {
        kind: "text",
        chatId: "1001",
        clientRequestId: "client-request-reply",
        replyToId: "message-parent",
        text: "Ответ"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(gateway.observedReplyToId).toBe("message-parent");
  });

  it("requires explicit confirmation for an ambiguous retry", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/messages/retry",
      headers: { origin: allowedOrigin },
      payload: {
        kind: "text",
        retryOf: "client-old",
        clientRequestId: "client-new",
        chatId: "1001",
        text: "Повтор",
        confirmedByUser: false
      }
    });

    expect(response.statusCode).toBe(400);
    expect(gateway.retryCalls).toBe(0);
  });

  it("edits a message and zeros temporary text bytes", async () => {
    const response = await app.inject({
      method: "PATCH",
      url: "/api/chats/1001/messages/message-1",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-edit-1",
        text: "Исправлено"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(gateway.editCalls).toBe(1);
    expect(gateway.observedEditText?.every((byte) => byte === 0)).toBe(true);
  });

  it("requires confirmation before deleting a message", async () => {
    const rejected = await app.inject({
      method: "POST",
      url: "/api/chats/1001/messages/message-1/delete",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-delete-1",
        confirmedByUser: false
      }
    });
    expect(rejected.statusCode).toBe(400);
    expect(gateway.deleteCalls).toBe(0);

    const confirmed = await app.inject({
      method: "POST",
      url: "/api/chats/1001/messages/message-1/delete",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-delete-2",
        confirmedByUser: true
      }
    });
    expect(confirmed.statusCode).toBe(200);
    expect(gateway.deleteCalls).toBe(1);
  });

  it("forwards to one to ten targets without client identity fields", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/chats/1001/messages/message-1/forward",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-forward-1",
        destinationIds: ["2002", "3003"]
      }
    });

    expect(response.statusCode).toBe(200);
    expect(gateway.forwardInput).toEqual({
      userLookup: principal.userLookup,
      sourceChatId: "1001",
      sourceMessageId: "message-1",
      destinationIds: ["2002", "3003"],
      clientRequestId: "client-forward-1"
    });

    const injectedIdentity = await app.inject({
      method: "POST",
      url: "/api/chats/1001/messages/message-1/forward",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-forward-2",
        destinationIds: ["2002"],
        telegramId: "765023410"
      }
    });
    expect(injectedIdentity.statusCode).toBe(400);
  });

  it("sets and removes an allowlisted reaction", async () => {
    const set = await app.inject({
      method: "PUT",
      url: "/api/chats/1001/messages/message-1/reaction",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-reaction-1",
        reaction: "heart"
      }
    });
    const remove = await app.inject({
      method: "PUT",
      url: "/api/chats/1001/messages/message-1/reaction",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-reaction-2",
        reaction: null
      }
    });

    expect(set.statusCode).toBe(200);
    expect(remove.statusCode).toBe(200);
    expect(gateway.reactions).toEqual(["heart", null]);

    const unknown = await app.inject({
      method: "PUT",
      url: "/api/chats/1001/messages/message-1/reaction",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-reaction-3",
        reaction: "unknown"
      }
    });
    expect(unknown.statusCode).toBe(400);
  });

  it("requires confirmation before clearing or deleting a chat", async () => {
    const mute = await app.inject({
      method: "POST",
      url: "/api/chats/1001/actions",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-action-1",
        action: "mute"
      }
    });
    expect(mute.statusCode).toBe(200);

    const clear = await app.inject({
      method: "POST",
      url: "/api/chats/1001/actions",
      headers: { origin: allowedOrigin },
      payload: {
        clientRequestId: "client-action-2",
        action: "clear"
      }
    });
    expect(clear.statusCode).toBe(400);
    expect(gateway.chatActions).toEqual(["mute"]);
  });

  it("lists stickers for the authenticated user and sends one", async () => {
    const list = await app.inject({
      method: "GET",
      url: "/api/chats/1001/stickers"
    });
    expect(list.statusCode).toBe(200);
    expect(list.headers["cache-control"]).toBe("no-store");
    expect(list.json()).toEqual({
      stickers: [{
        id: "sticker-1",
        previewDataUrl: `data:image/png;base64,${"A".repeat(32)}`
      }]
    });

    const send = await app.inject({
      method: "POST",
      url: "/api/chats/1001/stickers/sticker-1",
      headers: { origin: allowedOrigin },
      payload: { clientRequestId: "client-sticker-1" }
    });
    expect(send.statusCode).toBe(200);
    expect(gateway.stickersSent).toEqual(["sticker-1"]);

    authenticated = false;
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/api/chats/1001/stickers"
    });
    expect(unauthenticated.statusCode).toBe(401);
  });

  it.each([
    {
      method: "PATCH" as const,
      url: "/api/chats/1001/messages/message-1",
      payload: { clientRequestId: "client-1", text: "Исправлено" }
    },
    {
      method: "POST" as const,
      url: "/api/chats/1001/messages/message-1/delete",
      payload: {
        clientRequestId: "client-2",
        confirmedByUser: true
      }
    },
    {
      method: "PUT" as const,
      url: "/api/chats/1001/messages/message-1/reaction",
      payload: { clientRequestId: "client-3", reaction: "like" }
    },
    {
      method: "POST" as const,
      url: "/api/chats/1001/messages/message-1/forward",
      payload: {
        clientRequestId: "client-forward",
        destinationIds: ["2002"]
      }
    },
    {
      method: "POST" as const,
      url: "/api/chats/1001/actions",
      payload: { clientRequestId: "client-4", action: "pin" }
    },
    {
      method: "POST" as const,
      url: "/api/chats/1001/stickers/sticker-1",
      payload: { clientRequestId: "client-5" }
    }
  ])("rejects cross-origin $method $url mutations", async (input) => {
    const response = await app.inject({
      ...input,
      headers: { origin: "https://attacker.invalid" }
    });
    expect(response.statusCode).toBe(403);
  });
});

function sendText(origin = allowedOrigin) {
  return app.inject({
    method: "POST",
    url: "/api/messages",
    headers: { origin },
    payload: {
      kind: "text",
      chatId: "1001",
      clientRequestId: "client-request-1",
      text: "Синтетическое сообщение"
    }
  });
}

class FakeMessageGateway implements MessageGateway {
  sendCalls = 0;
  retryCalls = 0;
  editCalls = 0;
  deleteCalls = 0;
  forwardInput: Record<string, unknown> | undefined;
  observedText: Uint8Array | undefined;
  observedEditText: Uint8Array | undefined;
  observedReplyToId: string | undefined;
  reactions: Array<string | null> = [];
  chatActions: string[] = [];
  stickersSent: string[] = [];

  sendText(
    _userLookup: string,
    input: Readonly<{
      chatId: string;
      clientRequestId: string;
      text: Uint8Array;
      replyToId?: string;
    }>
  ) {
    this.sendCalls += 1;
    this.observedText = input.text;
    this.observedReplyToId = input.replyToId;
    return Promise.resolve({
      state: "confirmed" as const,
      operationId: "op-1",
      messageId: "message-1"
    });
  }

  retryText(): Promise<Readonly<{ state: "confirmed"; operationId: string }>> {
    this.retryCalls += 1;
    return Promise.resolve({
      state: "confirmed",
      operationId: "op-2"
    });
  }

  editMessage(
    _userLookup: string,
    input: Readonly<{ text: Uint8Array }>
  ): Promise<Readonly<{ state: "confirmed"; operationId: string }>> {
    this.editCalls += 1;
    this.observedEditText = input.text;
    return Promise.resolve({
      state: "confirmed",
      operationId: "op-edit"
    });
  }

  deleteMessage(): Promise<
    Readonly<{ state: "confirmed"; operationId: string }>
  > {
    this.deleteCalls += 1;
    return Promise.resolve({
      state: "confirmed",
      operationId: "op-delete"
    });
  }

  forwardMessage(
    userLookup: string,
    input: Readonly<{
      sourceChatId: string;
      sourceMessageId: string;
      destinationIds: readonly string[];
      clientRequestId: string;
    }>
  ): Promise<Readonly<{ state: "confirmed"; operationId: string }>> {
    this.forwardInput = {
      userLookup,
      ...input,
      destinationIds: [...input.destinationIds]
    };
    return Promise.resolve({
      state: "confirmed",
      operationId: "op-forward"
    });
  }

  setReaction(
    _userLookup: string,
    input: Readonly<{ reaction: string | null }>
  ): Promise<Readonly<{ state: "confirmed"; operationId: string }>> {
    this.reactions.push(input.reaction);
    return Promise.resolve({
      state: "confirmed",
      operationId: "op-reaction"
    });
  }

  chatAction(
    _userLookup: string,
    input: Readonly<{ action: string }>
  ): Promise<Readonly<{ state: "confirmed"; operationId: string }>> {
    this.chatActions.push(input.action);
    return Promise.resolve({
      state: "confirmed",
      operationId: "op-chat-action"
    });
  }

  listStickers() {
    return Promise.resolve([{
      id: "sticker-1",
      previewDataUrl: `data:image/png;base64,${"A".repeat(32)}`
    }]);
  }

  sendSticker(
    _userLookup: string,
    input: Readonly<{ stickerId: string }>
  ): Promise<Readonly<{ state: "confirmed"; operationId: string }>> {
    this.stickersSent.push(input.stickerId);
    return Promise.resolve({
      state: "confirmed",
      operationId: "op-sticker"
    });
  }
}
