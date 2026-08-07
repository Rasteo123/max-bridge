import type { RuntimeMediaDescriptor } from "@maxbridge/max-adapter";
import type { APIRequestContext } from "playwright";

import type { MaxWireClient } from "./max-wire-client.js";

const VIDEO_OPCODE = 83;
const FILE_OPCODE = 88;
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const RESOLVE_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 60_000;

// Ordered worst to best: MAX names each rendition after its height.
const VIDEO_QUALITY_ORDER = [
  "MP4_144",
  "MP4_240",
  "MP4_360",
  "MP4_480",
  "MP4_720",
  "MP4_1080"
];

const ALLOWED_MEDIA_HOSTS = [
  "i.oneme.ru",
  "fd.oneme.ru",
  "st.max.ru"
];

const ALLOWED_MEDIA_HOST_SUFFIXES = [
  ".oneme.ru",
  ".okcdn.ru"
];

export type ResolvedMedia = Readonly<{
  body: Buffer;
  mimeType: string;
  fileName: string;
}>;

export class MaxMediaError extends Error {
  constructor(readonly reason: "unresolvable" | "rejected" | "too_large") {
    super(`MAX media is ${reason}`);
    this.name = "MaxMediaError";
  }
}

/**
 * Turns a stored attachment into bytes. The URLs MAX hands out are signed for
 * the requesting address, so the download has to happen here and not on the
 * reader's device.
 */
export class MaxMediaResolver {
  constructor(private readonly options: Readonly<{
    wire: MaxWireClient;
    request: APIRequestContext;
  }>) {}

  async resolve(descriptor: RuntimeMediaDescriptor): Promise<ResolvedMedia> {
    const url = await this.resolveUrl(descriptor);
    const response = await this.options.request.get(url, {
      timeout: DOWNLOAD_TIMEOUT_MS,
      maxRedirects: 3
    });
    if (!response.ok()) {
      throw new MaxMediaError("rejected");
    }
    const body = await response.body();
    if (body.byteLength > MAX_MEDIA_BYTES) {
      throw new MaxMediaError("too_large");
    }
    return {
      body,
      mimeType: responseMimeType(response.headers()["content-type"])
        ?? descriptor.mimeType
        ?? "application/octet-stream",
      fileName: descriptor.fileName ?? "media"
    };
  }

  private async resolveUrl(
    descriptor: RuntimeMediaDescriptor
  ): Promise<string> {
    // A photo already carries a signed link; everything else is asked for.
    const direct = allowedMediaUrl(
      descriptor.sourceUrl ?? descriptor.baseUrl
    );
    if (descriptor.kind === "image" && direct !== undefined) {
      return direct;
    }
    if (descriptor.kind === "video") {
      return this.resolveVideoUrl(descriptor);
    }
    if (descriptor.kind === "file" || descriptor.kind === "voice") {
      return this.resolveFileUrl(descriptor);
    }
    if (direct === undefined) {
      throw new MaxMediaError("unresolvable");
    }
    return direct;
  }

  private async resolveVideoUrl(
    descriptor: RuntimeMediaDescriptor
  ): Promise<string> {
    const payload = asRecord(await this.options.wire.request(VIDEO_OPCODE, {
      videoId: numeric(descriptor.remoteId),
      token: requireText(descriptor.token),
      chatId: numeric(descriptor.chatId),
      messageId: numeric(descriptor.messageId)
    }, RESOLVE_TIMEOUT_MS));
    for (const quality of [...VIDEO_QUALITY_ORDER].reverse()) {
      const candidate = allowedMediaUrl(payload[quality]);
      if (candidate !== undefined) {
        return candidate;
      }
    }
    throw new MaxMediaError("unresolvable");
  }

  private async resolveFileUrl(
    descriptor: RuntimeMediaDescriptor
  ): Promise<string> {
    const payload = asRecord(await this.options.wire.request(FILE_OPCODE, {
      fileId: numeric(descriptor.remoteId),
      chatId: numeric(descriptor.chatId),
      messageId: numeric(descriptor.messageId),
      itemType: "REGULAR"
    }, RESOLVE_TIMEOUT_MS));
    const url = allowedMediaUrl(payload["url"]);
    if (url === undefined) {
      throw new MaxMediaError("unresolvable");
    }
    return url;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new MaxMediaError("unresolvable");
  }
  return value as Record<string, unknown>;
}

function numeric(value: string | undefined): number | bigint {
  if (value === undefined || !/^-?\d{1,19}$/u.test(value)) {
    throw new MaxMediaError("unresolvable");
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : BigInt(value);
}

function requireText(value: string | undefined): string {
  if (value === undefined || value.length === 0 || value.length > 4_096) {
    throw new MaxMediaError("unresolvable");
  }
  return value;
}

export function allowedMediaUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 8_192) {
    return undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  if (
    url.protocol !== "https:"
    || url.username.length > 0
    || url.password.length > 0
  ) {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_MEDIA_HOSTS.includes(host)
    || ALLOWED_MEDIA_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  return allowed ? url.toString() : undefined;
}

function responseMimeType(value: string | undefined): string | undefined {
  const mime = value?.split(";")[0]?.trim().toLowerCase();
  return mime !== undefined
    && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u.test(mime)
    ? mime
    : undefined;
}
