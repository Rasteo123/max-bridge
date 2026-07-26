export type MaxWireKind =
  | "chat_list"
  | "history"
  | "live_event"
  | "send_ack"
  | "authentication"
  | "unknown";

export type MaxWireClassificationContext = Readonly<{
  command: number;
  opcode: number;
}>;

export function classifyWirePayload(
  payload: unknown,
  context?: MaxWireClassificationContext
): MaxWireKind {
  const framedKind = classifyFrameMetadata(context);
  if (framedKind !== "unknown") {
    return framedKind;
  }
  const keys = collectKeys(payload);

  if (
    keys.has("event")
    && (keys.has("message") || keys.has("notification"))
  ) {
    return "live_event";
  }
  if (
    (keys.has("messages") || keys.has("history"))
    && (
      keys.has("cursor")
      || keys.has("nextcursor")
      || keys.has("hasmore")
      || keys.has("page")
    )
  ) {
    return "history";
  }
  if (
    keys.has("chats")
    || keys.has("dialogs")
    || keys.has("conversations")
  ) {
    return "chat_list";
  }
  if (
    (
      keys.has("operationid")
      || keys.has("requestid")
      || keys.has("clientid")
    )
    && (
      keys.has("ack")
      || keys.has("success")
      || keys.has("status")
    )
  ) {
    return "send_ack";
  }
  if (
    (
      keys.has("auth")
      || keys.has("login")
      || keys.has("session")
    )
    && (
      keys.has("phone")
      || keys.has("code")
      || keys.has("qr")
      || keys.has("token")
    )
  ) {
    return "authentication";
  }
  return "unknown";
}

function classifyFrameMetadata(
  context: MaxWireClassificationContext | undefined
): MaxWireKind {
  if (context === undefined) {
    return "unknown";
  }
  if (context.opcode === 19) {
    return "chat_list";
  }
  if (context.opcode === 49) {
    return "history";
  }
  if (context.opcode === 128 && context.command === 0) {
    return "live_event";
  }
  if (context.opcode === 64 && context.command === 1) {
    return "send_ack";
  }
  if ([17, 18, 23, 288, 289].includes(context.opcode)) {
    return "authentication";
  }
  return "unknown";
}

function collectKeys(value: unknown): ReadonlySet<string> {
  const keys = new Set<string>();
  const visited = new WeakSet<object>();
  const queue: Array<Readonly<{ value: unknown; depth: number }>> = [
    { value, depth: 0 }
  ];
  let visitedNodes = 0;

  while (queue.length > 0 && visitedNodes < 256) {
    const current = queue.shift();
    if (current === undefined) {
      break;
    }
    const candidate = current.value;
    if (
      candidate === null
      || typeof candidate !== "object"
      || visited.has(candidate)
    ) {
      continue;
    }
    visited.add(candidate);
    visitedNodes += 1;

    if (Array.isArray(candidate)) {
      if (current.depth < 4) {
        for (const child of candidate.slice(0, 8)) {
          queue.push({ value: child, depth: current.depth + 1 });
        }
      }
      continue;
    }

    for (const [key, child] of Object.entries(candidate).slice(0, 64)) {
      keys.add(key.toLowerCase());
      if (current.depth < 4) {
        queue.push({ value: child, depth: current.depth + 1 });
      }
    }
  }

  return keys;
}
