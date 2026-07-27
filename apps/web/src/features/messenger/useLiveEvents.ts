import { useEffect } from "react";

import {
  AuthenticatedSocket,
  type SocketFactory
} from "../../api/socket.js";
import { ApiError } from "../../api/client.js";
import type { AuthClient } from "../auth/AuthGate.js";
import type { TelegramWebApp } from "../auth/telegram.js";
import type { MessengerStore } from "./messenger-store.js";
import type { MessengerEvent } from "./types.js";

type LiveEventsOptions = Readonly<{
  store: MessengerStore;
  client: Pick<AuthClient, "authenticateTelegram">;
  telegram: TelegramWebApp | null;
  createSocket?: SocketFactory;
  onActivatedRefresh?(): void | Promise<void>;
}>;

export function useLiveEvents({
  store,
  client,
  telegram,
  createSocket,
  onActivatedRefresh
}: LiveEventsOptions): void {
  useEffect(() => {
    if (telegram === null || telegram.initData.length === 0) {
      return;
    }
    const socket = new AuthenticatedSocket({
      initData: () => telegram.initData,
      authenticate: async (initData) => {
        await client.authenticateTelegram(initData);
      },
      isAuthenticationRejected: (error) =>
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429,
      ...(createSocket === undefined ? {} : { createSocket }),
      onStatus: (status) => {
        store.applyEvent({
          type: "connection.state",
          sequence: 0,
          occurredAt: new Date().toISOString(),
          state: status
        });
      },
      onAuthenticationExpired: () => {
        store.applyEvent({
          type: "authentication.state",
          sequence: 0,
          occurredAt: new Date().toISOString(),
          state: "reauth_required"
        });
      },
      onMessage: (value) => {
        const event = extractEvent(value);
        if (event !== null) {
          store.applyEvent(event);
        }
      }
    });
    const activated = () => {
      void socket.resume()
        .then((resumed) => {
          if (!resumed) {
            return;
          }
          return onActivatedRefresh?.();
        })
        .catch(() => {
          // The next explicit activation can retry a transient refresh failure.
        });
    };
    const deactivated = () => {
      socket.pause();
    };
    const hasLifecycleEvents = telegram.onEvent !== undefined &&
      telegram.offEvent !== undefined;
    if (hasLifecycleEvents) {
      telegram.onEvent?.("activated", activated);
      telegram.onEvent?.("deactivated", deactivated);
    }
    if (telegram.isActive === false) {
      socket.pause();
    } else {
      socket.start();
    }
    return () => {
      if (hasLifecycleEvents) {
        telegram.offEvent?.("activated", activated);
        telegram.offEvent?.("deactivated", deactivated);
      }
      socket.stop();
    };
  }, [
    client,
    createSocket,
    onActivatedRefresh,
    store,
    telegram
  ]);
}

function extractEvent(value: unknown): MessengerEvent | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "event" ||
    !("event" in value) ||
    !isMessengerEvent(value.event)
  ) {
    return null;
  }
  return value.event;
}

function isMessengerEvent(value: unknown): value is MessengerEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["type"] !== "string" ||
    typeof record["sequence"] === "number" &&
    !Number.isSafeInteger(record["sequence"])
  ) {
    return false;
  }
  if (
    typeof record["sequence"] !== "number" ||
    !Number.isSafeInteger(record["sequence"]) ||
    typeof record["occurredAt"] !== "string"
  ) {
    return false;
  }
  switch (record["type"]) {
    case "chats.snapshot":
      return Array.isArray(record["chats"]);
    case "chat.upsert":
      return isRecordWithStringId(record["chat"]);
    case "message.upsert":
      return isRecordWithStringId(record["message"]);
    case "message.deleted":
      return typeof record["chatId"] === "string" &&
        typeof record["messageId"] === "string";
    case "connection.state":
      return record["state"] === "connected" ||
        record["state"] === "reconnecting" ||
        record["state"] === "disconnected";
    case "authentication.state":
      return record["state"] === "active" ||
        record["state"] === "reauth_required";
    default:
      return false;
  }
}

function isRecordWithStringId(value: unknown): boolean {
  return typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string";
}
