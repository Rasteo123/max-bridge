import {
  useEffect,
  useState
} from "react";

import {
  requestTelegramMediaFullscreen,
  type TelegramMediaFullscreenLease
} from "../auth/telegram.js";
import type { MessengerMedia } from "./types.js";

export type MediaOpenInput = Readonly<{
  kind: "image" | "video";
  url: string;
  alt: string;
  telegramFullscreenLease: TelegramMediaFullscreenLease | null;
}>;

type MediaMessageProps = Readonly<{
  kind: "image" | "video" | "voice" | "file";
  media: MessengerMedia;
  onOpen?(input: MediaOpenInput): void;
}>;

export function MediaMessage({
  kind,
  media,
  onOpen
}: MediaMessageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let createdUrl: string | null = null;
    setObjectUrl(null);
    setFailed(false);
    const directUrl = safeMaxMediaUrl(media.sourceUrl);
    if (directUrl !== null) {
      setFailed(false);
      setObjectUrl(directUrl);
      return () => {
        controller.abort();
      };
    }
    void resolveMediaUrl(media, controller.signal)
      .then((resolved) => {
        if (!active) {
          if (resolved.revoke) {
            URL.revokeObjectURL(resolved.url);
          }
          return;
        }
        createdUrl = resolved.revoke ? resolved.url : null;
        setFailed(false);
        setObjectUrl(resolved.url);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      });
    return () => {
      active = false;
      controller.abort();
      if (createdUrl !== null) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [media.handle, media.mimeType, media.size, media.sourceUrl]);

  if (failed) {
    return <span className="media-unavailable">Медиа недоступно</span>;
  }
  if (objectUrl === null) {
    return <span className="media-loading" aria-busy="true">Загрузка…</span>;
  }
  switch (kind) {
    case "image": {
      const image = (
        <img className="message-media" src={objectUrl} alt="Изображение" />
      );
      return onOpen === undefined ? image : (
        <button
          className="message-media-button"
          type="button"
          data-no-swipe
          aria-label="Открыть изображение"
          onClick={() => {
            const telegramFullscreenLease =
              requestTelegramMediaFullscreen();
            onOpen({
              kind,
              url: objectUrl,
              alt: "Изображение",
              telegramFullscreenLease
            });
          }}
        >
          {image}
        </button>
      );
    }
    case "video":
      return onOpen === undefined ? (
        <video className="message-media" src={objectUrl} controls playsInline>
          Видео недоступно
        </video>
      ) : (
        <button
          className="message-media-button message-media-button--video"
          type="button"
          data-no-swipe
          aria-label="Открыть видео"
          onClick={() => {
            const telegramFullscreenLease =
              requestTelegramMediaFullscreen();
            onOpen({
              kind,
              url: objectUrl,
              alt: "Видео",
              telegramFullscreenLease
            });
          }}
        >
          <video
            className="message-media"
            src={objectUrl}
            muted
            playsInline
            preload="metadata"
            tabIndex={-1}
          >
            Видео недоступно
          </video>
          <span className="message-media-button__play" aria-hidden="true">
            ▶
          </span>
        </button>
      );
    case "voice":
      return <audio className="message-audio" src={objectUrl} controls />;
    case "file":
      return (
        <a className="message-file" href={objectUrl} download={media.fileName}>
          {media.fileName ?? "Скачать файл"}
        </a>
      );
  }
}

export type ResolvedMediaUrl = Readonly<{
  url: string;
  revoke: boolean;
}>;

export async function resolveMediaUrl(
  media: MessengerMedia,
  signal?: AbortSignal
): Promise<ResolvedMediaUrl> {
  const directUrl = safeMaxMediaUrl(media.sourceUrl);
  if (directUrl !== null) {
    return { url: directUrl, revoke: false };
  }
  const path = mediaPath(media.handle);
  if (path === null) {
    throw new Error("media_handle_invalid");
  }
  const response = await fetch(path, {
    credentials: "include",
    cache: "no-store",
    ...(signal === undefined ? {} : { signal }),
    headers: { accept: media.mimeType }
  });
  if (!response.ok) {
    throw new Error("media_unavailable");
  }
  const blob = await response.blob();
  if (blob.size > Math.max(media.size, 1) + 1_024) {
    throw new Error("media_size_mismatch");
  }
  const expectedMime = normalizedMime(media.mimeType);
  const actualMime = normalizedMime(
    blob.type || response.headers.get("content-type") || ""
  );
  if (expectedMime.length === 0 || actualMime !== expectedMime) {
    throw new Error("media_mime_mismatch");
  }
  return {
    url: URL.createObjectURL(blob),
    revoke: true
  };
}

export function mediaPath(handle: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(handle)) {
    return null;
  }
  return `/api/media/${encodeURIComponent(handle)}`;
}

export function safeMaxMediaUrl(value: string | undefined): string | null {
  if (value === undefined || value.length > 4_096) {
    return null;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.hostname === "i.oneme.ru"
      && parsed.port.length === 0
      && parsed.username.length === 0
      && parsed.password.length === 0
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function normalizedMime(value: string): string {
  return value.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US") ?? "";
}
