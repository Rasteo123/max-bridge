import {
  useMemo,
  useState,
  type CSSProperties
} from "react";

import {
  CHAT_FOLDERS,
  chatsInFolder,
  folderIndexOf,
  type ChatFolderId
} from "./chat-folders.js";
import { ChatRow } from "./ChatRow.js";
import { ContactProfile } from "./ContactProfile.js";
import {
  SEARCH_MIN_LENGTH,
  useChatSearch,
  type ChatSearchState
} from "./useChatSearch.js";
import type {
  MessengerChat,
  MessengerChatAction
} from "./types.js";

type ChatListProps = Readonly<{
  chats: readonly MessengerChat[];
  selectedChatId?: string;
  onSelectChat(chatId: string): void;
  onChatAction?(chatId: string, action: MessengerChatAction): void;
  folder?: ChatFolderId;
  onFolderChange?(folder: ChatFolderId): void;
  folderOffset?: number;
  onSearch?(
    query: string,
    signal: AbortSignal
  ): Promise<readonly MessengerChat[]>;
  onSubscribe?(chat: MessengerChat): void;
  onOpenSettings?(): void;
  botMutedChatIds?: ReadonlySet<string>;
  onToggleBotNotifications?(chatId: string, muted: boolean): void;
}>;

export function ChatList({
  chats,
  selectedChatId,
  onSelectChat,
  onChatAction,
  folder = "all",
  onFolderChange,
  folderOffset = 0,
  onSearch,
  onSubscribe,
  onOpenSettings,
  botMutedChatIds,
  onToggleBotNotifications
}: ChatListProps) {
  const [query, setQuery] = useState("");
  const [previewChat, setPreviewChat] = useState<MessengerChat>();
  const search = useChatSearch(query, onSearch);
  const searching = query.trim().length >= SEARCH_MIN_LENGTH;
  const folderChats = useMemo(
    () => chatsInFolder(chats, folder),
    [chats, folder]
  );
  const visibleChats = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ru-RU");
    if (normalized.length === 0) {
      return folderChats;
    }
    return chats.filter((chat) =>
      `${chat.title}\n${chat.preview}`
        .toLocaleLowerCase("ru-RU")
        .includes(normalized)
    );
  }, [chats, folderChats, query]);
  const ownIds = useMemo(
    () => new Set(chats.map((chat) => chat.id)),
    [chats]
  );
  const globalResults = useMemo(
    () => search.results.filter((chat) =>
      chat.joined !== true && !ownIds.has(chat.id)
    ),
    [search.results, ownIds]
  );
  const enterFrom = useFolderTransition(folder);
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
        <button
          className="icon-button"
          type="button"
          aria-label="Настройки"
          data-no-swipe
          onClick={onOpenSettings}
        >
          <span aria-hidden="true">⚙</span>
        </button>
      </header>
      <label className="chat-search">
        <span className="sr-only">Поиск по чатам и каналам</span>
        <span aria-hidden="true">⌕</span>
        <input
          type="search"
          placeholder="Поиск по чатам и каналам"
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
        key={folder}
        className="chat-list__scroll"
        data-folder={folder}
        data-enter={enterFrom}
        style={folderStyle}
      >
        {visibleChats.length === 0 && (!searching || globalResults.length === 0)
          ? (
            <p className="empty-state">
              {searching
                ? searchEmptyMessage(search.state)
                : emptyFolderMessage(chats.length, folderChats.length, folder)}
            </p>
          )
          : (
            <>
              {searching && visibleChats.length > 0 && (
                <p className="chat-list__section">Ваши чаты</p>
              )}
              {visibleChats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  selected={chat.id === selectedChatId}
                  onSelect={onSelectChat}
                  {...(onChatAction === undefined ? {} : { onChatAction })}
                  botMuted={botMutedChatIds?.has(chat.id) ?? false}
                  {...(onToggleBotNotifications === undefined
                    ? {}
                    : { onToggleBotNotifications })}
                />
              ))}
              {searching && globalResults.length > 0 && (
                <p className="chat-list__section">Глобальный поиск</p>
              )}
              {searching && globalResults.map((chat) => (
                <ChatRow
                  key={`global:${chat.id}`}
                  chat={{ ...chat, preview: searchPreview(chat) }}
                  selected={false}
                  onSelect={() => {
                    setPreviewChat(chat);
                  }}
                />
              ))}
            </>
          )}
        {searching && search.state === "searching" && (
          <p className="empty-state" role="status">Ищем в MAX…</p>
        )}
      </div>
      {previewChat !== undefined && (
        <ContactProfile
          chat={previewChat}
          subtitle={globalPreview(previewChat)}
          onClose={() => {
            setPreviewChat(undefined);
          }}
          {...(onSubscribe === undefined ? {} : {
            onSubscribe: (chat: MessengerChat) => {
              setPreviewChat(undefined);
              onSubscribe(chat);
            }
          })}
        />
      )}
    </aside>
  );
}

/**
 * Which way the incoming folder should travel in from: the same left-to-right
 * motion the conversation uses when it gives the list back.
 */
function useFolderTransition(folder: ChatFolderId): "left" | "right" {
  // Derived while rendering rather than in an effect: the list is keyed by
  // folder, so it mounts once with whatever direction is on the element, and
  // an effect would arrive a frame too late to steer the animation.
  const [seen, setSeen] = useState<Readonly<{
    folder: ChatFolderId;
    enterFrom: "left" | "right";
  }>>({ folder, enterFrom: "right" });
  if (seen.folder !== folder) {
    setSeen({
      folder,
      enterFrom: folderIndexOf(folder) > folderIndexOf(seen.folder)
        ? "right"
        : "left"
    });
  }
  return seen.enterFrom;
}

/**
 * MAX puts the channel's latest post under a search hit, and falls back to the
 * account's description for bots and channels that have never posted.
 */
function searchPreview(chat: MessengerChat): string {
  return chat.preview.length > 0 ? chat.preview : (chat.description ?? "");
}

/** The profile card's subtitle: how many people are in it, and what it is. */
function globalPreview(chat: MessengerChat): string {
  const members = chat.membersCount === undefined
    ? undefined
    : `${new Intl.NumberFormat("ru-RU").format(chat.membersCount)} ${
      pluralizeMembers(chat.membersCount, chat.kind)
    }`;
  return [members, chat.description]
    .filter((part) => part !== undefined && part.length > 0)
    .join(" · ");
}

function pluralizeMembers(
  count: number,
  kind: MessengerChat["kind"]
): string {
  const forms = kind === "channel"
    ? ["подписчик", "подписчика", "подписчиков"]
    : ["участник", "участника", "участников"];
  const tens = count % 100;
  const ones = count % 10;
  if (tens >= 11 && tens <= 14) {
    return forms[2] ?? "";
  }
  if (ones === 1) {
    return forms[0] ?? "";
  }
  return (ones >= 2 && ones <= 4 ? forms[1] : forms[2]) ?? "";
}

function searchEmptyMessage(state: ChatSearchState["state"]): string {
  if (state === "searching") {
    return "Ищем в MAX…";
  }
  return state === "failed"
    ? "Не удалось выполнить поиск"
    : "Ничего не найдено";
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
