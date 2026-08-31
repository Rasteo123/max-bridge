import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, it } from "vitest";

import { MaxSession } from "./max-session.js";

type SessionFixture = Readonly<{
  viewerId: string;
  chatList: unknown;
  history: unknown;
  liveIncoming: unknown;
}>;

let fixture: SessionFixture;

beforeEach(async () => {
  const source = await readFile(
    new URL("../tests/fixtures/synthetic-domain-wire.json", import.meta.url),
    "utf8"
  );
  fixture = JSON.parse(source) as SessionFixture;
});

describe("bounded in-memory MAX session", () => {
  it("retains only the configured chat list and open-chat history window", () => {
    const session = new MaxSession({
      viewerId: fixture.viewerId,
      maxChats: 1,
      maxOpenMessages: 2
    });

    session.replaceChats(fixture.chatList);
    session.openChat("1001");
    session.replaceOpenHistory(fixture.history);

    expect(session.chats).toHaveLength(1);
    expect(session.chats[0]?.id).toBe("1002");
    expect(session.openMessages).toHaveLength(2);
    expect(session.openMessages.map((message) => message.id))
      .toEqual(["3007", "3008"]);

    session.openChat("1002");
    expect(session.openMessages).toEqual([]);
  });

  it("merges a live event only into the selected chat and exposes cursor", () => {
    const session = new MaxSession({ viewerId: fixture.viewerId });
    session.replaceChats(fixture.chatList);
    session.openChat("1001");

    const events = session.ingestLive(fixture.liveIncoming);

    expect(events).toHaveLength(1);
    expect(session.openMessages.at(-1)?.id).toBe("4001");
    expect(session.reconnectCursor).toBe("4001");
  });

  it("adapts an older page without disturbing the open chat", () => {
    const session = new MaxSession({ viewerId: fixture.viewerId });
    session.replaceChats(fixture.chatList);
    session.openChat("1001");
    session.replaceOpenHistory(fixture.history);
    const openBefore = session.openMessages;

    const page = session.wireHistoryPage({
      messages: [{
        id: 2001n,
        time: Date.parse("2026-08-01T00:00:00.000Z"),
        type: "USER",
        sender: 41_798_245,
        text: "older",
        attaches: [],
        reactionInfo: {}
      }]
    }, "1001");

    expect(page.map((message) => message.text)).toEqual(["older"]);
    // Live events merge into the newest window, so paging backwards must not
    // move the selection or replace what the open chat is holding.
    expect(session.openMessages).toEqual(openBefore);
  });

  it("clears all runtime media and message references on close", () => {
    const session = new MaxSession({ viewerId: fixture.viewerId });
    session.replaceChats(fixture.chatList);
    session.openChat("1001");
    session.replaceOpenHistory(fixture.history);

    session.close();

    expect(session.chats).toEqual([]);
    expect(session.openMessages).toEqual([]);
    expect(session.mediaEntries).toBe(0);
  });
});
