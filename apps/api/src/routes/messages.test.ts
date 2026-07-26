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
  observedText: Uint8Array | undefined;

  sendText(
    _userLookup: string,
    input: Readonly<{
      chatId: string;
      clientRequestId: string;
      text: Uint8Array;
    }>
  ) {
    this.sendCalls += 1;
    this.observedText = input.text;
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
}
