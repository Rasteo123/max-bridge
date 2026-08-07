import { describe, expect, it } from "vitest";

import { adaptSearchResults } from "./chat-list-adapter.js";
import { MaxCompatibilityError } from "./errors.js";
import { RuntimeMediaAdapter } from "./media-adapter.js";

/** Shaped after a real opcode 60 response, with the payloads trimmed. */
const searchResponse = {
  result: [
    {
      chat: {
        id: -71825987409954,
        type: "CHANNEL",
        title: "Москва Новости",
        baseRawIconUrl: "https://i.oneme.ru/i?r=synthetic",
        link: "https://max.ru/moscwlife_vmax",
        access: "PUBLIC",
        participantsCount: 47_242,
        description: "Новости города",
        messagesCount: 1_760,
        options: { OFFICIAL: true, COMMENTS: false },
        lastMessage: {
          id: 117_054_612_902_337_000,
          time: Date.parse("2026-08-07T09:00:00.000Z"),
          type: "CHANNEL",
          text: "Свежий выпуск"
        }
      },
      highlights: ["Новости"]
    },
    {
      chat: {
        id: -73263249559568,
        type: "CHANNEL",
        title: "Новости без цензуры",
        link: "https://max.ru/svowag",
        participantsCount: 11_858,
        options: { OFFICIAL: false }
      },
      highlights: ["новости"]
    }
  ],
  total: 23_551,
  marker: 40
};

describe("MAX global search adapter", () => {
  it("adapts hits with their description, follower count and badge", () => {
    const chats = adaptSearchResults(searchResponse, {
      media: new RuntimeMediaAdapter()
    });

    expect(chats).toHaveLength(2);
    expect(chats[0]).toMatchObject({
      id: "-71825987409954",
      kind: "channel",
      title: "Москва Новости",
      description: "Новости города",
      membersCount: 47_242,
      verified: true,
      link: "https://max.ru/moscwlife_vmax",
      avatarUrl: "https://i.oneme.ru/i?r=synthetic"
    });
    expect(chats[1]?.verified).toBeUndefined();
    expect(chats[1]?.membersCount).toBe(11_858);
  });

  it("skips a malformed hit rather than losing the whole result", () => {
    const chats = adaptSearchResults({
      result: [{ chat: { title: "Без идентификатора" } }, ...searchResponse.result]
    }, { media: new RuntimeMediaAdapter() });

    expect(chats.map((chat) => chat.title)).toEqual([
      "Москва Новости",
      "Новости без цензуры"
    ]);
  });

  it("rejects a response that carries no results at all", () => {
    expect(() => adaptSearchResults({ total: 0 }, {
      media: new RuntimeMediaAdapter()
    })).toThrow(MaxCompatibilityError);
  });
});
