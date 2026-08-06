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
    expect(decoded.payload).toEqual({
      chatId: 398_590_508,
      from: 1_785_831_284_521,
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

  it.each([
    ["command", { command: 256, sequence: 1, opcode: 1 }],
    ["sequence", { command: 0, sequence: 65_536, opcode: 1 }],
    ["opcode", { command: 0, sequence: 1, opcode: 40_000 }]
  ])("rejects an out-of-range %s", (_field, input) => {
    expect(() => encodeMaxFrame(input)).toThrow(MaxFrameEncodeError);
  });
});
