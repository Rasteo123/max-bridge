const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_KEYS = 64;
const DEFAULT_ARRAY_SAMPLE = 8;

export type ArrayLengthBucket =
  | "0"
  | "1"
  | "2-5"
  | "6-20"
  | "21+";

export type StructuralSchema =
  | Readonly<{ type: "null" }>
  | Readonly<{ type: "boolean" }>
  | Readonly<{ type: "number" }>
  | Readonly<{ type: "string" }>
  | Readonly<{ type: "binary" }>
  | Readonly<{ type: "unknown" }>
  | Readonly<{ type: "reference" }>
  | Readonly<{
    type: "truncated";
    reason: "size_limit" | "depth_limit" | "key_limit";
  }>
  | Readonly<{
    type: "array";
    length: ArrayLengthBucket;
    items: readonly StructuralSchema[];
  }>
  | Readonly<{
    type: "object";
    keys: Readonly<Record<string, StructuralSchema>>;
  }>;

export type StructuralSchemaOptions = Readonly<{
  maxBytes?: number;
  measuredBytes?: number;
  maxDepth?: number;
  maxKeys?: number;
  maxArraySample?: number;
}>;

export type SafeEndpoint = Readonly<{
  origin: string;
  pathPattern: string;
  queryKeys: readonly string[];
}>;

export function sanitizeEndpoint(rawUrl: string): SafeEndpoint {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      origin: "invalid:",
      pathPattern: "/",
      queryKeys: []
    };
  }

  const pathPattern = parsed.pathname
    .split("/")
    .map((segment) => generalizePathSegment(segment))
    .join("/");
  const queryKeys = [
    ...new Set(
      [...parsed.searchParams.keys()].map((key) => sanitizeObjectKey(key))
    )
  ].sort();

  return {
    origin: parsed.origin,
    pathPattern,
    queryKeys
  };
}

export function extractStructuralSchema(
  value: unknown,
  options: StructuralSchemaOptions = {}
): StructuralSchema {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  if (
    options.measuredBytes !== undefined
    && options.measuredBytes > maxBytes
  ) {
    return { type: "truncated", reason: "size_limit" };
  }

  return visitValue(
    value,
    {
      maxDepth: options.maxDepth ?? DEFAULT_MAX_DEPTH,
      maxKeys: options.maxKeys ?? DEFAULT_MAX_KEYS,
      maxArraySample: options.maxArraySample ?? DEFAULT_ARRAY_SAMPLE
    },
    0,
    new WeakSet<object>()
  );
}

export function byteLengthOfText(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function visitValue(
  value: unknown,
  limits: Readonly<{
    maxDepth: number;
    maxKeys: number;
    maxArraySample: number;
  }>,
  depth: number,
  visited: WeakSet<object>
): StructuralSchema {
  if (value === null) {
    return { type: "null" };
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return { type: "binary" };
  }

  switch (typeof value) {
    case "boolean":
      return { type: "boolean" };
    case "number":
    case "bigint":
      return { type: "number" };
    case "string":
      return { type: "string" };
    case "object":
      break;
    default:
      return { type: "unknown" };
  }

  if (depth >= limits.maxDepth) {
    return { type: "truncated", reason: "depth_limit" };
  }
  if (visited.has(value)) {
    return { type: "reference" };
  }
  visited.add(value);

  if (Array.isArray(value)) {
    const distinct = new Map<string, StructuralSchema>();
    for (const item of value.slice(0, limits.maxArraySample)) {
      const schema = visitValue(item, limits, depth + 1, visited);
      distinct.set(JSON.stringify(schema), schema);
    }
    return {
      type: "array",
      length: bucketArrayLength(value.length),
      items: [...distinct.values()]
    };
  }

  const entries = Object.entries(value);
  const selected = entries.slice(0, limits.maxKeys);
  const keys: Record<string, StructuralSchema> = {};
  for (const [rawKey, child] of selected) {
    keys[deduplicateKey(keys, sanitizeObjectKey(rawKey))] = visitValue(
      child,
      limits,
      depth + 1,
      visited
    );
  }
  if (entries.length > limits.maxKeys) {
    keys[deduplicateKey(keys, ":more")] = {
      type: "truncated",
      reason: "key_limit"
    };
  }
  return { type: "object", keys };
}

function bucketArrayLength(length: number): ArrayLengthBucket {
  if (length === 0) {
    return "0";
  }
  if (length === 1) {
    return "1";
  }
  if (length <= 5) {
    return "2-5";
  }
  if (length <= 20) {
    return "6-20";
  }
  return "21+";
}

function generalizePathSegment(segment: string): string {
  if (segment.length === 0) {
    return "";
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    return ":id";
  }
  if (
    /^\d{4,}$/u.test(decoded)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(decoded)
    || /^[A-Za-z0-9_-]{20,}$/u.test(decoded)
  ) {
    return ":id";
  }
  return sanitizeObjectKey(decoded);
}

function sanitizeObjectKey(key: string): string {
  if (
    key.length === 0
    || key.length > 64
    || !/^[A-Za-zА-Яа-яЁё_$][A-Za-zА-Яа-яЁё0-9_$.-]*$/u.test(key)
    || /^\d{4,}$/u.test(key)
    || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(key)
  ) {
    return ":dynamic";
  }
  return key;
}

function deduplicateKey(
  existing: Readonly<Record<string, StructuralSchema>>,
  key: string
): string {
  if (!(key in existing)) {
    return key;
  }
  let suffix = 2;
  while (`${key}#${String(suffix)}` in existing) {
    suffix += 1;
  }
  return `${key}#${String(suffix)}`;
}
