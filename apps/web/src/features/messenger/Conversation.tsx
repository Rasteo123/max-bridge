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
  wide,
  onOpenChats,
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
        {!wide && (
          <button
            className="conversation__back"
            type="button"
            onClick={onOpenChats}
            aria-label="Открыть список чатов"
          >
            <span aria-hidden="true">‹</span>
            <span>Чаты</span>
          </button>
        )}
        <div className="conversation__identity">
          <strong>{chat?.title ?? "Выберите чат"}</strong>
          {chat !== undefined && <span>MAX</span>}
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
