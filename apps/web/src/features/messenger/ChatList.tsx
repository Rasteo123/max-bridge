import { type CSSProperties, useMemo, useState } from "react";

import {
  CHAT_FOLDERS,
  chatsInFolder,
  type ChatFolderId
} from "./chat-folders.js";
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
  folder?: ChatFolderId;
  onFolderChange?(folder: ChatFolderId): void;
  folderOffset?: number;
}>;

export function ChatList({
  chats,
  selectedChatId,
  onSelectChat,
  theme,
  onThemeChange,
  onLogout,
  onChatAction,
  folder = "all",
  onFolderChange,
  folderOffset = 0
}: ChatListProps) {
  const [query, setQuery] = useState("");
  const folderChats = useMemo(
    () => chatsInFolder(chats, folder),
    [chats, folder]
  );
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    if (normalized.length === 0) {
      return folderChats;
    }
    return folderChats.filter((chat) =>
      `${chat.title}\n${chat.preview}`
        .toLocaleLowerCase("ru-RU")
        .includes(normalized)
    );
  }, [folderChats, query]);
  const folderStyle = {
    "--folder-offset": `${String(folderOffset)}px`
  } as CSSProperties;

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
      <div className="chat-folders" role="tablist" aria-label="Папки чатов">
        {CHAT_FOLDERS.map((entry) => (
          <button
            key={entry.id}
            className="chat-folders__tab"
            type="button"
            role="tab"
            data-no-swipe
            aria-selected={entry.id === folder}
            onClick={() => {
              onFolderChange?.(entry.id);
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <div
        className="chat-list__scroll"
        data-folder={folder}
        style={folderStyle}
      >
        {visibleChats.length === 0 ? (
          <p className="empty-state">
            {emptyFolderMessage(chats.length, folderChats.length, folder)}
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

function emptyFolderMessage(
  total: number,
  inFolder: number,
  folder: ChatFolderId
): string {
  if (total === 0) {
    return "Пока нет доступных чатов";
  }
  if (inFolder > 0) {
    return "Ничего не найдено";
  }
  if (folder === "unread") {
    return "Непрочитанных чатов нет";
  }
  return folder === "channels"
    ? "Вы пока не подписаны ни на один канал"
    : "Ничего не найдено";
}
