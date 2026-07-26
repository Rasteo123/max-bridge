import type { MessengerChat } from "./types.js";

type ChatRowProps = Readonly<{
  chat: MessengerChat;
  selected: boolean;
  onSelect(chatId: string): void;
}>;

export function ChatRow({
  chat,
  selected,
  onSelect
}: ChatRowProps) {
  const time = chat.formattedTime ?? formatChatTime(chat.timestamp);
  const initials = initialsFor(chat.title);
  return (
    <button
      className="chat-row"
      type="button"
      aria-current={selected ? "true" : undefined}
      onClick={() => {
        onSelect(chat.id);
      }}
    >
      <span className="chat-row__avatar" aria-hidden="true">
        {chat.avatarUrl === undefined ? (
          initials
        ) : (
          <img src={chat.avatarUrl} alt="" />
        )}
      </span>
      <span className="chat-row__content">
        <span className="chat-row__name">{chat.title}</span>
        <span className="chat-row__preview" title={chat.preview}>
          {chat.deliveryStatus !== undefined && (
            <span className="chat-row__delivery" aria-hidden="true">
              {chat.deliveryStatus === "read" ? "✓✓" : "✓"}
            </span>
          )}
          {chat.preview}
        </span>
      </span>
      <span className="chat-row__meta">
        <time dateTime={chat.timestamp}>{time}</time>
        {chat.unreadCount > 0 && (
          <span
            className="chat-row__unread"
            aria-label={unreadLabel(chat.unreadCount)}
          >
            {chat.unreadCount > 99 ? "99+" : chat.unreadCount}
          </span>
        )}
      </span>
    </button>
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
