import { describe, expect, it, vi } from "vitest";

import type { BridgeEvent, UserRecord } from "@maxbridge/core";
import type { WorkerEvent } from "@maxbridge/protocol";

import {
  BridgeRuntimeGateway,
  type RuntimeUsers,
  type RuntimeWorker
} from "./bridge-runtime-gateway.js";
import { WorkerRequestError } from "../worker/worker-client.js";

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

  it("proactively reopens active sessions after the worker reconnects", async () => {
    const requests: unknown[] = [];
    let connectionListener: ((connected: boolean) => void) | undefined;
    const worker = {
      request: (request: Parameters<RuntimeWorker["request"]>[0]) => {
        requests.push(request);
        if (request.operation === "session.open") {
          return Promise.resolve({ opened: true });
        }
        if (request.operation === "chats.list") {
          return Promise.resolve({ chats: [] });
        }
        return Promise.reject(new Error("unexpected"));
      },
      subscribe: () => () => undefined,
      subscribeConnection: (listener: (connected: boolean) => void) => {
        connectionListener = listener;
        return () => undefined;
      }
    } as RuntimeWorker & {
      subscribeConnection(
        listener: (connected: boolean) => void
      ): () => void;
    };
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });

    await gateway.list("u_AbCdEfGhIjKlMnOpQrStUv");
    connectionListener?.(false);
    connectionListener?.(true);

    await vi.waitFor(() => {
      expect(requests.filter((value) => (
        value as { operation: string }
      ).operation === "session.open")).toHaveLength(2);
    });
  });

  it("retries a transient session restore failure without another reconnect", async () => {
    vi.useFakeTimers();
    let connectionListener: ((connected: boolean) => void) | undefined;
    let openAttempts = 0;
    const worker: RuntimeWorker = {
      request: (request) => {
        if (request.operation === "session.open") {
          openAttempts += 1;
          if (openAttempts === 2) {
            return Promise.reject(new WorkerRequestError("worker_failure"));
          }
          return Promise.resolve({ opened: true });
        }
        if (request.operation === "chats.list") {
          return Promise.resolve({ chats: [] });
        }
        return Promise.reject(new Error("unexpected"));
      },
      subscribe: () => () => undefined,
      subscribeConnection: (listener) => {
        connectionListener = listener;
        return () => undefined;
      }
    };
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });

    try {
      await gateway.list("u_AbCdEfGhIjKlMnOpQrStUv");
      connectionListener?.(false);
      connectionListener?.(true);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(openAttempts).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reopen healthy sessions while retrying a failed restore", async () => {
    vi.useFakeTimers();
    let connectionListener: ((connected: boolean) => void) | undefined;
    const opens = new Map<string, number>();
    const failingHandle = "s_ZyXwVuTsRqPoNmLkJiHgFe";
    const worker: RuntimeWorker = {
      request: (request) => {
        if (request.operation === "session.open") {
          const attempt = (opens.get(request.sessionHandle) ?? 0) + 1;
          opens.set(request.sessionHandle, attempt);
          if (request.sessionHandle === failingHandle && attempt > 1) {
            return Promise.reject(new WorkerRequestError("worker_failure"));
          }
          return Promise.resolve({ opened: true });
        }
        if (request.operation === "chats.list") {
          return Promise.resolve({ chats: [] });
        }
        return Promise.reject(new Error("unexpected"));
      },
      subscribe: () => () => undefined,
      subscribeConnection: (listener) => {
        connectionListener = listener;
        return () => undefined;
      }
    };
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });
    const healthy = "u_AbCdEfGhIjKlMnOpQrStUv";
    const failing = "u_ZyXwVuTsRqPoNmLkJiHgFe";

    try {
      await gateway.list(healthy);
      await gateway.list(failing);
      connectionListener?.(false);
      connectionListener?.(true);
      await vi.advanceTimersByTimeAsync(2_000);

      expect(opens.get("s_AbCdEfGhIjKlMnOpQrStUv")).toBe(2);
      expect(opens.get(failingHandle)).toBeGreaterThan(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reopen a logged-out session during worker reconnect", async () => {
    const requests: unknown[] = [];
    let connectionListener: ((connected: boolean) => void) | undefined;
    let openAttempts = 0;
    let recoveryStarted!: () => void;
    let releaseRecovery!: () => void;
    const recoveryStartedPromise = new Promise<void>((resolve) => {
      recoveryStarted = resolve;
    });
    const recoveryRelease = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const worker: RuntimeWorker = {
      request: async (request) => {
        requests.push(request);
        if (request.operation === "session.open") {
          openAttempts += 1;
          if (openAttempts === 2) {
            recoveryStarted();
            await recoveryRelease;
          }
          return { opened: true };
        }
        if (request.operation === "chats.list") {
          return { chats: [] };
        }
        if (request.operation === "session.close") {
          return { closed: true };
        }
        throw new Error("unexpected");
      },
      subscribe: () => () => undefined,
      subscribeConnection: (listener) => {
        connectionListener = listener;
        return () => undefined;
      }
    };
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });

    await gateway.list("u_AbCdEfGhIjKlMnOpQrStUv");
    connectionListener?.(false);
    connectionListener?.(true);
    await recoveryStartedPromise;
    const logout = gateway.logout("u_AbCdEfGhIjKlMnOpQrStUv");
    releaseRecovery();

    await expect(logout).resolves.toBeUndefined();
    expect(requests.filter((value) => (
      value as { operation: string }
    ).operation === "session.open")).toHaveLength(2);
    expect(requests.filter((value) => (
      value as { operation: string }
    ).operation === "session.close")).toHaveLength(1);
  });

  it("reopens a MAX session lost during an independent worker restart", async () => {
    const requests: unknown[] = [];
    let phoneAttempts = 0;
    const worker = fakeWorker((request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      if (request.operation === "login.phone") {
        phoneAttempts += 1;
        if (phoneAttempts === 1) {
          return Promise.reject(new WorkerRequestError("session_not_found"));
        }
        return Promise.resolve({ state: "code_required" });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });

    await expect(gateway.submitPhone(
      "u_AbCdEfGhIjKlMnOpQrStUv",
      new TextEncoder().encode("+79991234567")
    )).resolves.toEqual({ state: "code_required" });

    expect(requests.map((value) => (
      value as { operation: string }
    ).operation)).toEqual([
      "session.open",
      "login.phone",
      "session.open",
      "login.phone"
    ]);
  });

  it("does not reopen a session for an unrelated worker failure", async () => {
    const requests: unknown[] = [];
    const worker = fakeWorker((request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      return Promise.reject(new WorkerRequestError("worker_failure"));
    });
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });

    await expect(gateway.submitPhone(
      "u_AbCdEfGhIjKlMnOpQrStUv",
      new TextEncoder().encode("+79991234567")
    )).rejects.toMatchObject({ code: "worker_failure" });
    expect(requests.map((value) => (
      value as { operation: string }
    ).operation)).toEqual(["session.open", "login.phone"]);
  });

  it("does not recover a request whose session was logged out first", async () => {
    const requests: unknown[] = [];
    let phoneRequested!: () => void;
    let rejectPhone!: (error: Error) => void;
    const phoneRequestedPromise = new Promise<void>((resolve) => {
      phoneRequested = resolve;
    });
    const phoneResponse = new Promise<unknown>((_resolve, reject) => {
      rejectPhone = reject;
    });
    const worker = fakeWorker((request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      if (request.operation === "login.phone") {
        phoneRequested();
        return phoneResponse;
      }
      if (request.operation === "session.close") {
        return Promise.resolve({ closed: true });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });

    const login = gateway.submitPhone(
      "u_AbCdEfGhIjKlMnOpQrStUv",
      new TextEncoder().encode("+79991234567")
    ).then(
      () => null,
      (error: unknown) => error
    );
    await phoneRequestedPromise;
    await gateway.logout("u_AbCdEfGhIjKlMnOpQrStUv");
    rejectPhone(new WorkerRequestError("session_not_found"));

    await expect(login).resolves.toMatchObject({
      message: "Session lifecycle changed"
    });
    expect(requests.map((value) => (
      value as { operation: string }
    ).operation)).toEqual([
      "session.open",
      "login.phone",
      "session.close"
    ]);
  });

  it("serializes concurrent logout requests for the same user", async () => {
    const requests: unknown[] = [];
    let releaseClose!: () => void;
    const closeRelease = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const worker = fakeWorker(async (request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        return { opened: true };
      }
      if (request.operation === "chats.list") {
        return { chats: [] };
      }
      if (request.operation === "session.close") {
        await closeRelease;
        return { closed: true };
      }
      throw new Error("unexpected");
    });
    const users = fakeUsers();
    const gateway = new BridgeRuntimeGateway({ worker, users });
    const userLookup = "u_AbCdEfGhIjKlMnOpQrStUv";
    await gateway.list(userLookup);

    const first = gateway.logout(userLookup);
    const second = gateway.logout(userLookup);
    const statusDuringLogout = gateway.status(userLookup);
    await expect(statusDuringLogout).rejects.toThrow(
      "Session lifecycle changed"
    );
    releaseClose();

    await expect(Promise.all([first, second])).resolves.toEqual([
      undefined,
      undefined
    ]);
    expect(requests.filter((value) => (
      value as { operation: string }
    ).operation === "session.close")).toHaveLength(1);
    expect(requests.filter((value) => (
      value as { operation: string }
    ).operation === "session.open")).toHaveLength(1);
    expect(users.clearMock).toHaveBeenCalledOnce();
  });

  it("does not persist a successful login response completed after logout", async () => {
    let codeRequested!: () => void;
    let releaseCode!: () => void;
    const codeRequestedPromise = new Promise<void>((resolve) => {
      codeRequested = resolve;
    });
    const codeRelease = new Promise<void>((resolve) => {
      releaseCode = resolve;
    });
    const worker = fakeWorker(async (request) => {
      if (request.operation === "session.open") {
        return { opened: true };
      }
      if (request.operation === "login.code") {
        codeRequested();
        await codeRelease;
        return {
          result: { state: "authenticated" },
          storageStateBase64: Buffer.from(
            '{"cookies":[],"origins":[]}'
          ).toString("base64")
        };
      }
      if (request.operation === "session.close") {
        return { closed: true };
      }
      throw new Error("unexpected");
    });
    const users = fakeUsers();
    const gateway = new BridgeRuntimeGateway({ worker, users });
    const userLookup = "u_AbCdEfGhIjKlMnOpQrStUv";
    const login = gateway.submitCode(
      userLookup,
      new TextEncoder().encode("123456")
    );
    await codeRequestedPromise;

    await gateway.logout(userLookup);
    releaseCode();

    await expect(login).rejects.toThrow("Session lifecycle changed");
    expect(users.saveMock).not.toHaveBeenCalled();
  });

  it("clears credentials after logout waits for an in-flight session save", async () => {
    const order: string[] = [];
    let saveStarted!: () => void;
    let releaseSave!: () => void;
    const saveStartedPromise = new Promise<void>((resolve) => {
      saveStarted = resolve;
    });
    const saveRelease = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
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
      if (request.operation === "session.close") {
        return Promise.resolve({ closed: true });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const users = fakeUsers();
    users.saveMaxSessionByLookup = vi.fn(async () => {
      saveStarted();
      await saveRelease;
      order.push("saved");
    });
    users.clearMaxSessionByLookup = vi.fn(() => {
      order.push("cleared");
    });
    const gateway = new BridgeRuntimeGateway({ worker, users });
    const userLookup = "u_AbCdEfGhIjKlMnOpQrStUv";
    const login = gateway.submitCode(
      userLookup,
      new TextEncoder().encode("123456")
    );
    await saveStartedPromise;

    const logout = gateway.logout(userLookup);
    await Promise.resolve();
    expect(order).toEqual([]);
    releaseSave();

    await expect(logout).resolves.toBeUndefined();
    await expect(login).rejects.toThrow("Session lifecycle changed");
    expect(order).toEqual(["saved", "cleared"]);
    expect(users.transitionMock).not.toHaveBeenCalledWith(
      userLookup,
      "active"
    );
  });

  it("clears local credentials and closes a stale worker session later", async () => {
    const requests: string[] = [];
    let stored = true;
    let closeAttempts = 0;
    const worker = fakeWorker((request) => {
      requests.push(request.operation);
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      if (request.operation === "chats.list") {
        return Promise.resolve({ chats: [] });
      }
      if (request.operation === "session.close") {
        closeAttempts += 1;
        if (closeAttempts === 1) {
          return Promise.reject(new WorkerRequestError("worker_failure"));
        }
        return Promise.resolve({ closed: true });
      }
      if (request.operation === "login.status") {
        return Promise.resolve({ state: "method_required" });
      }
      return Promise.reject(new Error("unexpected"));
    });
    const users = fakeUsers();
    users.loadMaxSessionByLookup = () => Promise.resolve(stored
      ? new TextEncoder().encode('{"cookies":[],"origins":[]}')
      : null);
    const clearSession = vi.fn(() => {
      stored = false;
    });
    users.clearMaxSessionByLookup = clearSession;
    const gateway = new BridgeRuntimeGateway({ worker, users });
    const userLookup = "u_AbCdEfGhIjKlMnOpQrStUv";
    await gateway.list(userLookup);

    await expect(gateway.logout(userLookup)).resolves.toBeUndefined();
    expect(clearSession).toHaveBeenCalledOnce();
    await expect(gateway.status(userLookup)).resolves.toEqual({
      state: "method_required"
    });
    expect(requests).toEqual([
      "session.open",
      "chats.list",
      "session.close",
      "session.close",
      "session.open",
      "login.status"
    ]);
  });

  it("does not retry a request after logout invalidates session recovery", async () => {
    const requests: unknown[] = [];
    let openAttempts = 0;
    let releaseRecovery!: () => void;
    let recoveryStarted!: () => void;
    const recoveryStartedPromise = new Promise<void>((resolve) => {
      recoveryStarted = resolve;
    });
    const recoveryRelease = new Promise<void>((resolve) => {
      releaseRecovery = resolve;
    });
    const users = fakeUsers();
    const worker = fakeWorker(async (request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        openAttempts += 1;
        if (openAttempts === 2) {
          recoveryStarted();
          await recoveryRelease;
        }
        return { opened: true };
      }
      if (request.operation === "login.phone") {
        throw new WorkerRequestError("session_not_found");
      }
      if (request.operation === "session.close") {
        return { closed: true };
      }
      throw new Error("unexpected");
    });
    const gateway = new BridgeRuntimeGateway({ worker, users });

    const login = gateway.submitPhone(
      "u_AbCdEfGhIjKlMnOpQrStUv",
      new TextEncoder().encode("+79991234567")
    );
    await recoveryStartedPromise;
    const logout = gateway.logout("u_AbCdEfGhIjKlMnOpQrStUv");
    releaseRecovery();

    await expect(logout).resolves.toBeUndefined();
    await expect(login).rejects.toThrow("Session lifecycle changed");
    expect(requests.filter((value) => (
      value as { operation: string }
    ).operation === "login.phone")).toHaveLength(1);
    expect(requests).toContainEqual(expect.objectContaining({
      operation: "session.close"
    }));
  });

  it("does not persist a recovered login response completed after logout", async () => {
    let codeAttempts = 0;
    let retryRequested!: () => void;
    let releaseRetry!: () => void;
    const retryRequestedPromise = new Promise<void>((resolve) => {
      retryRequested = resolve;
    });
    const retryRelease = new Promise<void>((resolve) => {
      releaseRetry = resolve;
    });
    const worker = fakeWorker(async (request) => {
      if (request.operation === "session.open") {
        return { opened: true };
      }
      if (request.operation === "login.code") {
        codeAttempts += 1;
        if (codeAttempts === 1) {
          throw new WorkerRequestError("session_not_found");
        }
        retryRequested();
        await retryRelease;
        return {
          result: { state: "authenticated" },
          storageStateBase64: Buffer.from(
            '{"cookies":[],"origins":[]}'
          ).toString("base64")
        };
      }
      if (request.operation === "session.close") {
        return { closed: true };
      }
      throw new Error("unexpected");
    });
    const users = fakeUsers();
    const gateway = new BridgeRuntimeGateway({ worker, users });
    const userLookup = "u_AbCdEfGhIjKlMnOpQrStUv";
    const login = gateway.submitCode(
      userLookup,
      new TextEncoder().encode("123456")
    );
    await retryRequestedPromise;

    await gateway.logout(userLookup);
    releaseRetry();

    await expect(login).rejects.toThrow("Session lifecycle changed");
    expect(users.saveMock).not.toHaveBeenCalled();
    expect(codeAttempts).toBe(2);
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

  it("routes each attachment through only its owner's opaque session", async () => {
    const requests: unknown[] = [];
    const worker = fakeWorker((request) => {
      requests.push(request);
      if (request.operation === "session.open") {
        return Promise.resolve({ opened: true });
      }
      return Promise.resolve({
        state: "confirmed",
        operationId: "attachment"
      });
    });
    const gateway = new BridgeRuntimeGateway({
      worker,
      users: fakeUsers()
    });

    await gateway.sendAttachment("u_AbCdEfGhIjKlMnOpQrStUv", {
      chatId: "chat-a",
      clientRequestId: "request-a",
      filePath: "/private/tmp/user-a/file-a.bin",
      kind: "file"
    });
    await gateway.sendAttachment("u_ZyXwVuTsRqPoNmLkJiHgFe", {
      chatId: "chat-b",
      clientRequestId: "request-b",
      filePath: "/private/tmp/user-b/file-b.jpg",
      kind: "media"
    });

    expect(requests.filter((value) => (
      value as { operation?: string }
    ).operation === "message.sendAttachment")).toEqual([
      {
        operation: "message.sendAttachment",
        sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv",
        payload: {
          chatId: "chat-a",
          clientRequestId: "request-a",
          filePath: "/private/tmp/user-a/file-a.bin",
          kind: "file"
        }
      },
      {
        operation: "message.sendAttachment",
        sessionHandle: "s_ZyXwVuTsRqPoNmLkJiHgFe",
        payload: {
          chatId: "chat-b",
          clientRequestId: "request-b",
          filePath: "/private/tmp/user-b/file-b.jpg",
          kind: "media"
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
            previewUrl: "https://i.oneme.ru/getSmile?smileId=abc"
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
      confirmedByUser: true,
      forEveryone: false
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
          confirmedByUser: true,
          forEveryone: false
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
  clearMock: ReturnType<typeof vi.fn>;
} {
  const saveMock = vi.fn(() => Promise.resolve());
  const clearMock = vi.fn();
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
    clearMock,
    loadMaxSessionByLookup: () => Promise.resolve(
      new TextEncoder().encode('{"cookies":[],"origins":[]}')
    ),
    saveMaxSessionByLookup: saveMock,
    clearMaxSessionByLookup: clearMock,
    findUserByLookup: () => ({
      lookupId: "u_AbCdEfGhIjKlMnOpQrStUv",
      state: "authenticating",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    } satisfies UserRecord),
    transitionByLookup: transitionMock
  };
}
