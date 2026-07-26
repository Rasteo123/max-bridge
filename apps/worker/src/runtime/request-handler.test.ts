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
    submitPhone: () => Promise.resolve({ state: "code_required" }),
    submitCode: () => Promise.resolve({
      result: { state: "authenticated" },
      storageStateBase64: "e30="
    }),
    getQrPng: () => Promise.resolve(Buffer.from("png")),
    status: () => Promise.resolve({ state: "authenticated" }),
    listChats: () => Promise.resolve([]),
    history: () => Promise.resolve([]),
    sendText: () => Promise.resolve({
      state: "confirmed",
      operationId: "1",
      messageId: "2"
    }),
    close: () => Promise.resolve()
  };
}
