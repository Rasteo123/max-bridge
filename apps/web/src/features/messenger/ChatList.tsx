import { useMemo, useState } from "react";

import { ChatRow } from "./ChatRow.js";
import type {
  MessengerChat,
  MessengerChatAction,
  MessengerTheme
} from "./types.js";

type ChatListProps = Readonly<{
  chats: readonly MessengerChat[];
  selectedChatId?: string;
  onSelectChat(chatId: string): void;
  theme: MessengerTheme;
  onThemeChange(theme: MessengerTheme): void;
  onLogout?(): void;
  onChatAction?(chatId: string, action: MessengerChatAction): void;
}>;

export function ChatList({
  chats,
  selectedChatId,
  onSelectChat,
  theme,
  onThemeChange,
  onLogout,
  onChatAction
}: ChatListProps) {
  const [query, setQuery] = useState("");
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    if (normalized.length === 0) {
      return chats;
    }
    return chats.filter((chat) =>
      `${chat.title}\n${chat.preview}`
        .toLocaleLowerCase("ru-RU")
        .includes(normalized)
    );
  }, [chats, query]);

  return (
    <aside className="chat-list" data-testid="chat-list" aria-label="Список чатов">
      <header className="chat-list__header">
        <div>
          <p className="chat-list__eyebrow">MAX</p>
          <h1>Чаты</h1>
        </div>
        <details className="app-menu" data-no-swipe>
          <summary className="icon-button" aria-label="Настройки">
            <span aria-hidden="true">•••</span>
          </summary>
          <div className="app-menu__panel">
            <fieldset>
              <legend>Тема</legend>
              {([
                ["system", "Системная"],
                ["light", "Светлая"],
                ["dark", "Тёмная"]
              ] as const).map(([value, label]) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="theme"
                    checked={theme === value}
                    onChange={() => {
                      onThemeChange(value);
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            {onLogout !== undefined && (
              <button
                className="app-menu__logout"
                type="button"
                onClick={onLogout}
              >
                Выйти из MAX
              </button>
            )}
          </div>
        </details>
      </header>
      <label className="chat-search">
        <span className="sr-only">Поиск по чатам</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Поиск по чатам"
          data-no-swipe
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
          }}
        />
      </label>
      <div className="chat-list__scroll">
        {visibleChats.length === 0 ? (
          <p className="empty-state">
            {chats.length === 0
              ? "Пока нет доступных чатов"
              : "Ничего не найдено"}
          </p>
        ) : visibleChats.map((chat) => (
          <ChatRow
            key={chat.id}
            chat={chat}
            selected={chat.id === selectedChatId}
            onSelect={onSelectChat}
            {...(onChatAction === undefined ? {} : { onChatAction })}
          />
        ))}
      </div>
    </aside>
  );
}
