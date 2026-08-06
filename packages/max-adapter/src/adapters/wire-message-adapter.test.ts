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
