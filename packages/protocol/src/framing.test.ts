import { describe, expect, it } from "vitest";

import {
  FrameDecoder,
  ProtocolFrameError,
  encodeFrame
} from "./framing.js";
import {
  ProtocolMessageError,
  parseWorkerMessage
} from "./commands.js";

const request = {
  kind: "request",
  requestId: "r_AbCdEfGhIjKlMnOpQrStUv",
  operation: "health.check",
  sessionHandle: "s_AbCdEfGhIjKlMnOpQrStUv"
} as const;

describe("length-delimited framing", () => {
  it("decodes a frame split across arbitrary chunks", () => {
    const frame = encodeFrame(request);
    const decoder = new FrameDecoder();

    expect(decoder.push(frame.subarray(0, 2))).toEqual([]);
    expect(decoder.push(frame.subarray(2, 9))).toEqual([]);
    expect(decoder.push(frame.subarray(9))).toEqual([request]);
  });

  it("decodes coalesced frames", () => {
    const decoder = new FrameDecoder();
    const combined = Buffer.concat([
      encodeFrame(request),
      encodeFrame({ ...request, requestId: "r_ZyXwVuTsRqPoNmLkJiHgFe" })
    ]);

    expect(decoder.push(combined)).toEqual([
      request,
      { ...request, requestId: "r_ZyXwVuTsRqPoNmLkJiHgFe" }
    ]);
  });

  it("rejects an oversized outgoing frame", () => {
    expect(() => encodeFrame({
      ...request,
      payload: "x".repeat(1024)
    }, 128)).toThrow(ProtocolFrameError);
  });

  it("rejects an oversized declared incoming frame", () => {
    const decoder = new FrameDecoder(128);
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(129);

    expect(() => decoder.push(prefix)).toThrow(ProtocolFrameError);
  });

  it("rejects malformed JSON without echoing its content", () => {
    const decoder = new FrameDecoder();
    const canary = "CANARY_PRIVATE_MESSAGE";
    const body = Buffer.from(`{"broken":"${canary}"`, "utf8");
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(body.byteLength);

    try {
      decoder.push(Buffer.concat([prefix, body]));
      throw new Error("expected decoder failure");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ProtocolFrameError);
      expect((error as Error).message).not.toContain(canary);
    }
  });
});

describe("worker protocol validation", () => {
  it("accepts an opaque-session request", () => {
    expect(parseWorkerMessage(request)).toEqual(request);
  });

  it("accepts bounded MAX login operations without identity fields", () => {
    expect(parseWorkerMessage({
      ...request,
      operation: "login.code",
      payload: { code: "123456" }
    })).toEqual({
      ...request,
      operation: "login.code",
      payload: { code: "123456" }
    });
  });

  it.each([
    "message.edit",
    "message.delete",
    "message.reaction.set",
    "chat.action",
    "stickers.list",
    "sticker.send"
  ] as const)("accepts the %s operation", (operation) => {
    expect(parseWorkerMessage({
      ...request,
      operation,
      payload: {}
    })).toEqual({
      ...request,
      operation,
      payload: {}
    });
  });

  it("accepts only a bounded identity-free forward payload", () => {
    const message = {
      ...request,
      operation: "message.forward" as const,
      payload: {
        sourceChatId: "chat-1",
        sourceMessageId: "message-1",
        destinationIds: ["chat-2", "channel-3"],
        clientRequestId: "forward-1"
      }
    };

    expect(parseWorkerMessage(message)).toEqual(message);
    expect(() => parseWorkerMessage({
      ...message,
      payload: {
        ...message.payload,
        telegramId: "765023410"
      }
    })).toThrow(ProtocolMessageError);
    expect(() => parseWorkerMessage({
      ...message,
      payload: {
        ...message.payload,
        destinationIds: Array.from(
          { length: 11 },
          (_, index) => `chat-${String(index)}`
        )
      }
    })).toThrow(ProtocolMessageError);
  });

  it("rejects client identity fields", () => {
    expect(() => parseWorkerMessage({
      ...request,
      telegramId: "123456789"
    })).toThrow(ProtocolMessageError);
  });

  it("rejects free-form error text", () => {
    expect(() => parseWorkerMessage({
      kind: "response",
      requestId: request.requestId,
      ok: false,
      errorCode: "worker_failure",
      message: "CANARY_PRIVATE_MESSAGE"
    })).toThrow(ProtocolMessageError);
  });
});
