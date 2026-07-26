export const WORKER_OPERATIONS = [
  "health.check",
  "session.open",
  "session.background",
  "session.close",
  "login.phone",
  "login.code",
  "login.qr",
  "login.captcha.frame",
  "login.captcha.pointer",
  "login.status",
  "chats.list",
  "messages.history",
  "message.send",
  "message.sendAttachment"
] as const;

export type WorkerOperation = typeof WORKER_OPERATIONS[number];

export type WorkerRequest = Readonly<{
  kind: "request";
  requestId: string;
  operation: WorkerOperation;
  sessionHandle: string;
  payload?: unknown;
}>;

export type WorkerResponse =
  | Readonly<{
      kind: "response";
      requestId: string;
      ok: true;
      payload?: unknown;
    }>
  | Readonly<{
      kind: "response";
      requestId: string;
      ok: false;
      errorCode: WorkerErrorCode;
    }>;

export type WorkerEvent = Readonly<{
  kind: "event";
  event: "session.event" | "session.crashed";
  sessionHandle: string;
  payload?: unknown;
}>;

export type WorkerMessage = WorkerRequest | WorkerResponse | WorkerEvent;

export type WorkerErrorCode =
  | "invalid_request"
  | "session_not_found"
  | "operation_timeout"
  | "worker_failure";

const errorCodes = new Set<WorkerErrorCode>([
  "invalid_request",
  "session_not_found",
  "operation_timeout",
  "worker_failure"
]);

export class ProtocolMessageError extends Error {
  readonly code = "protocol_message_invalid";

  constructor() {
    super("Protocol message is invalid");
    this.name = "ProtocolMessageError";
  }
}

export function parseWorkerMessage(value: unknown): WorkerMessage {
  const record = asRecord(value);
  if (record["kind"] === "request") {
    assertExactKeys(record, [
      "kind",
      "requestId",
      "operation",
      "sessionHandle",
      "payload"
    ]);
    const requestId = parseRequestId(record["requestId"]);
    const sessionHandle = parseSessionHandle(record["sessionHandle"]);
    const operation = parseOperation(record["operation"]);
    return {
      kind: "request",
      requestId,
      operation,
      sessionHandle,
      ...("payload" in record ? { payload: record["payload"] } : {})
    };
  }
  if (record["kind"] === "response") {
    const requestId = parseRequestId(record["requestId"]);
    if (record["ok"] === true) {
      assertExactKeys(record, ["kind", "requestId", "ok", "payload"]);
      return {
        kind: "response",
        requestId,
        ok: true,
        ...("payload" in record ? { payload: record["payload"] } : {})
      };
    }
    if (record["ok"] === false) {
      assertExactKeys(record, ["kind", "requestId", "ok", "errorCode"]);
      if (
        typeof record["errorCode"] !== "string"
        || !errorCodes.has(record["errorCode"] as WorkerErrorCode)
      ) {
        throw new ProtocolMessageError();
      }
      return {
        kind: "response",
        requestId,
        ok: false,
        errorCode: record["errorCode"] as WorkerErrorCode
      };
    }
    throw new ProtocolMessageError();
  }
  if (record["kind"] === "event") {
    assertExactKeys(record, [
      "kind",
      "event",
      "sessionHandle",
      "payload"
    ]);
    if (
      record["event"] !== "session.event"
      && record["event"] !== "session.crashed"
    ) {
      throw new ProtocolMessageError();
    }
    return {
      kind: "event",
      event: record["event"],
      sessionHandle: parseSessionHandle(record["sessionHandle"]),
      ...("payload" in record ? { payload: record["payload"] } : {})
    };
  }
  throw new ProtocolMessageError();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object"
    || value === null
    || Array.isArray(value)
  ) {
    throw new ProtocolMessageError();
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Readonly<Record<string, unknown>>,
  allowed: readonly string[]
): void {
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new ProtocolMessageError();
  }
}

function parseRequestId(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^r_[A-Za-z0-9_-]{22,64}$/u.test(value)
  ) {
    throw new ProtocolMessageError();
  }
  return value;
}

function parseSessionHandle(value: unknown): string {
  if (
    typeof value !== "string"
    || !/^s_[A-Za-z0-9_-]{22,64}$/u.test(value)
  ) {
    throw new ProtocolMessageError();
  }
  return value;
}

function parseOperation(value: unknown): WorkerOperation {
  const operation = WORKER_OPERATIONS.find(
    (candidate) => candidate === value
  );
  if (operation === undefined) {
    throw new ProtocolMessageError();
  }
  return operation;
}
