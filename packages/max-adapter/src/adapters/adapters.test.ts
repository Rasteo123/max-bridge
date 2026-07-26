import { readFile } from "node:fs/promises";

import {
  parseChatSummary,
  parseMessage
} from "@maxbridge/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { adaptChatList } from "./chat-list-adapter.js";
import { MaxCompatibilityError } from "./errors.js";
import { adaptHistoryPage } from "./history-adapter.js";
import { LiveEventAdapter } from "./live-event-adapter.js";
import { RuntimeMediaAdapter } from "./media-adapter.js";

type DomainFixture = Readonly<{
  viewerId: string;
  chatList: unknown;
  history: unknown;
  liveIncoming: unknown;
  liveDeleted: unknown;
  unknown: unknown;
}>;

let fixture: DomainFixture;

beforeEach(async () => {
  fixture = await loadFixture();
});

describe("MAX chat list adapter", () => {
  it("adapts direct and group summaries with preview, time and unread count", () => {
    const media = new RuntimeMediaAdapter();

    const page = adaptChatList(fixture.chatList, { media });

    expect(page.chats).toHaveLength(2);
    expect(page.chats.map((chat) => chat.kind).sort())
      .toEqual(["direct", "group"]);
    expect(page.chats.find((chat) => chat.kind === "direct")).toMatchObject({
      title: "Синтетический контакт",
      preview: "Синтетический привет",
      unreadCount: 2,
      muted: false
    });
    expect(page.chats.find((chat) => chat.kind === "group")).toMatchObject({
      title: "Синтетическая группа",
      preview: "Изображение",
      muted: true
    });
    for (const chat of page.chats) {
      expect(() => parseChatSummary(chat)).not.toThrow();
    }
    expect(page.nextCursor).toBe("1000");
    expect(page.hasMore).toBe(true);
  });
});

describe("MAX history and media adapters", () => {
  it("adapts text, image, video, voice, file and system messages", () => {
    const media = new RuntimeMediaAdapter();

    const page = adaptHistoryPage(fixture.history, {
      chatId: "1001",
      viewerId: fixture.viewerId,
      media
    });

    expect(page.messages.map((message) => message.kind)).toEqual([
      "text",
      "image",
      "video",
      "voice",
      "file",
      "system",
      "text",
      "text"
    ]);
    expect(page.messages[1]).toMatchObject({
      direction: "outgoing",
      text: "Подпись к фото",
      media: {
        width: 1280,
        height: 720
      }
    });
    expect(page.messages[4]).toMatchObject({
      media: {
        fileName: "test.pdf",
        mimeType: "application/pdf",
        size: 12345
      }
    });
    expect(page.messages[6]).toMatchObject({ edited: true });
    expect(page.messages[7]).toMatchObject({
      deleted: true,
      text: "Сообщение удалено"
    });
    for (const message of page.messages) {
      expect(() => parseMessage(message)).not.toThrow();
    }
    expect(page.nextCursor).toBe("3001");
    expect(page.hasMore).toBe(true);
  });

  it("keeps media descriptors only in bounded memory and zeros previews", () => {
    const media = new RuntimeMediaAdapter({ maxEntries: 10 });
    const page = adaptHistoryPage(fixture.history, {
      chatId: "1001",
      viewerId: fixture.viewerId,
      media
    });
    const image = page.messages.find((message) => message.kind === "image");
    if (image === undefined || !("media" in image)) {
      throw new Error("Synthetic image is missing");
    }
    const descriptor = media.resolve(image.media.handle);
    expect(descriptor?.previewData).toEqual(Uint8Array.from([1, 2, 3]));
    const preview = descriptor?.previewData;
    expect(media.size).toBeLessThanOrEqual(10);

    media.clear();

    expect(media.size).toBe(0);
    expect(preview?.every((byte) => byte === 0)).toBe(true);
  });
});

describe("MAX live event adapter", () => {
  it("suppresses duplicates and tracks a reconnect cursor", () => {
    const adapter = new LiveEventAdapter({
      viewerId: fixture.viewerId,
      media: new RuntimeMediaAdapter()
    });

    const first = adapter.adapt(fixture.liveIncoming);
    const duplicate = adapter.adapt(fixture.liveIncoming);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      type: "message.upsert",
      message: { id: "4001" }
    });
    expect(duplicate).toEqual([]);
    expect(adapter.reconnectCursor).toBe("4001");
  });

  it("adapts deletions and rejects unknown shapes with a public error", () => {
    const adapter = new LiveEventAdapter({
      viewerId: fixture.viewerId,
      media: new RuntimeMediaAdapter()
    });

    expect(adapter.adapt(fixture.liveDeleted)[0]).toMatchObject({
      type: "message.deleted",
      chatId: "1001",
      messageId: "4001"
    });
    expect(() => adapter.adapt(fixture.unknown))
      .toThrow(MaxCompatibilityError);
    try {
      adapter.adapt(fixture.unknown);
    } catch (error: unknown) {
      expect(error).toMatchObject({
        code: "max_wire_incompatible",
        message: "MAX event shape is not supported"
      });
      expect(JSON.stringify(error)).not.toContain("unexpected");
    }
  });

  it("does not log message bodies", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error")
      .mockImplementation(() => undefined);
    const adapter = new LiveEventAdapter({
      viewerId: fixture.viewerId,
      media: new RuntimeMediaAdapter()
    });

    adapter.adapt(fixture.liveIncoming);

    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});

async function loadFixture(): Promise<DomainFixture> {
  const source = await readFile(
    new URL("../../tests/fixtures/synthetic-domain-wire.json", import.meta.url),
    "utf8"
  );
  return JSON.parse(source) as DomainFixture;
}
