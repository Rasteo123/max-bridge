import type {
  BridgeEvent,
  ChatSummary,
  Message
} from "@maxbridge/core";

import {
  adaptChatList,
  adaptSearchResults } from "./adapters/chat-list-adapter.js";
import { adaptHistoryPage } from "./adapters/history-adapter.js";
import { LiveEventAdapter } from "./adapters/live-event-adapter.js";
import {
  RuntimeMediaAdapter,
  type RuntimeMediaDescriptor
} from "./adapters/media-adapter.js";
import { adaptWireHistory } from "./adapters/wire-message-adapter.js";

export class MaxSession {
  private readonly media = new RuntimeMediaAdapter();
  private readonly live: LiveEventAdapter;
  private readonly viewerId: string;
  private readonly maxChats: number;
  private readonly maxOpenMessages: number;
  private chatList: readonly ChatSummary[] = [];
  private selectedChatId: string | undefined;
  private selectedMessages: readonly Message[] = [];

  constructor(options: Readonly<{
    viewerId: string;
    maxChats?: number;
    maxOpenMessages?: number;
  }>) {
    this.viewerId = options.viewerId;
    this.maxChats = Math.max(1, options.maxChats ?? 1_000);
    this.maxOpenMessages = Math.max(
      1,
      options.maxOpenMessages ?? 200
    );
    this.live = new LiveEventAdapter({
      viewerId: options.viewerId,
      media: this.media
    });
  }

  get chats(): readonly ChatSummary[] {
    return this.chatList;
  }

  get openMessages(): readonly Message[] {
    return this.selectedMessages;
  }

  get reconnectCursor(): string | undefined {
    return this.live.reconnectCursor;
  }

  get mediaEntries(): number {
    return this.media.size;
  }

  resolveMedia(handle: string): RuntimeMediaDescriptor | undefined {
    return this.media.resolve(handle);
  }

  /**
   * Adapts a global-search response without disturbing the chat list: search
   * results describe chats the viewer may never have joined.
   */
  searchChats(payload: unknown): readonly ChatSummary[] {
    return adaptSearchResults(payload, { media: this.media })
      .slice(0, this.maxChats);
  }

  replaceChats(payload: unknown): void {
    const page = adaptChatList(payload, { media: this.media });
    this.chatList = page.chats.slice(0, this.maxChats);
  }

  openChat(chatId: string): void {
    if (this.selectedChatId === chatId) {
      return;
    }
    this.selectedChatId = chatId;
    this.selectedMessages = [];
  }

  leaveChat(): void {
    this.selectedChatId = undefined;
    this.selectedMessages = [];
  }

  replaceOpenHistory(payload: unknown): void {
    if (this.selectedChatId === undefined) {
      throw new Error("No MAX chat is selected");
    }
    const page = adaptHistoryPage(payload, {
      chatId: this.selectedChatId,
      viewerId: this.viewerId,
      media: this.media
    });
    this.selectedMessages = page.messages.slice(-this.maxOpenMessages);
  }

  /** Replaces the open history from a raw opcode 49 response. */
  replaceOpenWireHistory(
    payload: unknown,
    options: Readonly<{
      readMarks?: readonly number[];
      senderNames?: ReadonlyMap<string, string>;
      commentCounts?: ReadonlyMap<string, number>;
    }> = {}
  ): void {
    if (this.selectedChatId === undefined) {
      throw new Error("No MAX chat is selected");
    }
    const messages = adaptWireHistory(payload, {
      chatId: this.selectedChatId,
      viewerId: this.viewerId,
      media: this.media,
      ...(options.readMarks === undefined
        ? {}
        : { readMarks: options.readMarks }),
      ...(options.senderNames === undefined
        ? {}
        : { senderNames: options.senderNames }),
      ...(options.commentCounts === undefined
        ? {}
        : { commentCounts: options.commentCounts })
    });
    this.selectedMessages = [...messages]
      .sort((left, right) => left.sentAt.localeCompare(right.sentAt))
      .slice(-this.maxOpenMessages);
  }

  ingestLive(payload: unknown): readonly BridgeEvent[] {
    const events = this.live.adapt(payload);
    for (const event of events) {
      if (
        event.type === "message.upsert"
        && event.message.chatId === this.selectedChatId
      ) {
        const withoutPrevious = this.selectedMessages.filter(
          (message) => message.id !== event.message.id
        );
        this.selectedMessages = [
          ...withoutPrevious,
          event.message
        ].slice(-this.maxOpenMessages);
      } else if (
        event.type === "message.deleted"
        && event.chatId === this.selectedChatId
      ) {
        this.selectedMessages = this.selectedMessages.filter(
          (message) => message.id !== event.messageId
        );
      }
    }
    return events;
  }

  close(): void {
    this.chatList = [];
    this.selectedMessages = [];
    this.selectedChatId = undefined;
    this.live.clear();
    this.media.clear();
  }
}
