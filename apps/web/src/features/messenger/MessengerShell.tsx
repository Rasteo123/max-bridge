import {
  useEffect,
  useMemo,
  useState
} from "react";

import { ChatList } from "./ChatList.js";
import { Conversation } from "./Conversation.js";
import type {
  MessengerChat,
  MessengerChatAction,
  MessengerMessage,
  MessengerPane,
  MessengerSticker,
  MessengerTheme,
  ReactionKey
} from "./types.js";
import { useResponsivePane } from "./useResponsivePane.js";
import { useSwipeNavigation } from "./useSwipeNavigation.js";
import "./messenger.css";

type MessengerShellProps = Readonly<{
  chats: readonly MessengerChat[];
  messages: readonly MessengerMessage[];
  initialChatId?: string;
  initialPane?: MessengerPane;
  onSelectChat(chatId: string): void;
  onSend(text: string, replyToId?: string): void;
  onAttach?(file: File, kind: "media" | "file"): void;
  onEditMessage?(messageId: string, text: string): void;
  onDeleteMessage?(messageId: string): void;
  onReactMessage?(messageId: string, reaction: ReactionKey | null): void;
  onChatAction?(chatId: string, action: MessengerChatAction): void;
  onLoadStickers?(): Promise<readonly MessengerSticker[]>;
  onSendSticker?(stickerId: string): Promise<void> | void;
  theme?: MessengerTheme;
  onThemeChange?(theme: MessengerTheme): void;
  onLogout?(): void;
  historyLoading?: boolean;
}>;

export function MessengerShell({
  chats,
  messages,
  initialChatId,
  initialPane,
  onSelectChat,
  onSend,
  onAttach,
  onEditMessage,
  onDeleteMessage,
  onReactMessage,
  onChatAction,
  onLoadStickers,
  onSendSticker,
  theme = "system",
  onThemeChange = () => undefined,
  onLogout,
  historyLoading = false
}: MessengerShellProps) {
  const wide = useResponsivePane();
  const [selectedChatId, setSelectedChatId] = useState(initialChatId);
  const [pane, setPane] = useState<MessengerPane>(
    initialPane ?? (initialChatId === undefined ? "list" : "conversation")
  );
  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId),
    [chats, selectedChatId]
  );
  const swipe = useSwipeNavigation({
    pane,
    setPane,
    disabled: wide
  });

  useEffect(() => {
    if (initialChatId !== undefined) {
      setSelectedChatId(initialChatId);
      return;
    }
    setSelectedChatId(undefined);
    setPane("list");
  }, [initialChatId]);

  function selectChat(chatId: string) {
    setSelectedChatId(chatId);
    setPane("conversation");
    onSelectChat(chatId);
  }

  return (
    <main
      className="messenger-page"
      data-testid="messenger-surface"
      onPointerDown={swipe.onPointerDown}
      onPointerMove={swipe.onPointerMove}
      onPointerUp={swipe.onPointerUp}
      onPointerCancel={swipe.onPointerCancel}
      onTouchStart={swipe.onTouchStart}
      onTouchMove={swipe.onTouchMove}
      onTouchEnd={swipe.onTouchEnd}
      onTouchCancel={swipe.onTouchCancel}
      onWheel={swipe.onWheel}
      onClickCapture={swipe.onClickCapture}
    >
      <section
        className="messenger-shell"
        data-testid="messenger-shell"
        data-mode={wide ? "wide" : "narrow"}
        data-pane={pane}
        data-dragging={swipe.dragging ? "true" : "false"}
        aria-label="Круг друзей"
      >
        <div className="messenger-track" style={swipe.trackStyle}>
          <ChatList
            chats={chats}
            {...(selectedChatId === undefined
              ? {}
              : { selectedChatId })}
            onSelectChat={selectChat}
            theme={theme}
            onThemeChange={onThemeChange}
            {...(onLogout === undefined ? {} : { onLogout })}
            {...(onChatAction === undefined ? {} : { onChatAction })}
          />
          <Conversation
            {...(selectedChat === undefined ? {} : { chat: selectedChat })}
            messages={messages}
            historyLoading={historyLoading}
            wide={wide}
            onOpenChats={() => {
              setPane("list");
            }}
            onSend={onSend}
            {...(onAttach === undefined ? {} : { onAttach })}
            {...(onEditMessage === undefined ? {} : { onEditMessage })}
            {...(onDeleteMessage === undefined ? {} : { onDeleteMessage })}
            {...(onReactMessage === undefined ? {} : { onReactMessage })}
            {...(onLoadStickers === undefined ? {} : { onLoadStickers })}
            {...(onSendSticker === undefined ? {} : { onSendSticker })}
          />
        </div>
      </section>
    </main>
  );
}
