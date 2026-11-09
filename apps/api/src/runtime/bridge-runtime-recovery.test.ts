import { describe, expect, it, vi } from "vitest";

import type { UserRecord } from "@maxbridge/core";

import {
  BridgeRuntimeGateway,
  type RuntimeUsers,
  type RuntimeWorker
} from "./bridge-runtime-gateway.js";
import { WorkerRequestError } from "../worker/worker-client.js";

const USER = "u_AbCdEfGhIjKlMnOpQrStUv";
const OTHER_USER = "u_ZbCdEfGhIjKlMnOpQrStUv";
const HANDLE = `s_${USER.slice(2)}`;

describe("broken authenticated MAX session recovery", () => {
  it("restores the affected account from saved state and completes the original read", async () => {
    const { gateway, request, loads } = harness();

    await expect(gateway.list(USER)).resolves.toEqual([]);

    expect(request.mock.calls.map(([input]) => input.operation)).toEqual([
      "session.open", "chats.list", "session.close", "session.open", "chats.list"
    ]);
    const opens = request.mock.calls.filter(([input]) => input.operation === "session.open");
    expect(opens[1]?.[0].payload).toEqual(opens[0]?.[0].payload);
    expect(loads).toHaveBeenCalledTimes(2);
  });

  it("retries the read once and limits resets to once per minute even if MAX stays broken", async () => {
    const { gateway, request } = harness({ persistent: true });
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      await expect(gateway.list(USER)).rejects.toMatchObject({ code: "worker_failure" });
      expect(operationCount(request, "chats.list")).toBe(2);
      now.mockReturnValue(1_059_999);
      await expect(gateway.list(USER)).rejects.toMatchObject({ code: "worker_failure" });
      expect(operationCount(request, "session.close")).toBe(1);
      now.mockReturnValue(1_060_000);
      await expect(gateway.list(USER)).rejects.toMatchObject({ code: "worker_failure" });
      expect(operationCount(request, "session.close")).toBe(2);
    } finally {
      now.mockRestore();
    }
  });

  it("shares a reset between simultaneous failed chat-list requests", async () => {
    const { gateway, request } = harness();

    await expect(Promise.all([gateway.list(USER), gateway.list(USER)]))
      .resolves.toEqual([[], []]);

    expect(operationCount(request, "session.close")).toBe(1);
    expect(operationCount(request, "session.open")).toBe(2);
  });

  it("keeps another user's session open", async () => {
    const { gateway, request } = harness();

    await gateway.status(OTHER_USER);
    await expect(gateway.list(USER)).resolves.toEqual([]);
    await expect(gateway.status(OTHER_USER)).resolves.toEqual({ state: "authenticated" });

    const closes = request.mock.calls.filter(([input]) => input.operation === "session.close");
    expect(closes.map(([input]) => input.sessionHandle)).toEqual([HANDLE]);
    expect(request.mock.calls.filter(([input]) => (
      input.operation === "session.open" && input.sessionHandle !== HANDLE
    ))).toHaveLength(1);
  });

  it("does not replay a possibly completed message send after a worker failure", async () => {
    const { gateway, request } = harness();

    await expect(gateway.sendText(USER, {
      chatId: "chat-1", clientRequestId: "request-1", text: new TextEncoder().encode("Test")
    })).rejects.toMatchObject({ code: "worker_failure" });

    expect(operationCount(request, "message.send")).toBe(1);
    expect(operationCount(request, "session.close")).toBe(0);
  });

  it("does not reset an account still going through login", async () => {
    const { gateway, request } = harness({ state: "authenticating" });

    await expect(gateway.list(USER)).rejects.toMatchObject({ code: "worker_failure" });

    expect(operationCount(request, "session.close")).toBe(0);
    expect(operationCount(request, "chats.list")).toBe(1);
  });

  it("does not close the current session when no saved credentials are available", async () => {
    const { gateway, request } = harness({ noSavedState: true });

    await expect(gateway.list(USER)).rejects.toThrow();

    expect(operationCount(request, "session.close")).toBe(0);
    expect(operationCount(request, "session.open")).toBe(1);
  });

  it("does not reopen or retry when logout begins during recovery", async () => {
    const closing = deferred();
    const closeStarted = deferred();
    const { gateway, request, clearMock } = harness({
      beforeClose: async () => { closeStarted.resolve(); await closing.promise; }
    });
    const list = gateway.list(USER).catch((error: unknown) => error);
    await Promise.race([closeStarted.promise, list.then(() => undefined)]);
    expect(operationCount(request, "session.close")).toBe(1);
    const logout = gateway.logout(USER);
    closing.resolve();

    expect(await list).toMatchObject({ message: "Session lifecycle changed" });
    await logout;

    expect(operationCount(request, "session.open")).toBe(1);
    expect(operationCount(request, "chats.list")).toBe(1);
    expect(clearMock).toHaveBeenCalledWith(USER);
  });

  it("waits for a reset before running another operation on the same account", async () => {
    const closing = deferred();
    const closeStarted = deferred();
    const { gateway, request } = harness({
      beforeClose: async () => { closeStarted.resolve(); await closing.promise; }
    });
    const list = gateway.list(USER).catch((error: unknown) => error);
    await Promise.race([closeStarted.promise, list.then(() => undefined)]);
    expect(operationCount(request, "session.close")).toBe(1);
    const status = gateway.status(USER);
    await Promise.resolve();
    expect(operationCount(request, "login.status")).toBe(0);
    closing.resolve();

    await expect(list).resolves.toEqual([]);
    await expect(status).resolves.toEqual({ state: "authenticated" });
  });
});

function harness(options: Readonly<{
  persistent?: boolean;
  noSavedState?: boolean;
  state?: UserRecord["state"];
  beforeClose?: () => Promise<void>;
}> = {}) {
  const openCounts = new Map<string, number>();
  const request = vi.fn<RuntimeWorker["request"]>(async (input) => {
    switch (input.operation) {
      case "session.open":
        openCounts.set(input.sessionHandle, (openCounts.get(input.sessionHandle) ?? 0) + 1);
        return { opened: true };
      case "session.close":
        await options.beforeClose?.();
        return undefined;
      case "login.status":
        return { state: "authenticated" };
      case "chats.list":
        if (options.persistent || (openCounts.get(input.sessionHandle) ?? 0) < 2) {
          throw new WorkerRequestError("worker_failure");
        }
        return { chats: [] };
      default:
        throw new WorkerRequestError("worker_failure");
    }
  });
  const loads = vi.fn(() => Promise.resolve(options.noSavedState
    ? null
    : new TextEncoder().encode('{"cookies":[],"origins":[]}')));
  const clearMock = vi.fn();
  const users: RuntimeUsers = {
    loadMaxSessionByLookup: loads,
    saveMaxSessionByLookup: vi.fn(() => Promise.resolve()),
    clearMaxSessionByLookup: clearMock,
    findUserByLookup: (lookupId) => ({
      lookupId, state: options.state ?? "active",
      createdAt: "2026-11-09T00:00:00.000Z", updatedAt: "2026-11-09T00:00:00.000Z"
    }),
    transitionByLookup: (lookupId, state) => ({
      lookupId, state,
      createdAt: "2026-11-09T00:00:00.000Z", updatedAt: "2026-11-09T00:00:00.000Z"
    })
  };
  const gateway = new BridgeRuntimeGateway({
    worker: { request, subscribe: () => () => undefined }, users
  });
  return { gateway, request, loads, clearMock };
}

function operationCount(request: ReturnType<typeof vi.fn<RuntimeWorker["request"]>>, operation: string) {
  return request.mock.calls.filter(([input]) => input.operation === operation).length;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
