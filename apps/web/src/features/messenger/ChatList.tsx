import { ChatRow } from "./ChatRow.js";
import type { MessengerChat } from "./types.js";

type ChatListProps = Readonly<{
  chats: readonly MessengerChat[];
  selectedChatId?: string;
  onSelectChat(chatId: string): void;
  onClose(): void;
  wide: boolean;
}>;

export function ChatList({
  chats,
  selectedChatId,
  onSelectChat,
  onClose,
  wide
}: ChatListProps) {
  return (
    <aside className="chat-list" data-testid="chat-list" aria-label="Список чатов">
      <header className="chat-list__header">
        <div>
          <p className="chat-list__eyebrow">MAX</p>
          <h1>Чаты</h1>
        </div>
        {!wide && (
          <button
            className="icon-button"
            type="button"
            aria-label="Закрыть список чатов"
            onClick={onClose}
          >
            <span>Закрыть</span>
          </button>
        )}
      </header>
      <label className="chat-search">
        <span className="sr-only">Поиск по чатам</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Поиск по чатам"
          data-no-swipe
        />
      </label>
      <div className="chat-list__scroll">
        {chats.length === 0 ? (
          <p className="empty-state">Пока нет доступных чатов</p>
        ) : chats.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            selected={chat.id === selectedChatId}
            onSelect={onSelectChat}
          />
        ))}
      </div>
    </aside>
  );
}
