import {
  useEffect,
  useMemo,
  useRef,
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
  MessengerChatAction,
  MessengerMedia,
  MessengerMessage,
  MessengerReaction,
  MessengerTheme,
  ReactionKey
} from "./types.js";
import { useLiveEvents } from "./useLiveEvents.js";

type ConnectedMessengerProps = Readonly<{
  client: ApiClient;
  theme: MessengerTheme;
  onThemeChange(theme: MessengerTheme): void;
  onLoggedOut(): void;
}>;

export function ConnectedMessenger({
  client,
  theme,
  onThemeChange,
  onLoggedOut
}: ConnectedMessengerProps) {
  const store = useMemo(() => new MessengerStore(), []);
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot
  );
  const telegram = useMemo(() => currentTelegramWebApp(), []);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const historyCache = useRef(new Map<string, readonly MessengerMessage[]>());
  const historyRequest = useRef(0);
  useLiveEvents({ store, client, telegram });

  useEffect(() => {
    const controller = new AbortController();
    void client.listChats()
      .then(({ chats }) => {
        if (isAborted(controller.signal)) {
          return;
        }
        store.replaceChats(chats);
        const first = chats[0];
        if (first === undefined) {
          setLoaded(true);
          return;
        }

        const requestId = ++historyRequest.current;
        store.selectChat(first.id);
        setHistoryLoading(true);
        setLoaded(true);
        return client.getHistory(first.id)
          .then((history) => {
            const messages = toMessengerMessages(history.messages);
            historyCache.current.set(first.id, messages);
            if (
              !isAborted(controller.signal)
              && requestId === historyRequest.current
              && store.getSnapshot().selectedChatId === first.id
            ) {
              store.mergeHistory(messages);
            }
          })
          .catch(() => {
            // A single history timeout must not hide the available chat list.
          })
          .finally(() => {
            if (
              !isAborted(controller.signal)
              && requestId === historyRequest.current
            ) {
              setHistoryLoading(false);
            }
          });
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
    const requestId = ++historyRequest.current;
    store.selectChat(chatId);
    const cached = historyCache.current.get(chatId);
    if (cached !== undefined) {
      store.mergeHistory(cached);
    }
    setHistoryLoading(cached === undefined);
    try {
      const history = await client.getHistory(chatId);
      const messages = toMessengerMessages(history.messages);
      historyCache.current.set(chatId, messages);
      if (
        requestId === historyRequest.current &&
        store.getSnapshot().selectedChatId === chatId
      ) {
        store.mergeHistory(messages);
      }
    } catch {
      // The live connection can still recover the selected conversation.
    } finally {
      if (requestId === historyRequest.current) {
        setHistoryLoading(false);
      }
    }
  }

  async function send(text: string, replyToId?: string) {
    const chatId = store.getSnapshot().selectedChatId;
    if (chatId === undefined) {
      return;
    }
    await client.sendText(chatId, text, replyToId);
    await refreshHistory(chatId);
  }

  async function sendAttachment(file: File, kind: "media" | "file") {
    const chatId = store.getSnapshot().selectedChatId;
    if (chatId === undefined) {
      return;
    }
    await client.sendAttachment(chatId, file, kind);
    await refreshHistory(chatId);
  }

  async function editMessage(messageId: string, text: string) {
    const chatId = store.getSnapshot().selectedChatId;
    if (chatId === undefined) {
      return;
    }
    await client.editMessage(chatId, messageId, text);
    await refreshHistory(chatId);
  }

  async function deleteMessage(messageId: string) {
    const chatId = store.getSnapshot().selectedChatId;
    if (chatId === undefined) {
      return;
    }
    await client.deleteMessage(chatId, messageId);
    store.applyEvent({
      type: "message.deleted",
      sequence: 0,
      occurredAt: new Date().toISOString(),
      chatId,
      messageId
    });
    await refreshHistory(chatId, true);
  }

  async function reactMessage(
    messageId: string,
    reaction: ReactionKey | null
  ) {
    const chatId = store.getSnapshot().selectedChatId;
    if (chatId === undefined) {
      return;
    }
    await client.setReaction(chatId, messageId, reaction);
    await refreshHistory(chatId);
  }

  async function applyChatAction(
    chatId: string,
    action: MessengerChatAction
  ) {
    await client.chatAction(chatId, action);
    const { chats } = await client.listChats();
    store.replaceChats(chats);

    if (action === "clear" && store.getSnapshot().selectedChatId === chatId) {
      await refreshHistory(chatId, true);
      return;
    }
    if (action !== "delete") {
      return;
    }
    historyCache.current.delete(chatId);
    if (store.getSnapshot().selectedChatId !== chatId) {
      return;
    }
    const next = chats[0];
    if (next === undefined) {
      store.clearSelection();
      return;
    }
    await selectChat(next.id);
  }

  async function loadStickers() {
    const chatId = store.getSnapshot().selectedChatId;
    if (chatId === undefined) {
      return [];
    }
    return (await client.listStickers(chatId)).stickers;
  }

  async function sendSticker(stickerId: string) {
    const chatId = store.getSnapshot().selectedChatId;
    if (chatId === undefined) {
      return;
    }
    await client.sendSticker(chatId, stickerId);
    await refreshHistory(chatId);
  }

  async function refreshHistory(chatId: string, replace = false) {
    const history = await client.getHistory(chatId);
    const messages = toMessengerMessages(history.messages);
    historyCache.current.set(chatId, messages);
    if (store.getSnapshot().selectedChatId !== chatId) {
      return;
    }
    if (replace) {
      store.replaceCurrentMessages(messages);
    } else {
      store.mergeHistory(messages);
    }
  }

  async function runAction(action: () => Promise<void>) {
    setActionError(undefined);
    try {
      await action();
    } catch {
      setActionError(
        "MAX не подтвердил действие. Повторите попытку."
      );
    }
  }

  async function logout() {
    if (!window.confirm("Выйти из аккаунта MAX на этом устройстве?")) {
      return;
    }
    await client.logoutMax();
    historyCache.current.clear();
    onLoggedOut();
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
          {snapshot.authentication === "reauth_required"
            ? "Сессия Telegram устарела. Закройте и снова откройте Mini App."
            : snapshot.connection === "reconnecting"
            ? "Восстанавливаем соединение…"
            : "Нет соединения с MAX"}
        </div>
      )}
      {actionError !== undefined && (
        <button
          className="connection-banner action-error"
          type="button"
          role="alert"
          onClick={() => {
            setActionError(undefined);
          }}
        >
          {actionError}
        </button>
      )}
      <MessengerShell
        chats={snapshot.chats}
        messages={snapshot.messages}
        {...(snapshot.selectedChatId === undefined
          ? {}
          : { initialChatId: snapshot.selectedChatId })}
        initialPane="list"
        historyLoading={historyLoading}
        theme={theme}
        onThemeChange={onThemeChange}
        onLogout={() => {
          void logout();
        }}
        onSelectChat={(chatId) => {
          void selectChat(chatId);
        }}
        onSend={(text, replyToId) => {
          void runAction(() => send(text, replyToId));
        }}
        onAttach={(file, kind) => {
          void runAction(() => sendAttachment(file, kind));
        }}
        onEditMessage={(messageId, text) => {
          void runAction(() => editMessage(messageId, text));
        }}
        onDeleteMessage={(messageId) => {
          void runAction(() => deleteMessage(messageId));
        }}
        onReactMessage={(messageId, reaction) => {
          void runAction(() => reactMessage(messageId, reaction));
        }}
        onChatAction={(chatId, action) => {
          void runAction(() => applyChatAction(chatId, action));
        }}
        onLoadStickers={loadStickers}
        onSendSticker={(stickerId) => {
          return runAction(() => sendSticker(stickerId));
        }}
      />
    </>
  );
}

function toMessengerMessages(
  values: readonly unknown[]
): readonly MessengerMessage[] {
  const messages = values
    .filter((value) => !isDeletedMessage(value))
    .map(toMessengerMessage);
  const byId = new Map(messages.map((message) => [message.id, message]));
  return messages.map((message) => {
    if (message.replyToId === undefined) {
      return message;
    }
    const replied = byId.get(message.replyToId);
    return {
      ...message,
      replyPreview: {
        messageId: message.replyToId,
        ...(replied?.senderName === undefined
          ? {}
          : { senderName: replied.senderName }),
        text: replied?.text || "Вложение"
      }
    };
  });
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
  const reactions = readReactions(record["reactions"]);
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
    ...(isDeliveryStatus(record["status"])
      ? { status: record["status"] }
      : {}),
    ...(record["edited"] === true ? { edited: true } : {}),
    ...(typeof record["replyToId"] === "string"
      ? { replyToId: record["replyToId"] }
      : {}),
    ...(typeof record["forwardedFrom"] === "string"
      ? { forwardedFrom: record["forwardedFrom"] }
      : {}),
    ...(reactions.length === 0
      ? {}
      : { reactions }),
    ...(isMediaKind(kind) && isMedia(record["media"])
      ? { media: record["media"] }
      : {})
  };
}

function isDeletedMessage(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    (value as Record<string, unknown>)["deleted"] === true;
}

function isDeliveryStatus(
  value: unknown
): value is NonNullable<MessengerMessage["status"]> {
  return value === "pending" || value === "sent" ||
    value === "delivered" || value === "read" || value === "failed";
}

function readReactions(value: unknown): readonly MessengerReaction[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((item): MessengerReaction[] => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    const record = item as Record<string, unknown>;
    if (
      !isReactionKey(record["key"]) ||
      typeof record["emoji"] !== "string" ||
      typeof record["count"] !== "number" ||
      !Number.isInteger(record["count"]) ||
      record["count"] < 1 ||
      typeof record["selectedByMe"] !== "boolean"
    ) {
      return [];
    }
    return [{
      key: record["key"],
      emoji: record["emoji"],
      count: record["count"],
      selectedByMe: record["selectedByMe"]
    }];
  });
}

function isReactionKey(value: unknown): value is ReactionKey {
  return value === "like" || value === "heart" ||
    value === "laugh" || value === "fire" ||
    value === "cry" || value === "celebrate";
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
