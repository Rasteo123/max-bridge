import { useState } from "react";

import { MediaMessage } from "./MediaMessage.js";
import {
  PressContextMenu,
  type ContextMenuAction,
  type ContextMenuPoint,
  type ContextMenuReaction,
  useLongPressContextMenu
} from "./PressContextMenu.js";
import type {
  MessengerMessage,
  ReactionKey
} from "./types.js";

type MessageBubbleProps = Readonly<{
  message: MessengerMessage;
  showSender?: boolean;
  onReply?(message: MessengerMessage): void;
  onEdit?(messageId: string, text: string): void;
  onDelete?(messageId: string): void;
  onReact?(messageId: string, reaction: ReactionKey | null): void;
}>;

const REACTIONS: readonly Readonly<{
  key: ReactionKey;
  emoji: string;
  label: string;
}>[] = [
  { key: "like", emoji: "👍", label: "Нравится" },
  { key: "heart", emoji: "❤️", label: "Сердце" },
  { key: "laugh", emoji: "😂", label: "Смешно" },
  { key: "fire", emoji: "🔥", label: "Огонь" },
  { key: "cry", emoji: "😭", label: "Грусть" },
  { key: "celebrate", emoji: "🎉", label: "Праздник" }
];

export function MessageBubble({
  message,
  showSender = false,
  onReply,
  onEdit,
  onDelete,
  onReact
}: MessageBubbleProps) {
  const [menuPoint, setMenuPoint] = useState<ContextMenuPoint | null>(null);
  const press = useLongPressContextMenu({
    onOpen: setMenuPoint
  });
  const kind = message.kind ?? "text";
  const isMedia = kind === "image" || kind === "video" ||
    kind === "voice" || kind === "file";
  const canEdit = (
    message.direction === "outgoing" &&
    kind === "text" &&
    message.text.trim().length > 0 &&
    onEdit !== undefined
  );
  const reactions = message.reactions ?? [];
  const menuReactions: readonly ContextMenuReaction[] = onReact === undefined
    ? []
    : REACTIONS.map((reaction) => {
      const selected = reactions.some((item) =>
        item.key === reaction.key && item.selectedByMe
      );
      return {
        emoji: reaction.emoji,
        label: reaction.label,
        selected,
        onSelect: () => {
          onReact(message.id, selected ? null : reaction.key);
        }
      };
    });
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
    ...(onDelete === undefined ? [] : [{
      id: "delete",
      label: "Удалить",
      icon: "⌫",
      danger: true,
      onSelect: () => {
        if (window.confirm("Удалить сообщение?")) {
          onDelete(message.id);
        }
      }
    }])
  ];

  return (
    <>
      <article
        className={`message message--${message.direction}`}
        data-message-id={message.id}
        {...press}
      >
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
        {message.forwardedFrom !== undefined && (
          <div className="message__forwarded">
            <span>Переслано:</span>
            <strong>{message.forwardedFrom}</strong>
          </div>
        )}
        {isMedia && message.media !== undefined && (
          <MediaMessage kind={kind} media={message.media} />
        )}
        {message.text.length > 0 && <p>{message.text}</p>}
        <div className="message__meta">
          {message.edited === true && <span>изменено</span>}
          <time dateTime={message.sentAt}>
            {message.formattedTime ?? formatMessageTime(message.sentAt)}
          </time>
        </div>
        {reactions.length > 0 && (
          <div className="message__reactions" aria-label="Реакции на сообщение">
            {reactions
              .filter((reaction) => reaction.count > 0)
              .map((reaction) => {
                const label = `${reaction.emoji} ${String(reaction.count)}`;
                return onReact === undefined ? (
                  <span
                    key={reaction.key}
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
                    key={reaction.key}
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
                        reaction.selectedByMe ? null : reaction.key
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
      </article>
      {menuPoint !== null && (
        <PressContextMenu
          point={menuPoint}
          ariaLabel="Действия с сообщением"
          reactions={menuReactions}
          actions={actions}
          onClose={() => {
            setMenuPoint(null);
          }}
        />
      )}
    </>
  );
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
