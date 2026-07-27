import { useEffect, useMemo, useState } from "react";

import { Composer } from "./Composer.js";
import { MessageBubble } from "./MessageBubble.js";
import type {
  MessengerChat,
  MessengerMessage,
  MessengerSticker,
  ReactionKey
} from "./types.js";

type ConversationProps = Readonly<{
  chat?: MessengerChat;
  messages: readonly MessengerMessage[];
  wide: boolean;
  active?: boolean;
  onOpenChats(): void;
  onSend(text: string, replyToId?: string): void;
  onAttach?(file: File, kind: "media" | "file"): void;
  historyLoading?: boolean;
  onEditMessage?(messageId: string, text: string): void;
  onDeleteMessage?(messageId: string): void;
  onReactMessage?(messageId: string, reaction: ReactionKey | null): void;
  onLoadStickers?(): Promise<readonly MessengerSticker[]>;
  onSendSticker?(stickerId: string): Promise<void> | void;
}>;

type ComposerContext = Readonly<{
  kind: "reply" | "edit";
  message: MessengerMessage;
}>;

export function Conversation({
  chat,
  messages,
  active = true,
  onSend,
  onAttach,
  historyLoading = false,
  onEditMessage,
  onDeleteMessage,
  onReactMessage,
  onLoadStickers,
  onSendSticker
}: ConversationProps) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [composerContext, setComposerContext] =
    useState<ComposerContext | null>(null);
  const now = useMinuteAlignedNow(
    active && chat?.kind === "direct" &&
      chat.presence === "offline" &&
      validLastSeenAt(chat.lastSeenAt, Date.now())
      ? chat.lastSeenAt
      : undefined
  );
  const subtitle = conversationSubtitle(chat, now);

  useEffect(() => {
    setComposerContext(null);
  }, [chat?.id]);

  const visibleMessages = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("ru-RU");
    if (query.length === 0) {
      return messages;
    }
    return messages.filter((message) =>
      `${message.senderName ?? ""}\n${message.text}`
        .toLocaleLowerCase("ru-RU")
        .includes(query)
    );
  }, [messages, searchQuery]);

  return (
    <section
      className="conversation"
      data-testid="conversation"
      aria-label={chat === undefined ? "Переписка" : `Переписка с ${chat.title}`}
    >
      <header className="conversation__header">
        <div className="conversation__contact">
          {chat !== undefined && (
            <span className="conversation__avatar">
              {chat.avatarUrl === undefined ? (
                <span aria-hidden="true">{initialsFor(chat.title)}</span>
              ) : (
                <img src={chat.avatarUrl} alt={chat.title} />
              )}
              {chat.kind === "direct" && chat.presence === "online" && (
                <span className="presence-dot" aria-label="В сети" />
              )}
            </span>
          )}
          <div className="conversation__identity">
            <strong>{chat?.title ?? "Выберите чат"}</strong>
            {chat !== undefined && <span>{subtitle}</span>}
          </div>
        </div>
        <div className="conversation__actions">
          <button
            className="icon-button"
            type="button"
            aria-label="Поиск сообщений"
            data-no-swipe
            aria-pressed={searchOpen}
            onClick={() => {
              setSearchOpen((value) => !value);
              if (searchOpen) {
                setSearchQuery("");
              }
            }}
          >
            <span aria-hidden="true">⌕</span>
          </button>
          <button
            className="icon-button"
            type="button"
            aria-label="Действия чата"
            data-no-swipe
          >
            <span aria-hidden="true">•••</span>
          </button>
        </div>
      </header>
      <div className="conversation__messages">
        {searchOpen && chat !== undefined && (
          <label className="message-search">
            <span className="sr-only">Поиск сообщений</span>
            <input
              type="search"
              value={searchQuery}
              placeholder="Поиск в переписке"
              autoFocus
              data-no-swipe
              onChange={(event) => {
                setSearchQuery(event.currentTarget.value);
              }}
            />
            {searchQuery.trim().length > 0 && (
              <span>
                {visibleMessages.length === 0
                  ? "Нет совпадений"
                  : `Найдено: ${String(visibleMessages.length)}`}
              </span>
            )}
          </label>
        )}
        {chat === undefined ? (
          <div className="conversation__placeholder">
            <div aria-hidden="true">💬</div>
            <p>Выберите чат, чтобы открыть переписку</p>
          </div>
        ) : historyLoading && messages.length === 0 ? (
          <div className="conversation__placeholder" role="status">
            <div className="history-spinner" aria-hidden="true" />
            <p>Загружаем сообщения…</p>
          </div>
        ) : (
          <>
            <div className="day-divider"><span>Сегодня</span></div>
            {visibleMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                showSender={
                  chat.kind !== "direct" &&
                  message.direction === "incoming"
                }
                onReply={(selectedMessage) => {
                  setComposerContext({
                    kind: "reply",
                    message: selectedMessage
                  });
                }}
                {...(onEditMessage === undefined ? {} : {
                  onEdit: (messageId: string) => {
                    const selectedMessage = messages.find(
                      (item) => item.id === messageId
                    );
                    if (selectedMessage !== undefined) {
                      setComposerContext({
                        kind: "edit",
                        message: selectedMessage
                      });
                    }
                  }
                })}
                {...(onDeleteMessage === undefined
                  ? {}
                  : { onDelete: onDeleteMessage })}
                {...(onReactMessage === undefined
                  ? {}
                  : { onReact: onReactMessage })}
              />
            ))}
          </>
        )}
      </div>
      <Composer
        disabled={chat === undefined}
        onSend={onSend}
        {...(onAttach === undefined ? {} : { onAttach })}
        {...(
          composerContext?.kind === "reply"
            ? { replyingTo: composerContext.message }
            : {}
        )}
        {...(
          composerContext?.kind === "edit"
            ? { editing: composerContext.message }
            : {}
        )}
        {...(onEditMessage === undefined ? {} : { onEdit: onEditMessage })}
        {...(onLoadStickers === undefined ? {} : { onLoadStickers })}
        {...(onSendSticker === undefined ? {} : { onSendSticker })}
        onCancelContext={() => {
          setComposerContext(null);
        }}
      />
    </section>
  );
}

function useMinuteAlignedNow(lastSeenAt: number | undefined): number {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (lastSeenAt === undefined) {
      return;
    }
    let timer: number | undefined;
    const schedule = () => {
      const remainder = Date.now() % 60_000;
      const delay = remainder === 0 ? 60_000 : 60_000 - remainder;
      timer = window.setTimeout(() => {
        setTick((value) => value + 1);
        schedule();
      }, delay);
    };
    schedule();
    return () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [lastSeenAt]);

  return Date.now();
}

function conversationSubtitle(
  chat: MessengerChat | undefined,
  now: number
): string {
  if (chat === undefined || chat.kind !== "direct") {
    return "MAX";
  }
  if (chat.presence === "online") {
    return "В сети";
  }
  if (chat.presence === "recently") {
    return "Был(-а) недавно";
  }
  if (chat.presence === "long_ago") {
    return "Был(-а) давно";
  }
  if (
    chat.presence !== "offline" ||
    !validLastSeenAt(chat.lastSeenAt, now)
  ) {
    return "MAX";
  }
  return formatLastSeen(chat.lastSeenAt, now);
}

function formatLastSeen(lastSeenAt: number, now: number): string {
  const age = Math.max(0, now - lastSeenAt);
  if (age < 60_000) {
    return "Только что";
  }
  if (age < 60 * 60_000) {
    return `${String(Math.floor(age / 60_000))} мин назад`;
  }
  if (age < 24 * 60 * 60_000) {
    return `${String(Math.floor(age / (60 * 60_000)))} ч назад`;
  }
  const seen = new Date(lastSeenAt);
  if (localDayNumber(new Date(now)) - localDayNumber(seen) === 1) {
    return `Вчера, ${formatTime(seen)}`;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: seen.getFullYear() === new Date(now).getFullYear()
      ? undefined
      : "numeric"
  }).format(seen);
}

function validLastSeenAt(
  value: number | undefined,
  now: number
): value is number {
  return value !== undefined &&
    Number.isSafeInteger(value) &&
    value >= 946_684_800_000 &&
    value <= 4_102_444_800_000 &&
    value <= now + 5 * 60_000;
}

function localDayNumber(value: Date): number {
  return Math.floor(Date.UTC(
    value.getFullYear(),
    value.getMonth(),
    value.getDate()
  ) / (24 * 60 * 60_000));
}

function formatTime(value: Date): string {
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function initialsFor(title: string): string {
  return title
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("");
}
