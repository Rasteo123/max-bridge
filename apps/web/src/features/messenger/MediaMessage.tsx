import {
  useEffect,
  useState
} from "react";

import type { MessengerMedia } from "./types.js";

type MediaMessageProps = Readonly<{
  kind: "image" | "video" | "voice" | "file";
  media: MessengerMedia;
}>;

export function MediaMessage({
  kind,
  media
}: MediaMessageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let createdUrl: string | null = null;
    const directUrl = safeMaxMediaUrl(media.sourceUrl);
    if (directUrl !== null) {
      setFailed(false);
      setObjectUrl(directUrl);
      return () => {
        controller.abort();
      };
    }
    const path = mediaPath(media.handle);
    if (path === null) {
      setFailed(true);
      return () => {
        controller.abort();
      };
    }
    void fetch(path, {
      credentials: "include",
      cache: "no-store",
      signal: controller.signal,
      headers: { accept: media.mimeType }
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("media_unavailable");
        }
        const blob = await response.blob();
        if (blob.size > Math.max(media.size, 1) + 1_024) {
          throw new Error("media_size_mismatch");
        }
        createdUrl = URL.createObjectURL(blob);
        setObjectUrl(createdUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setFailed(true);
        }
      });
    return () => {
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
    case "image":
      return <img className="message-media" src={objectUrl} alt="Изображение" />;
    case "video":
      return (
        <video className="message-media" src={objectUrl} controls>
          Видео недоступно
        </video>
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
