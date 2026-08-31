import {
  useCallback,
  useEffect,
  useMemo,
  useState
} from "react";

import { currentTelegramWebApp } from "../auth/telegram.js";
import type { MessageSendResult } from "../../api/client.js";
import {
  runTopBackHandler,
  useBackHandlerDepth
} from "./back-navigation.js";
import {
  CHAT_FOLDERS,
  folderAt,
  folderIndexOf,
  type ChatFolderId
} from "./chat-folders.js";
import { ChatList } from "./ChatList.js";
import { Conversation } from "./Conversation.js";
import { ForwardMessagePicker } from "./ForwardMessagePicker.js";
import type {
  AttachmentSendState,
  MessengerChat,
  MessengerChatAction,
  MessengerForwardedSource,
  MessengerMessage,
  MessengerPane,
  MessengerSticker,
  ReactionEmoji
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
  onSearchChats?(
    query: string,
    signal: AbortSignal
  ): Promise<readonly MessengerChat[]>;
  onSend(text: string, replyToId?: string): void;
  onAttach?(file: File, kind: "media" | "file"): void;
  attachmentState?: AttachmentSendState;
  onRetryAttachment?(): void;
  onCancelAttachment?(): void;
  onEditMessage?(messageId: string, text: string): void;
  onDeleteMessage?(messageId: string, forEveryone: boolean): void;
  onForwardMessage?(
    sourceMessageId: string,
    destinationIds: readonly string[]
  ): Promise<MessageSendResult>;
  onReactMessage?(messageId: string, reaction: ReactionEmoji | null): void;
  onOpenForwardedSource?(source: MessengerForwardedSource): void;
  onOpenComments?(message: MessengerMessage): void;
  onUnsubscribe?(chat: MessengerChat): void;
  onSubscribe?(chat: MessengerChat): void;
  onOpenSettings?(): void;
  botMutedChatIds?: ReadonlySet<string>;
  onToggleBotNotifications?(chatId: string, muted: boolean): void;
  onChatAction?(chatId: string, action: MessengerChatAction): void;
  onLoadOlder?(): void;
  onLoadStickers?(): Promise<readonly MessengerSticker[]>;
  onSendSticker?(stickerId: string): Promise<void> | void;
  historyLoading?: boolean;
}>;

export function MessengerShell({
  chats,
  messages,
  initialChatId,
  initialPane,
  onSelectChat,
  onSearchChats,
  onSend,
  onAttach,
  attachmentState,
  onRetryAttachment,
  onCancelAttachment,
  onEditMessage,
  onDeleteMessage,
  onForwardMessage,
  onReactMessage,
  onOpenForwardedSource,
  onOpenComments,
  onUnsubscribe,
  onSubscribe,
  onOpenSettings,
  botMutedChatIds,
  onToggleBotNotifications,
  onChatAction,
  onLoadOlder,
  onLoadStickers,
  onSendSticker,
  historyLoading = false
}: MessengerShellProps) {
  const wide = useResponsivePane();
  const telegram = useMemo(() => currentTelegramWebApp(), []);
  const [active, setActive] = useState(telegram?.isActive !== false);
  const [selectedChatId, setSelectedChatId] = useState(initialChatId);
  const [pane, setPane] = useState<MessengerPane>(
    initialPane ?? (initialChatId === undefined ? "list" : "conversation")
  );
  const [forwardSource, setForwardSource] =
    useState<MessengerMessage | null>(null);
  const selectedChat = useMemo(
    () => chats.find((chat) => chat.id === selectedChatId),
    [chats, selectedChatId]
  );
  const hasSelectedChat = selectedChat !== undefined;
  const [folder, setFolder] = useState<ChatFolderId>("all");
  const selectFolderIndex = useCallback((index: number) => {
    setFolder(folderAt(index));
  }, []);
  const swipe = useSwipeNavigation({
    pane,
    setPane,
    disabled: wide,
    folders: {
      index: folderIndexOf(folder),
      count: CHAT_FOLDERS.length,
      onSelect: selectFolderIndex
    }
  });
  const overlayDepth = useBackHandlerDepth();
  const openChats = useCallback(() => {
    setPane("list");
  }, []);
  // An open overlay owns the back button; only when none is open does back
  // return from the conversation to the chat list.
  const goBack = useCallback(() => {
    if (runTopBackHandler()) {
      return;
    }
    setPane("list");
  }, []);

  useEffect(() => {
    if (initialChatId !== undefined) {
      setSelectedChatId(initialChatId);
      return;
    }
    setSelectedChatId(undefined);
    setPane("list");
  }, [initialChatId]);

  useEffect(() => {
    if (
      telegram?.onEvent === undefined ||
      telegram.offEvent === undefined
    ) {
      return;
    }
    const activated = () => {
      setActive(true);
    };
    const deactivated = () => {
      setActive(false);
    };
    telegram.onEvent("activated", activated);
    telegram.onEvent("deactivated", deactivated);
    return () => {
      telegram.offEvent?.("activated", activated);
      telegram.offEvent?.("deactivated", deactivated);
    };
  }, [telegram]);

  useEffect(() => {
    const backButton = telegram?.BackButton;
    if (backButton === undefined) {
      return;
    }
    const returnsToList = !wide && pane === "conversation" && hasSelectedChat;
    if (overlayDepth === 0 && !returnsToList) {
      backButton.hide();
      return;
    }
    backButton.onClick(goBack);
    backButton.show();
    return () => {
      backButton.offClick(goBack);
      backButton.hide();
    };
  }, [goBack, hasSelectedChat, overlayDepth, pane, telegram, wide]);

  function selectChat(chatId: string) {
    setSelectedChatId(chatId);
    setPane("conversation");
    onSelectChat(chatId);
  }

  function closeForwardPicker(): void {
    const sourceId = forwardSource?.id;
    setForwardSource(null);
    if (sourceId === undefined) {
      return;
    }
    requestAnimationFrame(() => {
      const source = [...document.querySelectorAll<HTMLElement>(
        "[data-message-id]"
      )].find((element) => element.dataset["messageId"] === sourceId);
      source?.focus();
    });
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
            folder={folder}
            onFolderChange={setFolder}
            folderOffset={swipe.folderOffset}
            {...(onChatAction === undefined ? {} : { onChatAction })}
            {...(onSearchChats === undefined
              ? {}
              : { onSearch: onSearchChats })}
            {...(onSubscribe === undefined ? {} : { onSubscribe })}
            {...(onOpenSettings === undefined ? {} : { onOpenSettings })}
            {...(botMutedChatIds === undefined ? {} : { botMutedChatIds })}
            {...(onToggleBotNotifications === undefined
              ? {}
              : { onToggleBotNotifications })}
          />
          <Conversation
            {...(selectedChat === undefined ? {} : { chat: selectedChat })}
            messages={messages}
            historyLoading={historyLoading}
            {...(onLoadOlder === undefined ? {} : { onLoadOlder })}
            wide={wide}
            active={active}
            onOpenChats={openChats}
            onSend={onSend}
            {...(onAttach === undefined ? {} : { onAttach })}
            {...(attachmentState === undefined ? {} : { attachmentState })}
            {...(onRetryAttachment === undefined
              ? {}
              : { onRetryAttachment })}
            {...(onCancelAttachment === undefined
              ? {}
              : { onCancelAttachment })}
            {...(onEditMessage === undefined ? {} : { onEditMessage })}
            {...(onDeleteMessage === undefined ? {} : { onDeleteMessage })}
            {...(onForwardMessage === undefined ? {} : {
              onForwardMessage: setForwardSource
            })}
            {...(onReactMessage === undefined ? {} : { onReactMessage })}
            {...(onOpenComments === undefined ? {} : { onOpenComments })}
            {...(onUnsubscribe === undefined ? {} : { onUnsubscribe })}
            {...(onSubscribe === undefined ? {} : { onSubscribe })}
            {...(onOpenForwardedSource === undefined
              ? {}
              : { onOpenForwardedSource })}
            {...(onLoadStickers === undefined ? {} : { onLoadStickers })}
            {...(onSendSticker === undefined ? {} : { onSendSticker })}
          />
        </div>
      </section>
      {forwardSource !== null && onForwardMessage !== undefined && (
        <ForwardMessagePicker
          chats={chats}
          onClose={closeForwardPicker}
          onConfirm={(destinationIds) => {
            return onForwardMessage(forwardSource.id, destinationIds);
          }}
        />
      )}
    </main>
  );
}
