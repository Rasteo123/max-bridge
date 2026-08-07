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

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const MAX_ENCODE_DEPTH = 16;

/**
 * MAX rejects a frame — and hangs up cleanly — when a timestamp or identifier
 * arrives as a float. With `useBigInt64` the msgpack encoder writes any
 * integer too large for 32 bits as a double, so those are widened to BigInt
 * first and encoded as int64, the way the MAX client itself sends them.
 */
function asWireIntegers(value: unknown, depth = 0): unknown {
  if (depth > MAX_ENCODE_DEPTH) {
    throw new MaxFrameEncodeError();
  }
  if (typeof value === "number" && Number.isInteger(value)) {
    if (!Number.isSafeInteger(value)) {
      // Such a value has already lost precision; encoding it would put a
      // silently wrong identifier on the wire. Callers pass a BigInt instead.
      throw new MaxFrameEncodeError();
    }
    if (value < INT32_MIN || value > INT32_MAX) {
      return BigInt(value);
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => asWireIntegers(item, depth + 1));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) =>
        [key, asWireIntegers(item, depth + 1)]
      )
    );
  }
  return value;
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
      : encode(asWireIntegers(input.payload), { useBigInt64: true });
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
