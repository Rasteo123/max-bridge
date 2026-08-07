import type {
  MediaMetadata,
  Message
} from "@maxbridge/core";

import {
  asWireRecord,
  boundedInteger,
  readOpaqueId,
  readWireNumber,
  readWireString,
  type WireRecord
} from "./wire-values.js";

export type MediaMessageKind = Extract<
  Message["kind"],
  "image" | "video" | "voice" | "file"
>;

export type RuntimeMediaDescriptor = Readonly<{
  sourceUrl?: string;
  baseUrl?: string;
  token?: string;
  remoteId?: string;
  previewData?: Uint8Array;
  // MAX hands out no download link in the message itself: a video needs
  // opcode 83 and a file opcode 88, both keyed by the owning message.
  kind?: MediaMessageKind;
  chatId?: string;
  messageId?: string;
  mimeType?: string;
  fileName?: string;
}>;

export type AdaptedMedia = Readonly<{
  kind: MediaMessageKind;
  metadata: MediaMetadata;
}>;

export class RuntimeMediaAdapter {
  private readonly entries = new Map<string, RuntimeMediaDescriptor>();
  private readonly maxEntries: number;
  private nextHandle = 0;

  constructor(options: Readonly<{ maxEntries?: number }> = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? 256);
  }

  get size(): number {
    return this.entries.size;
  }

  adaptAttachment(
    attachmentValue: unknown,
    context: Readonly<{
      chatId: string;
      messageId: string;
      index: number;
    }>
  ): AdaptedMedia {
    const attachment = asWireRecord(attachmentValue);
    const kind = attachmentKind(attachment);
    this.nextHandle += 1;
    const contextIndex = Number.isSafeInteger(context.index)
      ? Math.max(0, context.index).toString(36)
      : "0";
    const handle = `media_${this.nextHandle.toString(36)}_${contextIndex}`;
    const descriptor = buildDescriptor(attachment);
    this.register(handle, {
      ...descriptor,
      kind,
      chatId: context.chatId,
      messageId: context.messageId,
      mimeType: mediaMimeType(kind, attachment),
      ...(sanitizeFileName(
        readWireString(attachment, "name", "fileName", "filename")
      ) === undefined
        ? {}
        : {
          fileName: sanitizeFileName(
            readWireString(attachment, "name", "fileName", "filename")
          ) as string
        })
    });
    const sourceUrl = publicMediaUrl(
      descriptor.sourceUrl ?? descriptor.baseUrl
    );

    const width = readWireNumber(attachment, "width");
    const height = readWireNumber(attachment, "height");
    const durationMs = readDurationMs(attachment);
    const fileName = sanitizeFileName(
      readWireString(attachment, "name", "fileName", "filename")
    );
    const metadata: MediaMetadata = {
      handle,
      mimeType: mediaMimeType(kind, attachment),
      size: boundedInteger(
        readWireNumber(attachment, "size", "fileSize"),
        0,
        1_073_741_824
      ),
      ...(sourceUrl === undefined ? {} : { sourceUrl }),
      ...(fileName === undefined ? {} : { fileName }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(width === undefined ? {} : {
        width: boundedInteger(width, 1, 65_535, 1)
      }),
      ...(height === undefined ? {} : {
        height: boundedInteger(height, 1, 65_535, 1)
      })
    };
    return { kind, metadata };
  }

  registerAvatar(chatId: string, value: unknown): string | undefined {
    const source = optionalAvatarDescriptor(value);
    if (source === undefined) {
      return undefined;
    }
    const handle = `avatar:${chatId}`;
    this.register(handle, source);
    return handle;
  }

  resolve(handle: string): RuntimeMediaDescriptor | undefined {
    return this.entries.get(handle);
  }

  clear(): void {
    for (const descriptor of this.entries.values()) {
      descriptor.previewData?.fill(0);
    }
    this.entries.clear();
    this.nextHandle = 0;
  }

  private register(handle: string, descriptor: RuntimeMediaDescriptor): void {
    const existing = this.entries.get(handle);
    existing?.previewData?.fill(0);
    this.entries.delete(handle);
    this.entries.set(handle, descriptor);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) {
        break;
      }
      const removed = this.entries.get(oldest);
      removed?.previewData?.fill(0);
      this.entries.delete(oldest);
    }
  }
}

function attachmentKind(attachment: WireRecord): MediaMessageKind {
  const raw = readWireString(
    attachment,
    "_type",
    "type",
    "kind",
    "mediaType"
  )?.toUpperCase();
  if (
    raw?.includes("PHOTO") === true ||
    raw?.includes("IMAGE") === true ||
    raw?.includes("STICKER") === true
  ) {
    return "image";
  }
  if (raw?.includes("VIDEO") === true) {
    return "video";
  }
  if (
    raw?.includes("VOICE") === true
    || raw?.includes("AUDIO") === true
  ) {
    return "voice";
  }
  return "file";
}

function buildDescriptor(
  attachment: WireRecord
): RuntimeMediaDescriptor {
  const previewData = readPreviewData(attachment["previewData"]);
  const sourceUrl = safeRuntimeUrl(
    readWireString(attachment, "url", "downloadUrl")
  );
  const baseUrl = safeRuntimeUrl(
    readWireString(attachment, "baseUrl", "baseRawUrl")
  );
  const token = readWireString(
    attachment,
    "photoToken",
    "videoToken",
    "token"
  );
  const remoteId = readOpaqueId(
    attachment,
    "photoId",
    "videoId",
    "fileId",
    "id"
  );
  return {
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(token === undefined ? {} : { token }),
    ...(remoteId === undefined ? {} : { remoteId }),
    ...(previewData === undefined ? {} : { previewData })
  };
}

function optionalAvatarDescriptor(
  value: unknown
): RuntimeMediaDescriptor | undefined {
  const record = value === null || typeof value !== "object"
    ? undefined
    : value as WireRecord;
  if (record === undefined) {
    return undefined;
  }
  const baseUrl = safeRuntimeUrl(
    readWireString(record, "baseUrl", "baseRawUrl", "avatarUrl")
  );
  const remoteId = readOpaqueId(record, "photoId", "avatarId");
  if (baseUrl === undefined && remoteId === undefined) {
    return undefined;
  }
  return {
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(remoteId === undefined ? {} : { remoteId })
  };
}

function readPreviewData(value: unknown): Uint8Array | undefined {
  if (value instanceof Uint8Array) {
    return Uint8Array.from(value);
  }
  if (
    Array.isArray(value)
    && value.length <= 256 * 1024
    && value.every((item) =>
      typeof item === "number"
      && Number.isInteger(item)
      && item >= 0
      && item <= 255
    )
  ) {
    return Uint8Array.from(value);
  }
  return undefined;
}

function readDurationMs(record: WireRecord): number | undefined {
  const direct = readWireNumber(record, "durationMs");
  if (direct !== undefined) {
    return boundedInteger(direct, 0, 86_400_000);
  }
  const seconds = readWireNumber(record, "duration");
  return seconds === undefined
    ? undefined
    : boundedInteger(seconds * 1_000, 0, 86_400_000);
}

function mediaMimeType(
  kind: MediaMessageKind,
  attachment: WireRecord
): string {
  const explicit = readWireString(
    attachment,
    "mimeType",
    "mime",
    "contentType"
  );
  if (
    explicit !== undefined
    && explicit.length <= 255
    && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/iu.test(explicit)
  ) {
    return explicit.toLowerCase();
  }
  switch (kind) {
    case "image":
      return "image/jpeg";
    case "video":
      return "video/mp4";
    case "voice":
      return "audio/ogg";
    case "file":
      return "application/octet-stream";
  }
}

function sanitizeFileName(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const rawLeaf = value.split(/[/\\]/u).at(-1);
  const leaf = rawLeaf === undefined
    ? undefined
    : stripControlCharacters(rawLeaf).trim().slice(0, 255);
  return leaf === undefined || leaf.length === 0 ? undefined : leaf;
}

function stripControlCharacters(value: string): string {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code > 31 && code !== 127) {
      output += value.charAt(index);
    }
  }
  return output;
}

function safeRuntimeUrl(value: string | undefined): string | undefined {
  if (value === undefined || value.length > 4_096) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function publicMediaUrl(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.hostname === "i.oneme.ru"
      && parsed.port.length === 0
      && parsed.username.length === 0
      && parsed.password.length === 0
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}
