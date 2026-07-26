import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore
} from "react";

import type { ApiClient } from "../../api/client.js";
import { currentTelegramWebApp } from "../auth/telegram.js";
import { MessengerShell } from "./MessengerShell.js";
import {
  MessengerStore
} from "./messenger-store.js";
import type {
  MessengerMedia,
  MessengerMessage
} from "./types.js";
import { useLiveEvents } from "./useLiveEvents.js";

type ConnectedMessengerProps = Readonly<{
  client: ApiClient;
}>;

export function ConnectedMessenger({
  client
}: ConnectedMessengerProps) {
  const store = useMemo(() => new MessengerStore(), []);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot
  );
  const telegram = useMemo(() => currentTelegramWebApp(), []);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  useLiveEvents({ store, client, telegram });

  useEffect(() => {
    const controller = new AbortController();
    void client.listChats()
      .then(async ({ chats }) => {
        if (isAborted(controller.signal)) {
          return;
        }
        store.replaceChats(chats);
        const first = chats[0];
        if (first !== undefined) {
          store.selectChat(first.id);
          const history = await client.getHistory(first.id);
          if (!isAborted(controller.signal)) {
            store.mergeHistory(history.messages.map(toMessengerMessage));
          }
        }
        if (!isAborted(controller.signal)) {
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!isAborted(controller.signal)) {
          setFailed(true);
          setLoaded(true);
        }
      });
    return () => {
      controller.abort();
    };
  }, [client, store]);

  async function selectChat(chatId: string) {
    store.selectChat(chatId);
    try {
      const history = await client.getHistory(chatId);
      store.mergeHistory(history.messages.map(toMessengerMessage));
    } catch {
      // The live connection can still recover the selected conversation.
    }
  }

  async function send(text: string) {
    const chatId = store.getSnapshot().selectedChatId;
    if (chatId === undefined) {
      return;
    }
    await client.sendText(chatId, text);
    const history = await client.getHistory(chatId);
    store.mergeHistory(history.messages.map(toMessengerMessage));
  }

  async function sendAttachment(file: File, kind: "media" | "file") {
    const chatId = store.getSnapshot().selectedChatId;
    if (chatId === undefined) {
      return;
    }
    await client.sendAttachment(chatId, file, kind);
    const history = await client.getHistory(chatId);
    store.mergeHistory(history.messages.map(toMessengerMessage));
  }

  if (!loaded) {
    return (
      <main className="centered-page" aria-busy="true">
        <p className="loading-label">Загружаем чаты из MAX…</p>
      </main>
    );
  }
  if (failed) {
    return (
      <main className="centered-page">
        <section className="auth-card">
          <h1>MAX временно недоступен</h1>
          <p className="muted">Закройте Mini App и повторите попытку.</p>
        </section>
      </main>
    );
  }
  return (
    <>
      {snapshot.connection !== "connected" && (
        <div className="connection-banner" role="status">
          {snapshot.connection === "reconnecting"
            ? "Восстанавливаем соединение…"
            : "Нет соединения с MAX"}
        </div>
      )}
      <MessengerShell
        chats={snapshot.chats}
        messages={snapshot.messages}
        {...(snapshot.selectedChatId === undefined
          ? {}
          : { initialChatId: snapshot.selectedChatId })}
        initialPane="list"
        onSelectChat={(chatId) => {
          void selectChat(chatId);
        }}
        onSend={(text) => {
          void send(text);
        }}
        onAttach={(file, kind) => {
          void sendAttachment(file, kind);
        }}
      />
    </>
  );
}

function toMessengerMessage(value: unknown): MessengerMessage {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Invalid message");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record["id"] !== "string" ||
    typeof record["direction"] !== "string" ||
    (record["direction"] !== "incoming" && record["direction"] !== "outgoing") ||
    typeof record["sentAt"] !== "string"
  ) {
    throw new TypeError("Invalid message");
  }
  const kind = messageKind(record["kind"]);
  return {
    id: record["id"],
    ...(typeof record["chatId"] === "string"
      ? { chatId: record["chatId"] }
      : {}),
    kind,
    text: typeof record["text"] === "string" ? record["text"] : "",
    direction: record["direction"],
    sentAt: record["sentAt"],
    ...(typeof record["senderName"] === "string"
      ? { senderName: record["senderName"] }
      : {}),
    ...(isMediaKind(kind) && isMedia(record["media"])
      ? { media: record["media"] }
      : {})
  };
}

function messageKind(value: unknown): NonNullable<MessengerMessage["kind"]> {
  return value === "system" || value === "image" || value === "video" ||
    value === "voice" || value === "file" ? value : "text";
}

function isMediaKind(
  kind: NonNullable<MessengerMessage["kind"]>
): kind is "image" | "video" | "voice" | "file" {
  return kind === "image" || kind === "video" ||
    kind === "voice" || kind === "file";
}

function isMedia(value: unknown): value is MessengerMedia {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record["handle"] === "string" &&
    typeof record["mimeType"] === "string" &&
    typeof record["size"] === "number";
}

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted;
}
