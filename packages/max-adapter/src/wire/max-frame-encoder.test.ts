import { describe, expect, it } from "vitest";

import { decodeMaxFrame } from "./max-frame-decoder.js";
import {
  encodeMaxFrame,
  MaxFrameEncodeError
} from "./max-frame-encoder.js";

describe("encodeMaxFrame", () => {
  it("round-trips a request through the decoder", () => {
    const frame = encodeMaxFrame({
      command: 0,
      sequence: 40_001,
      opcode: 49,
      payload: {
        chatId: 398_590_508,
        from: 1_785_831_284_521,
        forward: 0,
        backward: 30,
        getMessages: true
      }
    });

    const decoded = decodeMaxFrame(frame);

    expect(decoded.protocolVersion).toBe(10);
    expect(decoded.command).toBe(0);
    expect(decoded.opcode).toBe(49);
    expect(decoded.compressed).toBe(false);
    // Values too large for 32 bits travel as int64 and come back as BigInt.
    expect(decoded.payload).toEqual({
      chatId: 398_590_508,
      from: 1_785_831_284_521n,
      forward: 0,
      backward: 30,
      getMessages: true
    });
  });

  it("writes the header exactly as MAX frames it", () => {
    const frame = encodeMaxFrame({
      command: 0,
      sequence: 0x1234,
      opcode: 180,
      payload: undefined
    });

    expect([...frame]).toEqual([10, 0, 0x12, 0x34, 0, 180, 0, 0, 0, 0]);
  });

  // MAX hangs up cleanly when a timestamp arrives as a float, which is what
  // the msgpack encoder produces for a large plain number under useBigInt64.
  it("encodes a large integer exactly as the equivalent BigInt", () => {
    const asNumber = encodeMaxFrame({
      command: 0,
      sequence: 1,
      opcode: 49,
      payload: { from: 1_786_105_320_141 }
    });
    const asBigInt = encodeMaxFrame({
      command: 0,
      sequence: 1,
      opcode: 49,
      payload: { from: 1_786_105_320_141n }
    });

    expect([...asNumber]).toEqual([...asBigInt]);
  });

  it("widens large integers nested in arrays and objects", () => {
    const payload = {
      chatId: 1,
      messageIds: [117_049_551_597_364_160n],
      nested: { at: 1_786_105_320_141 }
    };
    const widened = {
      chatId: 1,
      messageIds: [117_049_551_597_364_160n],
      nested: { at: 1_786_105_320_141n }
    };

    expect([...encodeMaxFrame({
      command: 0,
      sequence: 1,
      opcode: 66,
      payload
    })]).toEqual([...encodeMaxFrame({
      command: 0,
      sequence: 1,
      opcode: 66,
      payload: widened
    })]);
  });

  it("leaves values that fit in 32 bits compact", () => {
    const frame = encodeMaxFrame({
      command: 0,
      sequence: 1,
      opcode: 49,
      payload: { forward: 0, backward: 30, chatId: 364_348_434 }
    });

    // A widened value would cost eight bytes; these stay in their short forms.
    expect(frame.byteLength).toBe(42);
    expect(decodeMaxFrame(frame).payload).toEqual({
      forward: 0,
      backward: 30,
      chatId: 364_348_434
    });
  });

  it("keeps identifiers beyond the safe integer range intact", () => {
    const frame = encodeMaxFrame({
      command: 0,
      sequence: 1,
      opcode: 49,
      payload: { messageId: 117_008_945_215_202_080n }
    });

    expect(decodeMaxFrame(frame).payload).toEqual({
      messageId: 117_008_945_215_202_080n
    });
  });

  it("refuses an identifier that has already lost precision", () => {
    expect(() => encodeMaxFrame({
      command: 0,
      sequence: 1,
      opcode: 66,
      payload: { messageId: Number.MAX_SAFE_INTEGER + 2 }
    })).toThrow(MaxFrameEncodeError);
  });

  it.each([
    ["command", { command: 256, sequence: 1, opcode: 1 }],
    ["sequence", { command: 0, sequence: 65_536, opcode: 1 }],
    ["opcode", { command: 0, sequence: 1, opcode: 40_000 }]
  ])("rejects an out-of-range %s", (_field, input) => {
    expect(() => encodeMaxFrame(input)).toThrow(MaxFrameEncodeError);
  });
});
