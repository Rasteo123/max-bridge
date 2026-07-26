import {
  decode,
  ExtensionCodec
} from "@msgpack/msgpack";

const HEADER_BYTES = 10;
const EXPECTED_PROTOCOL_VERSION = 10;
const DEFAULT_MAX_DECODED_BYTES = 256 * 1024;
const maxExtensionCodec = new ExtensionCodec();

maxExtensionCodec.register({
  type: 1,
  encode(): null {
    return null;
  },
  decode(data): number | bigint {
    const value = decode(data, {
      useBigInt64: true
    });
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "bigint") {
      return value >= Number.MIN_SAFE_INTEGER
        && value <= Number.MAX_SAFE_INTEGER
        ? Number(value)
        : value;
    }
    throw new MaxFrameDecodeError();
  }
});

export type DecodedMaxFrame = Readonly<{
  protocolVersion: number;
  command: number;
  opcode: number;
  compressed: boolean;
  payload: unknown;
}>;

export class MaxFrameDecodeError extends Error {
  readonly code = "invalid_max_frame";

  constructor() {
    super("MAX frame could not be decoded");
    this.name = "MaxFrameDecodeError";
  }
}

export function decodeMaxFrame(
  source: Uint8Array,
  options: Readonly<{ maxDecodedBytes?: number }> = {}
): DecodedMaxFrame {
  try {
    const maxDecodedBytes =
      options.maxDecodedBytes ?? DEFAULT_MAX_DECODED_BYTES;
    if (source.byteLength < HEADER_BYTES) {
      throw new MaxFrameDecodeError();
    }

    const header = new DataView(
      source.buffer,
      source.byteOffset,
      source.byteLength
    );
    const protocolVersion = header.getUint8(0);
    if (protocolVersion !== EXPECTED_PROTOCOL_VERSION) {
      throw new MaxFrameDecodeError();
    }
    const command = header.getUint8(1);
    const opcode = header.getInt16(4);
    const compressionMultiplier = header.getUint8(6);
    const payloadLength = (
      header.getUint8(7) << 16
      | header.getUint8(8) << 8
      | header.getUint8(9)
    );
    if (payloadLength !== source.byteLength - HEADER_BYTES) {
      throw new MaxFrameDecodeError();
    }
    if (payloadLength === 0) {
      return {
        protocolVersion,
        command,
        opcode,
        compressed: false,
        payload: undefined
      };
    }

    const encoded = source.subarray(HEADER_BYTES);
    const packed = compressionMultiplier === 0
      ? requireWithinLimit(encoded, maxDecodedBytes)
      : decompressLz4Block(
        encoded,
        checkedOutputCapacity(
          encoded.byteLength,
          compressionMultiplier,
          maxDecodedBytes
        )
      );
    try {
      const payload = decode(packed, {
        extensionCodec: maxExtensionCodec,
        useBigInt64: true,
        maxStrLength: maxDecodedBytes,
        maxBinLength: maxDecodedBytes,
        maxArrayLength: 65_536,
        maxMapLength: 65_536,
        maxExtLength: maxDecodedBytes
      });
      return {
        protocolVersion,
        command,
        opcode,
        compressed: compressionMultiplier > 0,
        payload
      };
    } finally {
      if (packed !== encoded) {
        packed.fill(0);
      }
    }
  } catch (error: unknown) {
    if (error instanceof MaxFrameDecodeError) {
      throw error;
    }
    throw new MaxFrameDecodeError();
  }
}

function requireWithinLimit(
  payload: Uint8Array,
  maxDecodedBytes: number
): Uint8Array {
  if (payload.byteLength > maxDecodedBytes) {
    throw new MaxFrameDecodeError();
  }
  return payload;
}

function checkedOutputCapacity(
  compressedBytes: number,
  multiplier: number,
  maxDecodedBytes: number
): number {
  const capacity = compressedBytes * multiplier;
  if (
    !Number.isSafeInteger(capacity)
    || capacity <= 0
    || capacity > maxDecodedBytes
  ) {
    throw new MaxFrameDecodeError();
  }
  return capacity;
}

function decompressLz4Block(
  input: Uint8Array,
  outputCapacity: number
): Uint8Array {
  const output = new Uint8Array(outputCapacity);
  let inputOffset = 0;
  let outputOffset = 0;

  while (inputOffset < input.byteLength) {
    const token = requireByte(input, inputOffset);
    inputOffset += 1;

    let literalLength = token >>> 4;
    if (literalLength === 15) {
      const extension = readExtendedLength(input, inputOffset);
      literalLength += extension.length;
      inputOffset = extension.nextOffset;
    }
    requireRange(inputOffset, literalLength, input.byteLength);
    requireRange(outputOffset, literalLength, output.byteLength);
    output.set(
      input.subarray(inputOffset, inputOffset + literalLength),
      outputOffset
    );
    inputOffset += literalLength;
    outputOffset += literalLength;

    if (inputOffset === input.byteLength) {
      return output.subarray(0, outputOffset);
    }
    requireRange(inputOffset, 2, input.byteLength);
    const matchOffset = (
      requireByte(input, inputOffset)
      | requireByte(input, inputOffset + 1) << 8
    );
    inputOffset += 2;
    if (matchOffset <= 0 || matchOffset > outputOffset) {
      throw new MaxFrameDecodeError();
    }

    let matchLength = (token & 0x0f) + 4;
    if ((token & 0x0f) === 15) {
      const extension = readExtendedLength(input, inputOffset);
      matchLength += extension.length;
      inputOffset = extension.nextOffset;
    }
    requireRange(outputOffset, matchLength, output.byteLength);
    for (let index = 0; index < matchLength; index += 1) {
      const sourceIndex = outputOffset - matchOffset;
      output[outputOffset] = requireByte(output, sourceIndex);
      outputOffset += 1;
    }
  }

  return output.subarray(0, outputOffset);
}

function readExtendedLength(
  input: Uint8Array,
  startOffset: number
): Readonly<{ length: number; nextOffset: number }> {
  let length = 0;
  let offset = startOffset;
  while (offset < input.byteLength) {
    const value = requireByte(input, offset);
    offset += 1;
    length += value;
    if (value !== 255) {
      return { length, nextOffset: offset };
    }
  }
  throw new MaxFrameDecodeError();
}

function requireRange(
  offset: number,
  length: number,
  capacity: number
): void {
  if (
    offset < 0
    || length < 0
    || offset > capacity
    || length > capacity - offset
  ) {
    throw new MaxFrameDecodeError();
  }
}

function requireByte(buffer: Uint8Array, index: number): number {
  const value = buffer[index];
  if (value === undefined) {
    throw new MaxFrameDecodeError();
  }
  return value;
}
