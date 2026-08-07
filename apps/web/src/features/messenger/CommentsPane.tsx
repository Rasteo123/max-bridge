import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { pushBackHandler } from "./back-navigation.js";
import { conversationRows } from "./day-dividers.js";
import type { MediaOpenInput } from "./MediaMessage.js";
import { MessageBubble } from "./MessageBubble.js";
import type {
  MessengerMessage,
  ReactionEmoji
} from "./types.js";

export type CommentsPaneProps = Readonly<{
  post: MessengerMessage;
  comments: readonly MessengerMessage[];
  loading: boolean;
  failed?: boolean;
  onClose(): void;
  onReact?(messageId: string, reaction: ReactionEmoji | null): void;
  onOpenSender?(message: MessengerMessage): void;
  onOpenMedia?(message: MessengerMessage, input: MediaOpenInput): void;
  onForward?(message: MessengerMessage): void;
}>;

/**
 * The comment thread under a channel post. MAX opens it as its own screen, so
 * it takes over the back gesture the same way the media viewer does.
 */
export function CommentsPane({
  post,
  comments,
  loading,
  failed = false,
  onClose,
  onReact,
  onOpenSender,
  onOpenMedia,
  onForward
}: CommentsPaneProps) {
  const closeRef = useRef<() => void>(onClose);
  closeRef.current = onClose;

  useEffect(() => pushBackHandler(() => {
    closeRef.current();
  }), []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return createPortal(
    <section
      className="comments-pane"
      data-no-swipe
      data-testid="comments-pane"
      aria-label="Комментарии"
    >
      <header className="comments-pane__header">
        <button
          className="icon-button"
          type="button"
          aria-label="Назад к каналу"
          onClick={onClose}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <h2>Комментарии</h2>
      </header>
      <p className="comments-pane__post">{postSummary(post)}</p>
      <div className="comments-pane__scroll">
        {loading && comments.length === 0 && (
          <p className="empty-state" role="status">Загружаем комментарии…</p>
        )}
        {!loading && failed && (
          <p className="empty-state">Не удалось загрузить комментарии</p>
        )}
        {!loading && !failed && comments.length === 0 && (
          <p className="empty-state">Комментариев пока нет</p>
        )}
        {conversationRows(comments).map((row) => row.kind === "divider" ? (
          <p className="day-divider" key={row.key}>{row.label}</p>
        ) : (
          <div className="comments-pane__row" key={row.key}>
            {onOpenSender === undefined || row.message.senderName === undefined
              ? undefined
              : (
                <button
                  className="comments-pane__sender"
                  type="button"
                  onClick={() => {
                    onOpenSender(row.message);
                  }}
                >
                  {row.message.senderName}
                </button>
              )}
            <MessageBubble
              message={row.message}
              showSender={false}
              {...(onReact === undefined ? {} : { onReact })}
              {...(onOpenMedia === undefined ? {} : { onOpenMedia })}
              {...(onForward === undefined ? {} : { onForward })}
            />
          </div>
        ))}
      </div>
    </section>,
    document.body
  );
}

function postSummary(post: MessengerMessage): string {
  const text = post.text.trim();
  if (text.length > 0) {
    return text.length > 160 ? `${text.slice(0, 159)}…` : text;
  }
  return post.kind === "video"
    ? "Видео"
    : post.kind === "image"
      ? "Изображение"
      : "Пост канала";
}
