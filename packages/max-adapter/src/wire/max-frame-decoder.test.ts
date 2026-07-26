import { encode } from "@msgpack/msgpack";
import { describe, expect, it } from "vitest";

import {
  decodeMaxFrame,
  MaxFrameDecodeError
} from "./max-frame-decoder.js";

describe("MAX WebSocket frame decoder", () => {
  it("extracts public protocol metadata and decodes MessagePack payload", () => {
    const frame = makeFrame(
      encode({
        messages: [{ text: "PRIVATE_MESSAGE_CANARY" }]
      }),
      { command: 1, opcode: 128 }
    );

    const decoded = decodeMaxFrame(frame);

    expect(decoded).toMatchObject({
      protocolVersion: 10,
      command: 1,
      opcode: 128,
      compressed: false
    });
    expect(decoded.payload).toEqual({
      messages: [{ text: "PRIVATE_MESSAGE_CANARY" }]
    });
  });

  it("decodes a standard LZ4 literal block under the output cap", () => {
    const packed = encode({ chats: [] });
    expect(packed.byteLength).toBeLessThan(15);
    const compressed = Uint8Array.from([
      packed.byteLength << 4,
      ...packed
    ]);
    const frame = makeFrame(compressed, {
      command: 0,
      opcode: 19,
      compressionMultiplier: 1
    });

    const decoded = decodeMaxFrame(frame);

    expect(decoded.compressed).toBe(true);
    expect(decoded.payload).toEqual({ chats: [] });
  });

  it("rejects malformed lengths and oversized decompression", () => {
    const malformed = makeFrame(Uint8Array.from([0x80]), {
      command: 0,
      opcode: 1
    });
    malformed[9] = 20;

    expect(() => decodeMaxFrame(malformed)).toThrow(MaxFrameDecodeError);

    const oversized = makeFrame(Uint8Array.from([0x00]), {
      command: 0,
      opcode: 1,
      compressionMultiplier: 255
    });
    expect(() => decodeMaxFrame(oversized, {
      maxDecodedBytes: 128
    })).toThrow(MaxFrameDecodeError);
  });

  it("decodes MAX numeric extension type without exposing binary wrappers", () => {
    const extensionPayload = Uint8Array.from([
      0xc7,
      0x01,
      0x01,
      0x7b
    ]);
    const frame = makeFrame(extensionPayload, {
      command: 1,
      opcode: 49
    });

    expect(decodeMaxFrame(frame).payload).toBe(123);
  });
});

function makeFrame(
  payload: Uint8Array,
  metadata: Readonly<{
    command: number;
    opcode: number;
    compressionMultiplier?: number;
  }>
): Buffer {
  const frame = Buffer.alloc(10 + payload.byteLength);
  frame[0] = 10;
  frame[1] = metadata.command;
  frame.writeInt16BE(7, 2);
  frame.writeInt16BE(metadata.opcode, 4);
  frame[6] = metadata.compressionMultiplier ?? 0;
  frame[7] = payload.byteLength >>> 16 & 0xff;
  frame[8] = payload.byteLength >>> 8 & 0xff;
  frame[9] = payload.byteLength & 0xff;
  frame.set(payload, 10);
  return frame;
}
