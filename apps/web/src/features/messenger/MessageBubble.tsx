import { useState } from "react";

import { DeleteMessageDialog } from "./DeleteMessageDialog.js";
import { DeliveryIndicator } from "./DeliveryIndicator.js";
import {
  MediaMessage,
  type MediaOpenInput
} from "./MediaMessage.js";
import {
  PressContextMenu,
  type ContextMenuAction,
  type ContextMenuPoint,
  type ContextMenuReaction,
  useLongPressContextMenu
} from "./PressContextMenu.js";
import { MAX_REACTIONS, quickReactions } from "./reactions.js";
import { RichMessageText } from "./RichMessageText.js";
import type {
  MessengerForwardedSource,
  MessengerMessage,
  ReactionEmoji
} from "./types.js";
import { useSwipeToReply } from "./useSwipeToReply.js";

type MessageBubbleProps = Readonly<{
  message: MessengerMessage;
  showSender?: boolean;
  onReply?(message: MessengerMessage): void;
  onEdit?(messageId: string, text: string): void;
  onDelete?(messageId: string, forEveryone: boolean): void;
  canDeleteForEveryone?: boolean;
  onForward?(message: MessengerMessage): void;
  onReact?(messageId: string, reaction: ReactionEmoji | null): void;
  onOpenForwardedSource?(source: MessengerForwardedSource): void;
  onOpenMedia?(message: MessengerMessage, input: MediaOpenInput): void;
  onOpenComments?(message: MessengerMessage): void;
}>;


export function MessageBubble({
  message,
  showSender = false,
  onReply,
  onEdit,
  onDelete,
  canDeleteForEveryone = false,
  onForward,
  onReact,
  onOpenForwardedSource,
  onOpenMedia,
  onOpenComments
}: MessageBubbleProps) {
  const [menuPoint, setMenuPoint] = useState<ContextMenuPoint | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const replySwipe = useSwipeToReply({
    disabled: onReply === undefined,
    onReply: () => {
      onReply?.(message);
    },
    onArmed: triggerReplyHaptic
  });
  const press = useLongPressContextMenu({
    onOpen: (point) => {
      replySwipe.cancel();
      setMenuPoint(point);
    }
  });
  const kind = message.kind ?? "text";
  const forwardedSource = message.forwardedSource;
  const isMedia = kind === "image" || kind === "video" ||
    kind === "voice" || kind === "file";
  const canEdit = (
    message.direction === "outgoing" &&
    kind === "text" &&
    message.text.trim().length > 0 &&
    onEdit !== undefined
  );
  const reactions = message.reactions ?? [];
  const mine = reactions
    .filter((item) => item.selectedByMe)
    .map((item) => item.emoji);
  const toMenuReaction = (emoji: ReactionEmoji): ContextMenuReaction => {
    const selected = mine.includes(emoji);
    return {
      emoji,
      label: selected ? `Убрать реакцию ${emoji}` : `Реакция ${emoji}`,
      selected,
      onSelect: () => {
        onReact?.(message.id, selected ? null : emoji);
      }
    };
  };
  const menuReactions: readonly ContextMenuReaction[] = onReact === undefined
    ? []
    : quickReactions(mine).map(toMenuReaction);
  const allMenuReactions: readonly ContextMenuReaction[] = onReact === undefined
    ? []
    : MAX_REACTIONS.map(toMenuReaction);
  const actions: readonly ContextMenuAction[] = [
    ...(onReply === undefined ? [] : [{
      id: "reply",
      label: "Ответить",
      icon: "↩",
      onSelect: () => {
        onReply(message);
      }
    }]),
    ...(message.text.length === 0 ? [] : [{
      id: "copy",
      label: "Копировать текст",
      icon: "▣",
      onSelect: () => {
        void copyText(message.text);
      }
    }]),
    ...(canEdit ? [{
      id: "edit",
      label: "Редактировать",
      icon: "✎",
      onSelect: () => {
        onEdit(message.id, message.text);
      }
    }] : []),
    ...(onForward === undefined || kind === "system" ? [] : [{
      id: "forward",
      label: "Переслать",
      icon: "↗",
      onSelect: () => {
        onForward(message);
      }
    }]),
    ...(onDelete === undefined ? [] : [{
      id: "delete",
      label: "Удалить",
      icon: "⌫",
      danger: true,
      onSelect: () => {
        setConfirmingDelete(true);
      }
    }])
  ];

  return (
    <>
      <article
        className={`message message--${message.direction}`}
        data-message-id={message.id}
        tabIndex={-1}
        data-reply-dragging={replySwipe.dragging ? "true" : "false"}
        data-reply-armed={replySwipe.armed ? "true" : "false"}
        style={replySwipe.style}
        onContextMenu={press.onContextMenu}
        onPointerDown={(event) => {
          press.onPointerDown(event);
          replySwipe.handlers.onPointerDown?.(event);
        }}
        onPointerMove={(event) => {
          press.onPointerMove(event);
          replySwipe.handlers.onPointerMove?.(event);
        }}
        onPointerUp={(event) => {
          press.onPointerUp(event);
          replySwipe.handlers.onPointerUp?.(event);
        }}
        onPointerCancel={(event) => {
          press.onPointerCancel(event);
          replySwipe.handlers.onPointerCancel?.(event);
        }}
        onPointerLeave={replySwipe.handlers.onPointerLeave}
        onLostPointerCapture={replySwipe.handlers.onLostPointerCapture}
        onClickCapture={press.onClickCapture}
        onDragStart={press.onDragStart}
      >
        <span className="message__reply-swipe-icon" aria-hidden="true">↩</span>
        {showSender && message.senderName !== undefined && (
          <strong>{message.senderName}</strong>
        )}
        {message.replyPreview !== undefined && (
          <div className="message__reply-preview">
            {message.replyPreview.senderName !== undefined && (
              <strong>{message.replyPreview.senderName}</strong>
            )}
            <span>{message.replyPreview.text || "Сообщение"}</span>
          </div>
        )}
        {(forwardedSource !== undefined ||
          message.forwardedFrom !== undefined) && (
          <div className="message__forwarded">
            <span>Переслано:</span>
            {forwardedSource !== undefined &&
            onOpenForwardedSource !== undefined ? (
              <button
                className="message__forwarded-source"
                type="button"
                data-no-swipe
                onClick={() => {
                  onOpenForwardedSource(forwardedSource);
                }}
              >
                {forwardedSource.title}
              </button>
            ) : (
              <strong>
                {forwardedSource?.title ?? message.forwardedFrom}
              </strong>
            )}
          </div>
        )}
        {isMedia && message.media !== undefined && (
          <div data-no-swipe>
            <MediaMessage
              kind={kind}
              media={message.media}
              {...(
                (kind === "image" || kind === "video") &&
                onOpenMedia !== undefined
                  ? {
                    onOpen: (input: MediaOpenInput) => {
                      onOpenMedia(message, input);
                    }
                  }
                  : {}
              )}
            />
          </div>
        )}
        {message.text.length > 0 && (
          <p>
            <RichMessageText
              text={message.text}
              {...(message.textLinks === undefined
                ? {}
                : { links: message.textLinks })}
            />
          </p>
        )}
        <div className="message__meta">
          {message.edited === true && <span>изменено</span>}
          {message.views !== undefined && (
            <span
              className="message__views"
              aria-label={`Просмотров: ${String(message.views)}`}
            >
              <span aria-hidden="true">👁</span>
              {formatViews(message.views)}
            </span>
          )}
          <time dateTime={message.sentAt}>
            {message.formattedTime ?? formatMessageTime(message.sentAt)}
          </time>
          {message.direction === "outgoing" && message.status !== undefined && (
            <DeliveryIndicator status={message.status} />
          )}
        </div>
        {reactions.length > 0 && (
          <div className="message__reactions" aria-label="Реакции на сообщение">
            {reactions
              .filter((reaction) => reaction.count > 0)
              .map((reaction) => {
                const label = `${reaction.emoji} ${String(reaction.count)}`;
                return onReact === undefined ? (
                  <span
                    key={reaction.emoji}
                    className={
                      reaction.selectedByMe
                        ? "message__reaction message__reaction--selected"
                        : "message__reaction"
                    }
                    aria-label={label}
                  >
                    <span aria-hidden="true">{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                  </span>
                ) : (
                  <button
                    key={reaction.emoji}
                    className={
                      reaction.selectedByMe
                        ? "message__reaction message__reaction--selected"
                        : "message__reaction"
                    }
                    type="button"
                    data-no-swipe
                    aria-label={label}
                    aria-pressed={reaction.selectedByMe}
                    onClick={() => {
                      onReact(
                        message.id,
                        reaction.selectedByMe ? null : reaction.emoji
                      );
                    }}
                  >
                    <span aria-hidden="true">{reaction.emoji}</span>
                    <span>{reaction.count}</span>
                  </button>
                );
              })}
          </div>
        )}
        {message.commentCount !== undefined && onOpenComments !== undefined && (
          <button
            className="message__comments"
            type="button"
            data-no-swipe
            onClick={() => {
              onOpenComments(message);
            }}
          >
            <span aria-hidden="true">💬</span>
            <span>{commentsLabel(message.commentCount)}</span>
            <span className="message__comments-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        )}
      </article>
      {menuPoint !== null && (
        <PressContextMenu
          point={menuPoint}
          ariaLabel="Действия с сообщением"
          reactions={menuReactions}
          allReactions={allMenuReactions}
          actions={actions}
          onClose={() => {
            setMenuPoint(null);
          }}
        />
      )}
      {confirmingDelete && onDelete !== undefined && (
        <DeleteMessageDialog
          canDeleteForEveryone={
            canDeleteForEveryone && message.direction === "outgoing"
          }
          onCancel={() => {
            setConfirmingDelete(false);
          }}
          onConfirm={(forEveryone) => {
            setConfirmingDelete(false);
            onDelete(message.id, forEveryone);
          }}
        />
      )}
    </>
  );
}

/** MAX abbreviates large view counts: 5,3К rather than 5312. */
function formatViews(views: number): string {
  if (views < 1_000) {
    return String(views);
  }
  if (views < 1_000_000) {
    return `${(views / 1_000).toFixed(views < 10_000 ? 1 : 0)
      .replace(".", ",")}К`;
  }
  return `${(views / 1_000_000).toFixed(1).replace(".", ",")}М`;
}

function commentsLabel(count: number): string {
  if (count === 0) {
    return "Комментировать";
  }
  const tens = count % 100;
  const ones = count % 10;
  const word = tens >= 11 && tens <= 14
    ? "комментариев"
    : ones === 1
      ? "комментарий"
      : ones >= 2 && ones <= 4
        ? "комментария"
        : "комментариев";
  return `${String(count)} ${word}`;
}

async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}

function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function triggerReplyHaptic(): void {
  const webApp = window.Telegram?.WebApp;
  const feedback = webApp?.HapticFeedback;
  if (feedback?.impactOccurred === undefined) {
    return;
  }
  if (
    webApp?.isVersionAtLeast !== undefined &&
    !webApp.isVersionAtLeast("6.1")
  ) {
    return;
  }
  try {
    feedback.impactOccurred("light");
  } catch {
    // Telegram capabilities can disappear while the host is being closed.
  }
}
