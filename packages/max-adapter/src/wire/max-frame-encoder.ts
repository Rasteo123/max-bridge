import { encode } from "@msgpack/msgpack";

const HEADER_BYTES = 10;
const PROTOCOL_VERSION = 10;
const MAX_PAYLOAD_BYTES = 0xff_ff_ff;
const MAX_SEQUENCE = 0xff_ff;

export type MaxFrameInput = Readonly<{
  command: number;
  sequence: number;
  opcode: number;
  payload?: unknown;
}>;

export class MaxFrameEncodeError extends Error {
  readonly code = "invalid_max_frame_input";

  constructor() {
    super("MAX frame could not be encoded");
    this.name = "MaxFrameEncodeError";
  }
}

export function encodeMaxFrame(input: MaxFrameInput): Uint8Array {
  if (
    !Number.isInteger(input.command)
    || input.command < 0
    || input.command > 0xff
    || !Number.isInteger(input.sequence)
    || input.sequence < 0
    || input.sequence > MAX_SEQUENCE
    || !Number.isInteger(input.opcode)
    || input.opcode < -32_768
    || input.opcode > 32_767
  ) {
    throw new MaxFrameEncodeError();
  }

  let body: Uint8Array;
  try {
    body = input.payload === undefined
      ? new Uint8Array(0)
      : encode(input.payload, { useBigInt64: true });
  } catch {
    throw new MaxFrameEncodeError();
  }
  if (body.byteLength > MAX_PAYLOAD_BYTES) {
    throw new MaxFrameEncodeError();
  }

  const frame = new Uint8Array(HEADER_BYTES + body.byteLength);
  const header = new DataView(frame.buffer, 0, HEADER_BYTES);
  header.setUint8(0, PROTOCOL_VERSION);
  header.setUint8(1, input.command);
  header.setUint16(2, input.sequence);
  header.setInt16(4, input.opcode);
  // The MAX client only compresses large frames; requests stay uncompressed.
  header.setUint8(6, 0);
  header.setUint8(7, (body.byteLength >>> 16) & 0xff);
  header.setUint8(8, (body.byteLength >>> 8) & 0xff);
  header.setUint8(9, body.byteLength & 0xff);
  frame.set(body, HEADER_BYTES);
  return frame;
}
