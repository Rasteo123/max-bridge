import { useState } from "react";

import { DeliveryIndicator } from "./DeliveryIndicator.js";
import {
  PressContextMenu,
  type ContextMenuAction,
  type ContextMenuPoint,
  useLongPressContextMenu
} from "./PressContextMenu.js";
import type {
  MessengerChat,
  MessengerChatAction
} from "./types.js";

type ChatRowProps = Readonly<{
  chat: MessengerChat;
  selected: boolean;
  onSelect(chatId: string): void;
  onChatAction?(chatId: string, action: MessengerChatAction): void;
}>;

export function ChatRow({
  chat,
  selected,
  onSelect,
  onChatAction
}: ChatRowProps) {
  const [menuPoint, setMenuPoint] = useState<ContextMenuPoint | null>(null);
  const press = useLongPressContextMenu({
    disabled: onChatAction === undefined,
    onOpen: setMenuPoint
  });
  const time = chat.formattedTime ?? formatChatTime(chat.timestamp);
  const initials = initialsFor(chat.title);
  const actions: readonly ContextMenuAction[] = onChatAction === undefined
    ? []
    : [
      {
        id: chat.pinned === true ? "unpin" : "pin",
        label: chat.pinned === true ? "Открепить" : "Закрепить",
        icon: "⌖",
        onSelect: () => {
          onChatAction(chat.id, chat.pinned === true ? "unpin" : "pin");
        }
      },
      {
        id: "mark-unread",
        label: "Отметить непрочитанным",
        icon: "●",
        onSelect: () => {
          onChatAction(chat.id, "mark_unread");
        }
      },
      {
        id: chat.muted ? "unmute" : "mute",
        label: chat.muted
          ? "Включить уведомления"
          : "Отключить уведомления",
        icon: chat.muted ? "♩" : "♩̸",
        onSelect: () => {
          onChatAction(chat.id, chat.muted ? "unmute" : "mute");
        }
      },
      {
        id: "clear",
        label: "Стереть переписку",
        icon: "⌫",
        danger: true,
        onSelect: () => {
          if (window.confirm(`Стереть переписку «${chat.title}»?`)) {
            onChatAction(chat.id, "clear");
          }
        }
      },
      {
        id: "delete",
        label: "Удалить чат",
        icon: "✕",
        danger: true,
        onSelect: () => {
          if (window.confirm(`Удалить чат «${chat.title}»?`)) {
            onChatAction(chat.id, "delete");
          }
        }
      }
    ];

  return (
    <>
      <button
        className="chat-row"
        type="button"
        aria-current={selected ? "true" : undefined}
        {...press}
        onClick={() => {
          onSelect(chat.id);
        }}
      >
        <span className="chat-row__avatar">
          {chat.avatarUrl === undefined ? (
            <span aria-hidden="true">{initials}</span>
          ) : (
            <img src={chat.avatarUrl} alt="" />
          )}
          {chat.kind === "direct" && chat.presence === "online" && (
            <span
              className="presence-dot"
              role="status"
              aria-label="В сети"
            >
              <span className="sr-only">В сети</span>
            </span>
          )}
        </span>
        <span className="chat-row__content">
          <span className="chat-row__name">
            {chat.title}
            {chat.muted && (
              <span className="chat-row__muted" aria-label="Уведомления выключены">
                ♩̸
              </span>
            )}
          </span>
          <span className="chat-row__preview" title={chat.preview}>
            {chat.lastMessageDirection === "outgoing" &&
              chat.deliveryStatus !== undefined && (
              <DeliveryIndicator status={chat.deliveryStatus} preview />
            )}
            {chat.preview}
          </span>
        </span>
        <span className="chat-row__meta">
          <time dateTime={chat.timestamp}>{time}</time>
          {chat.unreadCount > 0 ? (
            <span
              className="chat-row__unread"
              aria-label={unreadLabel(chat.unreadCount)}
            >
              {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
            </span>
          ) : chat.pinned === true ? (
            <span className="chat-row__pinned" aria-label="Чат закреплён">
              ⌖
            </span>
          ) : null}
        </span>
      </button>
      {menuPoint !== null && (
        <PressContextMenu
          point={menuPoint}
          ariaLabel={`Действия с чатом «${chat.title}»`}
          actions={actions}
          onClose={() => {
            setMenuPoint(null);
          }}
        />
      )}
    </>
  );
}

function initialsFor(title: string): string {
  return title
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase("ru-RU") ?? "")
    .join("");
}

function formatChatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("ru-RU", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function unreadLabel(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11
    ? "непрочитанное сообщение"
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
      ? "непрочитанных сообщения"
      : "непрочитанных сообщений";
  return `${String(count)} ${word}`;
}
