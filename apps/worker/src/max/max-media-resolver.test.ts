import type { RuntimeMediaDescriptor } from "@maxbridge/max-adapter";
import type { APIRequestContext } from "playwright";
import { describe, expect, it, vi } from "vitest";

import {
  allowedMediaUrl,
  MaxMediaError,
  MaxMediaResolver
} from "./max-media-resolver.js";
import type { MaxWireClient } from "./max-wire-client.js";

function resolver(options: Readonly<{
  reply?: unknown;
  body?: Buffer;
  contentType?: string;
  ok?: boolean;
}> = {}) {
  const request = vi.fn(() => Promise.resolve(options.reply ?? {}));
  const get = vi.fn(() => Promise.resolve({
    ok: () => options.ok ?? true,
    body: () => Promise.resolve(options.body ?? Buffer.from([1, 2, 3])),
    headers: () => ({
      "content-type": options.contentType ?? "video/mp4"
    })
  }));
  return {
    request,
    get,
    subject: new MaxMediaResolver({
      wire: { request } as unknown as MaxWireClient,
      request: { get } as unknown as APIRequestContext
    })
  };
}

const photo: RuntimeMediaDescriptor = {
  kind: "image",
  baseUrl: "https://i.oneme.ru/i?r=abc&expires=1",
  chatId: "1",
  messageId: "2"
};

const video: RuntimeMediaDescriptor = {
  kind: "video",
  remoteId: "16526485839649",
  token: "token",
  chatId: "1",
  messageId: "2"
};

const file: RuntimeMediaDescriptor = {
  kind: "file",
  remoteId: "4365282060",
  chatId: "1",
  messageId: "2",
  fileName: "check.txt"
};

describe("MaxMediaResolver", () => {
  it("downloads a photo from the link the message already carries", async () => {
    const { subject, get, request } = resolver({
      contentType: "image/jpeg"
    });

    const media = await subject.resolve(photo);

    expect(request).not.toHaveBeenCalled();
    expect(get).toHaveBeenCalledWith(
      "https://i.oneme.ru/i?r=abc&expires=1",
      expect.anything()
    );
    expect(media.mimeType).toBe("image/jpeg");
  });

  it("asks opcode 83 for a video and takes the best rendition", async () => {
    const { subject, request, get } = resolver({
      reply: {
        MP4_144: "https://maxvd660.okcdn.ru/?id=1&q=144",
        MP4_720: "https://maxvd660.okcdn.ru/?id=1&q=720",
        EXTERNAL: "https://m.ok.ru/video/1"
      }
    });

    await subject.resolve(video);

    expect(request).toHaveBeenCalledWith(83, {
      videoId: 16_526_485_839_649,
      token: "token",
      chatId: 1,
      messageId: 2
    }, expect.any(Number));
    expect(get).toHaveBeenCalledWith(
      "https://maxvd660.okcdn.ru/?id=1&q=720",
      expect.anything()
    );
  });

  it("asks opcode 88 for a file and keeps its name", async () => {
    const { subject, request, get } = resolver({
      reply: { url: "https://fd.oneme.ru/getfile?rq=abc", unsafe: false },
      contentType: "text/plain"
    });

    const media = await subject.resolve(file);

    expect(request).toHaveBeenCalledWith(88, {
      fileId: 4_365_282_060,
      chatId: 1,
      messageId: 2,
      itemType: "REGULAR"
    }, expect.any(Number));
    expect(get).toHaveBeenCalledWith(
      "https://fd.oneme.ru/getfile?rq=abc",
      expect.anything()
    );
    expect(media.fileName).toBe("check.txt");
  });

  it("refuses a download link pointing somewhere other than MAX", async () => {
    const { subject } = resolver({
      reply: { url: "https://attacker.example.com/payload" }
    });

    await expect(subject.resolve(file)).rejects.toThrow(MaxMediaError);
  });

  it("reports a refused download rather than passing on the body", async () => {
    const { subject } = resolver({
      reply: { url: "https://fd.oneme.ru/getfile?rq=abc" },
      ok: false
    });

    await expect(subject.resolve(file)).rejects.toThrow(MaxMediaError);
  });

  it("refuses an attachment MAX gave no way to fetch", async () => {
    const { subject } = resolver({ reply: {} });

    await expect(subject.resolve({ kind: "video", chatId: "1" }))
      .rejects.toThrow(MaxMediaError);
  });
});

describe("allowedMediaUrl", () => {
  it.each([
    "https://i.oneme.ru/i?r=abc",
    "https://fd.oneme.ru/getfile?rq=abc",
    "https://maxvd660.okcdn.ru/?id=1",
    "https://st.max.ru/lottie/a.json"
  ])("accepts %s", (value) => {
    expect(allowedMediaUrl(value)).toBe(value);
  });

  it.each([
    "http://i.oneme.ru/i?r=abc",
    "https://oneme.ru.attacker.example/x",
    "https://user:pass@i.oneme.ru/i",
    "https://attacker.example/i",
    "ftp://i.oneme.ru/i",
    42
  ])("refuses %s", (value) => {
    expect(allowedMediaUrl(value)).toBeUndefined();
  });
});
