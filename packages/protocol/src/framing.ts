const DEFAULT_MAX_FRAME_BYTES = 1024 * 1024;
const LENGTH_PREFIX_BYTES = 4;

export class ProtocolFrameError extends Error {
  readonly code = "protocol_frame_invalid";

  constructor() {
    super("Protocol frame is invalid");
    this.name = "ProtocolFrameError";
  }
}

export function encodeFrame(
  value: unknown,
  maxFrameBytes = DEFAULT_MAX_FRAME_BYTES
): Buffer {
  let body: Buffer;
  try {
    body = Buffer.from(JSON.stringify(value), "utf8");
  } catch {
    throw new ProtocolFrameError();
  }
  if (body.byteLength === 0 || body.byteLength > maxFrameBytes) {
    throw new ProtocolFrameError();
  }
  const prefix = Buffer.allocUnsafe(LENGTH_PREFIX_BYTES);
  prefix.writeUInt32BE(body.byteLength);
  return Buffer.concat([prefix, body]);
}

export class FrameDecoder {
  private buffered = Buffer.alloc(0);

  constructor(
    private readonly maxFrameBytes = DEFAULT_MAX_FRAME_BYTES
  ) {}

  push(chunk: Uint8Array): unknown[] {
    this.buffered = Buffer.concat([this.buffered, Buffer.from(chunk)]);
    const values: unknown[] = [];
    try {
      while (this.buffered.byteLength >= LENGTH_PREFIX_BYTES) {
        const bodyLength = this.buffered.readUInt32BE(0);
        if (bodyLength === 0 || bodyLength > this.maxFrameBytes) {
          throw new ProtocolFrameError();
        }
        const frameLength = LENGTH_PREFIX_BYTES + bodyLength;
        if (this.buffered.byteLength < frameLength) {
          break;
        }
        const body = this.buffered.subarray(LENGTH_PREFIX_BYTES, frameLength);
        this.buffered = this.buffered.subarray(frameLength);
        try {
          values.push(JSON.parse(body.toString("utf8")) as unknown);
        } catch {
          throw new ProtocolFrameError();
        }
      }
      return values;
    } catch (error: unknown) {
      this.buffered = Buffer.alloc(0);
      if (error instanceof ProtocolFrameError) {
        throw error;
      }
      throw new ProtocolFrameError();
    }
  }
}
