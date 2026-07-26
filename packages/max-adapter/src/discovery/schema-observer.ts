import type {
  Page,
  Request,
  Response,
  WebSocket
} from "playwright";

import {
  decodeMaxFrame,
  MaxFrameDecodeError
} from "../wire/max-frame-decoder.js";
import { classifyWirePayload, type MaxWireKind } from "../wire/wire-classifier.js";
import {
  byteLengthOfText,
  extractStructuralSchema,
  sanitizeEndpoint,
  type SafeEndpoint,
  type StructuralSchema
} from "./sanitizer.js";

const DEFAULT_MAX_BODY_BYTES = 256 * 1024;

export type HttpRequestObservationInput = Readonly<{
  url: string;
  method: string;
  contentType?: string;
  body?: unknown;
  measuredBytes?: number;
}>;

export type HttpResponseObservationInput =
  HttpRequestObservationInput
  & Readonly<{ status: number }>;

export type WebSocketObservationInput = Readonly<{
  url: string;
  direction: "sent" | "received";
  payload: unknown;
  measuredBytes?: number;
}>;

export type SchemaObservation =
  | Readonly<{
    transport: "http";
    direction: "request";
    endpoint: SafeEndpoint;
    method: string;
    body?: StructuralSchema;
    wireKind?: MaxWireKind;
  }>
  | Readonly<{
    transport: "http";
    direction: "response";
    endpoint: SafeEndpoint;
    method: string;
    status: number;
    body?: StructuralSchema;
    wireKind?: MaxWireKind;
  }>
  | Readonly<{
    transport: "websocket";
    direction: "sent" | "received";
    endpoint: SafeEndpoint;
    body: StructuralSchema;
    wireKind: MaxWireKind;
    frame?: Readonly<{
      protocolVersion: number;
      command: number;
      opcode: number;
      compressed: boolean;
    }>;
  }>;

export type SchemaObservationSink = (
  observation: SchemaObservation
) => void;

export class SchemaObserver {
  readonly maxBodyBytes: number;

  constructor(
    private readonly sink: SchemaObservationSink,
    options: Readonly<{ maxBodyBytes?: number }> = {}
  ) {
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  observeHttpRequest(input: HttpRequestObservationInput): void {
    const parsed = this.parseBody(input);
    this.sink({
      transport: "http",
      direction: "request",
      endpoint: sanitizeEndpoint(input.url),
      method: normalizeMethod(input.method),
      ...(parsed === undefined ? {} : {
        body: parsed.schema,
        wireKind: classifyWirePayload(parsed.value)
      })
    });
  }

  observeHttpResponse(input: HttpResponseObservationInput): void {
    const parsed = this.parseBody(input);
    this.sink({
      transport: "http",
      direction: "response",
      endpoint: sanitizeEndpoint(input.url),
      method: normalizeMethod(input.method),
      status: input.status,
      ...(parsed === undefined ? {} : {
        body: parsed.schema,
        wireKind: classifyWirePayload(parsed.value)
      })
    });
  }

  observeWebSocketFrame(input: WebSocketObservationInput): void {
    const parsed = parseUnknownPayload(
      input.payload,
      input.measuredBytes,
      this.maxBodyBytes
    );
    this.sink({
      transport: "websocket",
      direction: input.direction,
      endpoint: sanitizeEndpoint(input.url),
      body: parsed.schema,
      wireKind: classifyWirePayload(
        parsed.value,
        parsed.frame === undefined ? undefined : {
          command: parsed.frame.command,
          opcode: parsed.frame.opcode
        }
      ),
      ...(parsed.frame === undefined ? {} : { frame: parsed.frame })
    });
  }

  private parseBody(
    input: HttpRequestObservationInput
  ): Readonly<{
    value: unknown;
    schema: StructuralSchema;
  }> | undefined {
    if (
      input.body === undefined
      && input.measuredBytes === undefined
    ) {
      return undefined;
    }
    if (
      input.contentType !== undefined
      && !isJsonContentType(input.contentType)
    ) {
      return {
        value: undefined,
        schema: input.measuredBytes !== undefined
          && input.measuredBytes > this.maxBodyBytes
          ? { type: "truncated", reason: "size_limit" }
          : { type: "binary" }
      };
    }
    return parseUnknownPayload(
      input.body,
      input.measuredBytes,
      this.maxBodyBytes
    );
  }
}

export type SchemaObserverAttachment = Readonly<{
  flush(): Promise<void>;
  stop(): Promise<void>;
}>;

export function attachSchemaObserver(
  page: Page,
  observer: SchemaObserver
): SchemaObserverAttachment {
  const pending = new Set<Promise<void>>();
  const socketListeners = new Map<WebSocket, Readonly<{
    sent: (event: Readonly<{ payload: string | Buffer }>) => void;
    received: (event: Readonly<{ payload: string | Buffer }>) => void;
  }>>();

  const onRequest = (request: Request): void => {
    const body = request.postDataBuffer() ?? undefined;
    try {
      observer.observeHttpRequest({
        url: request.url(),
        method: request.method(),
        ...(request.headers()["content-type"] === undefined ? {} : {
          contentType: request.headers()["content-type"]
        }),
        ...(body === undefined ? {} : {
          body,
          measuredBytes: body.byteLength
        })
      });
    } finally {
      body?.fill(0);
    }
  };

  const onResponse = (response: Response): void => {
    trackPending(pending, inspectResponse(response, observer));
  };

  const onWebSocket = (socket: WebSocket): void => {
    const sent = (event: Readonly<{ payload: string | Buffer }>): void => {
      observeSocketPayload(observer, socket.url(), "sent", event.payload);
    };
    const received = (
      event: Readonly<{ payload: string | Buffer }>
    ): void => {
      observeSocketPayload(
        observer,
        socket.url(),
        "received",
        event.payload
      );
    };
    socket.on("framesent", sent);
    socket.on("framereceived", received);
    socketListeners.set(socket, { sent, received });
  };

  page.on("request", onRequest);
  page.on("response", onResponse);
  page.on("websocket", onWebSocket);

  const flush = async (): Promise<void> => {
    await Promise.allSettled([...pending]);
  };
  const stop = async (): Promise<void> => {
    page.off("request", onRequest);
    page.off("response", onResponse);
    page.off("websocket", onWebSocket);
    for (const [socket, listeners] of socketListeners) {
      socket.off("framesent", listeners.sent);
      socket.off("framereceived", listeners.received);
    }
    socketListeners.clear();
    await flush();
  };
  return { flush, stop };
}

export {
  extractStructuralSchema,
  sanitizeEndpoint
} from "./sanitizer.js";

async function inspectResponse(
  response: Response,
  observer: SchemaObserver
): Promise<void> {
  const headers = response.headers();
  const contentType = headers["content-type"];
  const rawLength = headers["content-length"];
  const measuredBytes = parseContentLength(rawLength);
  const request = response.request();

  if (
    contentType === undefined
    || !isJsonContentType(contentType)
    || measuredBytes === undefined
    || measuredBytes > observer.maxBodyBytes
  ) {
    observer.observeHttpResponse({
      url: response.url(),
      method: request.method(),
      status: response.status(),
      ...(contentType === undefined ? {} : { contentType }),
      ...(measuredBytes === undefined ? {} : { measuredBytes })
    });
    return;
  }

  let body: Buffer | undefined;
  try {
    body = await response.body();
    observer.observeHttpResponse({
      url: response.url(),
      method: request.method(),
      status: response.status(),
      contentType,
      body,
      measuredBytes: body.byteLength
    });
  } catch {
    observer.observeHttpResponse({
      url: response.url(),
      method: request.method(),
      status: response.status(),
      contentType
    });
  } finally {
    body?.fill(0);
  }
}

function observeSocketPayload(
  observer: SchemaObserver,
  url: string,
  direction: "sent" | "received",
  payload: string | Buffer
): void {
  const measuredBytes = typeof payload === "string"
    ? byteLengthOfText(payload)
    : payload.byteLength;
  observer.observeWebSocketFrame({
    url,
    direction,
    payload,
    measuredBytes
  });
}

function parseUnknownPayload(
  payload: unknown,
  measuredBytes: number | undefined,
  maxBytes: number
): Readonly<{
  value: unknown;
  schema: StructuralSchema;
  frame?: Readonly<{
    protocolVersion: number;
    command: number;
    opcode: number;
    compressed: boolean;
  }>;
}> {
  if (measuredBytes !== undefined && measuredBytes > maxBytes) {
    return {
      value: undefined,
      schema: { type: "truncated", reason: "size_limit" }
    };
  }
  if (typeof payload === "string") {
    return parseTextPayload(payload, measuredBytes, maxBytes);
  }
  if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) {
    const copy = Buffer.from(payload);
    try {
      try {
        const decoded = decodeMaxFrame(copy, {
          maxDecodedBytes: maxBytes
        });
        return {
          value: decoded.payload,
          schema: extractStructuralSchema(decoded.payload, {
            maxBytes,
            measuredBytes: copy.byteLength
          }),
          frame: {
            protocolVersion: decoded.protocolVersion,
            command: decoded.command,
            opcode: decoded.opcode,
            compressed: decoded.compressed
          }
        };
      } catch (error: unknown) {
        if (!(error instanceof MaxFrameDecodeError)) {
          throw error;
        }
      }
      return parseTextPayload(
        copy.toString("utf8"),
        measuredBytes ?? copy.byteLength,
        maxBytes
      );
    } finally {
      copy.fill(0);
    }
  }
  return {
    value: payload,
    schema: extractStructuralSchema(payload, {
      maxBytes,
      ...(measuredBytes === undefined ? {} : { measuredBytes })
    })
  };
}

function parseTextPayload(
  text: string,
  measuredBytes: number | undefined,
  maxBytes: number
): Readonly<{
  value: unknown;
  schema: StructuralSchema;
}> {
  const actualBytes = measuredBytes ?? byteLengthOfText(text);
  if (actualBytes > maxBytes) {
    return {
      value: undefined,
      schema: { type: "truncated", reason: "size_limit" }
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    value = text;
  }
  return {
    value,
    schema: extractStructuralSchema(value, {
      maxBytes,
      measuredBytes: actualBytes
    })
  };
}

function normalizeMethod(method: string): string {
  return /^[A-Za-z]{1,12}$/u.test(method)
    ? method.toUpperCase()
    : "UNKNOWN";
}

function isJsonContentType(contentType: string): boolean {
  return /(?:^|[/+])json(?:;|$)/iu.test(contentType);
}

function parseContentLength(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d{1,9}$/u.test(value)) {
    return undefined;
  }
  return Number(value);
}

function trackPending(
  pending: Set<Promise<void>>,
  operation: Promise<void>
): void {
  pending.add(operation);
  void operation.finally(() => {
    pending.delete(operation);
  });
}
