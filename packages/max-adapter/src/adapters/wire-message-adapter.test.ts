import { describe, expect, it } from "vitest";

import { RuntimeMediaAdapter } from "./media-adapter.js";
import { adaptWireHistory } from "./wire-message-adapter.js";

const VIEWER_ID = "364890185";

function context(readMarks?: readonly number[]) {
  return {
    chatId: "398590508",
    viewerId: VIEWER_ID,
    media: new RuntimeMediaAdapter(),
    ...(readMarks === undefined ? {} : { readMarks })
  };
}

describe("adaptWireHistory", () => {
  it("keeps the text of a plain message", () => {
    const [message] = adaptWireHistory({
      messages: [{
        id: 117_036_186_715_192_910n,
        time: 1_785_830_485_766,
        type: "USER",
        sender: 41_798_245,
        text: "Слава, привет, мы в аэропорту",
        attaches: [],
        reactionInfo: {}
      }]
    }, context());

    expect(message).toMatchObject({
      id: "117036186715192910",
      chatId: "398590508",
      senderId: "41798245",
      direction: "incoming",
      kind: "text",
      text: "Слава, привет, мы в аэропорту",
      sentAt: "2026-08-04T08:01:25.766Z"
    });
  });

  it("adapts photo, video and file attachments as media", () => {
    const messages = adaptWireHistory({
      messages: [
        {
          id: 1n,
          time: 1_785_167_472_726,
          sender: 364_890_185,
          text: "",
          attaches: [{
            _type: "PHOTO",
            photoId: 30_856_840_265,
            photoToken: "token",
            baseUrl: "https://i.oneme.ru/i?r=abc&expires=1786135963504",
            width: 1920,
            height: 1256
          }]
        },
        {
          id: 2n,
          time: 1_785_167_472_727,
          sender: 364_890_185,
          text: "",
          attaches: [{
            _type: "VIDEO",
            videoId: 16_526_485_839_649,
            token: "token",
            duration: 1000,
            width: 256,
            height: 144
          }]
        },
        {
          id: 3n,
          time: 1_785_167_472_728,
          sender: 364_890_185,
          text: "",
          attaches: [{
            _type: "FILE",
            fileId: 4_365_282_060,
            token: "token",
            name: "check.txt",
            size: 35
          }]
        }
      ]
    }, context());

    expect(messages.map((message) => message.kind))
      .toEqual(["image", "video", "file"]);
    expect(messages[0]).toMatchObject({
      media: {
        sourceUrl: "https://i.oneme.ru/i?r=abc&expires=1786135963504",
        width: 1920,
        height: 1256
      }
    });
    expect(messages[2]).toMatchObject({
      media: { fileName: "check.txt", size: 35 }
    });
  });

  it("renders calls as readable system messages", () => {
    const [missed, outgoing] = adaptWireHistory({
      messages: [
        {
          id: 1n,
          time: 1_785_414_813_464,
          sender: 41_798_245,
          text: "",
          attaches: [{
            _type: "CALL",
            callType: "AUDIO",
            hangupType: "CANCELED",
            duration: 0
          }]
        },
        {
          id: 2n,
          time: 1_785_659_130_872,
          sender: 364_890_185,
          text: "",
          attaches: [{
            _type: "CALL",
            callType: "AUDIO",
            hangupType: "HUNGUP",
            duration: 157_049
          }]
        }
      ]
    }, context());

    expect(missed).toMatchObject({
      kind: "system",
      text: "Пропущенный вызов"
    });
    expect(outgoing).toMatchObject({
      kind: "system",
      text: "Исходящий вызов, 2:37"
    });
  });

  it("reads reactions out of reactionInfo", () => {
    const [message] = adaptWireHistory({
      messages: [{
        id: 116_988_263_711_506_450n,
        time: 1_785_100_000_000,
        sender: 364_890_185,
        text: "Привет",
        attaches: [],
        reactionInfo: {
          counters: [
            { reaction: "👍", count: 1 },
            { reaction: "🔥", count: 3 }
          ],
          yourReaction: "👍",
          totalCount: 4
        }
      }]
    }, context());

    expect(message?.reactions).toEqual([
      { emoji: "👍", count: 1, selectedByMe: true },
      { emoji: "🔥", count: 3, selectedByMe: false }
    ]);
  });

  it.each([
    ["read", [1_785_830_500_000], "read"],
    ["unread", [1_785_830_400_000], "delivered"],
    ["unknown", undefined, "sent"]
  ] as const)(
    "derives an outgoing %s tick from participant read markers",
    (_case, readMarks, expected) => {
      const [message] = adaptWireHistory({
        messages: [{
          id: 1n,
          time: 1_785_830_485_766,
          sender: 364_890_185,
          text: "Хорошо",
          attaches: []
        }]
      }, context(readMarks));

      expect(message?.status).toBe(expected);
    }
  );

  it("marks incoming messages as read regardless of markers", () => {
    const [message] = adaptWireHistory({
      messages: [{
        id: 1n,
        time: 1_785_830_485_766,
        sender: 41_798_245,
        text: "Привет",
        attaches: []
      }]
    }, context([1]));

    expect(message?.status).toBe("read");
  });

  it("skips a single unreadable message instead of losing the page", () => {
    const messages = adaptWireHistory({
      messages: [
        { time: 1, sender: 1, text: "без идентификатора" },
        {
          id: 7n,
          time: 1_785_830_485_766,
          sender: 41_798_245,
          text: "Второе",
          attaches: []
        }
      ]
    }, context());

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: "7", text: "Второе" });
  });

  // A forward carries nothing itself: text, attachments and formatting all
  // sit on the message inside `link`.
  it("takes a forwarded message's media from the message it wraps", () => {
    const [message] = adaptWireHistory({
      messages: [{
        id: 116_989_553_358_434_100n,
        time: 1_785_118_917_212,
        type: "USER",
        sender: 117_225_878,
        text: "",
        attaches: [],
        link: {
          type: "FORWARD",
          chatId: -69_708_440_354_940,
          chatName: "ВСЕ ОТКРЫТКИ ТУТ",
          chatAccessType: "PUBLIC",
          message: {
            id: 116_988_956_404_178_460n,
            time: 1_785_109_808_413,
            type: "CHANNEL",
            text: "Доброе утро",
            attaches: [{
              _type: "PHOTO",
              photoId: 33_080_124_831,
              baseUrl: "https://i.oneme.ru/i?r=abc",
              width: 720,
              height: 1260
            }]
          }
        }
      }]
    }, context());

    expect(message).toMatchObject({
      kind: "image",
      text: "Доброе утро",
      forwardedFrom: "ВСЕ ОТКРЫТКИ ТУТ",
      forwardedSource: {
        title: "ВСЕ ОТКРЫТКИ ТУТ",
        chatId: "-69708440354940",
        kind: "channel"
      },
      media: { sourceUrl: "https://i.oneme.ru/i?r=abc" }
    });
  });

  it("keeps a forwarded video playable", () => {
    const [message] = adaptWireHistory({
      messages: [{
        id: 1n,
        time: 1_785_076_033_635,
        sender: 117_225_878,
        text: "",
        attaches: [],
        link: {
          type: "FORWARD",
          chatId: -69_392_746_121_913,
          chatName: "Чудесные открытки",
          chatAccessType: "PRIVATE",
          message: {
            id: 2n,
            time: 1_784_981_460_950,
            text: "",
            attaches: [{
              _type: "VIDEO",
              videoId: 16_437_086_084_992,
              token: "token",
              duration: 20_000,
              width: 480,
              height: 852
            }]
          }
        }
      }]
    }, context());

    expect(message).toMatchObject({
      kind: "video",
      forwardedSource: { chatId: "-69392746121913", kind: "channel" }
    });
  });

  it("turns MAX link elements into usable text links", () => {
    const [message] = adaptWireHistory({
      messages: [{
        id: 1n,
        time: 1_785_118_917_212,
        sender: 117_225_878,
        text: "",
        attaches: [],
        link: {
          type: "FORWARD",
          chatId: -1,
          chatName: "Канал",
          chatAccessType: "PUBLIC",
          message: {
            id: 2n,
            time: 1_785_109_808_413,
            text: "Открытки тут и там",
            attaches: [],
            elements: [
              {
                type: "LINK",
                from: 0,
                length: 8,
                attributes: { url: "https://max.ru/vseotkritkityt" }
              },
              { type: "UNDERLINE", from: 0, length: 8 },
              {
                type: "LINK",
                from: 9,
                length: 3,
                attributes: { url: "javascript:alert(1)" }
              }
            ]
          }
        }
      }]
    }, context());

    // The underline carries nothing actionable and the script URL is refused.
    expect(message?.textLinks).toEqual([
      { offset: 0, length: 8, url: "https://max.ru/vseotkritkityt" }
    ]);
  });

  it("labels an attachment MAX has not taught the bridge about", () => {
    const [message] = adaptWireHistory({
      messages: [{
        id: 1n,
        time: 1_785_830_485_766,
        sender: 41_798_245,
        text: "",
        attaches: [{ _type: "LOCATION", latitude: 1, longitude: 2 }]
      }]
    }, context());

    expect(message).toMatchObject({
      kind: "unsupported",
      attachmentType: "LOCATION",
      text: "Неподдерживаемое вложение: LOCATION"
    });
  });
});

describe("channel posts", () => {
  /** Shaped after a real opcode 49 response for a channel. */
  const post = {
    id: 117_053_845_744_263_970n,
    time: 1_786_100_000_000,
    type: "CHANNEL",
    text: "В аэропорту Кольцово введены ограничения",
    attaches: [],
    stats: { views: 6_005 },
    options: 1,
    reactionInfo: {
      counters: [
        { reaction: "👍", count: 22 },
        { reaction: "😭", count: 6 }
      ],
      totalCount: 28
    }
  };

  it("reads the view count and the reactions off the post", () => {
    const [message] = adaptWireHistory({ messages: [post] }, context());

    expect(message?.views).toBe(6_005);
    expect(message?.reactions).toEqual([
      { emoji: "👍", count: 22, selectedByMe: false },
      { emoji: "😭", count: 6, selectedByMe: false }
    ]);
  });

  it("takes the comment count from the separate opcode 91 lookup", () => {
    const [message] = adaptWireHistory({ messages: [post] }, {
      ...context(),
      commentCounts: new Map([["117053845744263970", 10]])
    });

    expect(message?.commentCount).toBe(10);
  });

  it("leaves the comment count out for a post nobody commented on", () => {
    const [message] = adaptWireHistory({ messages: [post] }, {
      ...context(),
      commentCounts: new Map([["999", 3]])
    });

    expect(message?.commentCount).toBeUndefined();
    expect(message?.views).toBe(6_005);
  });
});
