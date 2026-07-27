import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type SyntheticEvent,
  useEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";

import { exitOwnedTelegramMediaFullscreen } from "../auth/telegram.js";
import {
  resolveMediaUrl,
  safeMaxMediaUrl
} from "./MediaMessage.js";
import type { MessengerMedia } from "./types.js";
import { useMediaCarousel } from "./useMediaCarousel.js";
import { useMediaTransform } from "./useMediaTransform.js";

export type MediaViewerItem = Readonly<{
  id: string;
  kind: "image" | "video";
  alt: string;
  media: MessengerMedia;
}>;

type MediaViewerProps = Readonly<{
  items: readonly MediaViewerItem[];
  index: number;
  onIndexChange(index: number): void;
  onClose(): void;
  telegramFullscreenRequested?: boolean;
}>;

type ResolvedEntry =
  | Readonly<{
    status: "ready";
    url: string;
    revoke: boolean;
  }>
  | Readonly<{
    status: "failed";
  }>;

type MediaResolutionGeneration = {
  id: number;
  active: boolean;
  controller: AbortController;
  pending: Set<string>;
};

const VIDEO_CONTROL_STRIP_PX = 64;

export function MediaViewer({
  items,
  ...props
}: MediaViewerProps) {
  const firstItem = items[0];
  if (firstItem === undefined) {
    return null;
  }
  return (
    <MediaViewerDialog
      {...props}
      items={items}
      firstItem={firstItem}
    />
  );
}

function MediaViewerDialog({
  items,
  index,
  onIndexChange,
  onClose,
  firstItem,
  telegramFullscreenRequested = false
}: MediaViewerProps & Readonly<{ firstItem: MediaViewerItem }>) {
  const safeIndex = Math.min(
    Math.max(0, index),
    Math.max(0, items.length - 1)
  );
  const current = items[safeIndex] ?? firstItem;
  const dialogRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const openerRef = useRef<HTMLElement | null>(
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  const fullscreenExitTimer = useRef<number | null>(null);
  const fullscreenReleased = useRef(false);
  const [bounds, setBounds] = useState({
    viewportWidth: Math.max(1, window.innerWidth),
    viewportHeight: Math.max(1, window.innerHeight),
    mediaWidth: Math.max(1, window.innerWidth),
    mediaHeight: Math.max(1, window.innerHeight)
  });
  const transform = useMediaTransform(bounds);
  const resolved = useResolvedGallery(items, safeIndex);
  const carousel = useMediaCarousel({
    index: safeIndex,
    count: items.length,
    viewportWidth: bounds.viewportWidth,
    onSelect: onIndexChange,
    enabled: current.kind !== "image" || transform.transform.scale <= 1
  });
  const previousItemId = useRef(current.id);
  const previousVideo = useRef<HTMLVideoElement | null>(null);
  const lastTouchAt = useRef(0);

  useEffect(() => {
    if (fullscreenExitTimer.current !== null) {
      window.clearTimeout(fullscreenExitTimer.current);
      fullscreenExitTimer.current = null;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current
      ?.querySelector<HTMLButtonElement>(".media-viewer__close")
      ?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      openerRef.current?.focus();
      fullscreenExitTimer.current = window.setTimeout(() => {
        fullscreenExitTimer.current = null;
        releaseOwnedFullscreen();
      }, 0);
    };
  }, []);

  useEffect(() => {
    if (previousItemId.current === current.id) {
      previousVideo.current = videoRef.current;
      return;
    }
    previousVideo.current?.pause();
    transform.reset();
    carousel.cancel();
    previousItemId.current = current.id;
    previousVideo.current = videoRef.current;
  }, [current.id]);

  useEffect(() => {
    if (transform.transform.scale > 1) {
      carousel.cancel();
    }
  }, [transform.transform.scale]);

  useEffect(() => {
    const update = () => {
      const stage = stageRef.current?.getBoundingClientRect();
      if (stage === undefined) {
        return;
      }
      setBounds((value) => ({
        ...value,
        viewportWidth: Math.max(1, stage.width),
        viewportHeight: Math.max(1, stage.height)
      }));
    };
    update();
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
    };
  }, []);

  const style = {
    "--carousel-offset": `${String(carousel.offset)}px`
  } as CSSProperties;

  function close(): void {
    releaseOwnedFullscreen();
    onClose();
  }

  function releaseOwnedFullscreen(): void {
    if (
      fullscreenReleased.current ||
      !telegramFullscreenRequested
    ) {
      return;
    }
    fullscreenReleased.current = true;
    exitOwnedTelegramMediaFullscreen(true);
  }

  function onDocumentKeyDown(event: globalThis.KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (
      event.key === "Tab"
    ) {
      trapTabKey(event, dialogRef.current);
      return;
    }
    if (
      event.target instanceof HTMLVideoElement ||
      event.target instanceof HTMLInputElement
    ) {
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      carousel.selectPrevious();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      carousel.selectNext();
    }
  }

  useEffect(() => {
    document.addEventListener("keydown", onDocumentKeyDown);
    return () => {
      document.removeEventListener("keydown", onDocumentKeyDown);
    };
  });

  function onStagePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (
      current.kind === "video" &&
      event.target instanceof HTMLVideoElement &&
      startsInVideoControls(event, event.target)
    ) {
      return;
    }
    carousel.handlers.onPointerDown(event);
  }

  function renderSlide(itemIndex: number) {
    const item = items[itemIndex];
    if (item === undefined) {
      return null;
    }
    const position = itemIndex - safeIndex;
    const entry = resolved.get(item.id);
    const isCurrent = itemIndex === safeIndex;
    const slideStyle = {
      "--slide-position": String(position)
    } as CSSProperties;
    return (
      <div
        key={item.id}
        className="media-viewer__slide"
        aria-hidden={!isCurrent}
        style={slideStyle}
      >
        {entry === undefined ? (
          <span className="media-viewer__loading" aria-busy="true">
            Загрузка…
          </span>
        ) : entry.status === "failed" ? (
          <span className="media-viewer__loading" role="alert">
            Медиа недоступно
          </span>
        ) : item.kind === "video" ? (
          <video
            ref={isCurrent ? videoRef : undefined}
            className="media-viewer__video"
            data-testid={isCurrent ? "media-viewer-video" : undefined}
            src={entry.url}
            controls={isCurrent}
            playsInline
            preload={isCurrent ? "metadata" : "none"}
            tabIndex={isCurrent ? 0 : -1}
          >
            Видео недоступно
          </video>
        ) : (
          <img
            className="media-viewer__image"
            data-testid={isCurrent ? "media-viewer-image" : undefined}
            src={entry.url}
            alt={isCurrent ? item.alt : ""}
            draggable={false}
            style={isCurrent ? ({
              "--media-scale": String(transform.transform.scale),
              "--media-x": `${String(transform.transform.x)}px`,
              "--media-y": `${String(transform.transform.y)}px`
            } as CSSProperties) : undefined}
            {...(isCurrent ? {
              onPointerDown: (event: ReactPointerEvent<HTMLImageElement>) => {
                if (!event.isPrimary) {
                  carousel.cancel();
                }
                transform.handlers.onPointerDown(event);
              },
              onPointerMove: transform.handlers.onPointerMove,
              onPointerUp: (event: ReactPointerEvent<HTMLImageElement>) => {
                transform.handlers.onPointerUp(event);
                if (
                  event.pointerType === "touch" &&
                  transform.transform.scale <= 1
                ) {
                  const now = Date.now();
                  if (now - lastTouchAt.current < 300) {
                    transform.toggleZoom();
                    lastTouchAt.current = 0;
                  } else {
                    lastTouchAt.current = now;
                  }
                }
              },
              onPointerCancel: transform.handlers.onPointerCancel,
              onPointerLeave: transform.handlers.onPointerLeave,
              onLostPointerCapture: transform.handlers.onLostPointerCapture,
              onWheel: transform.handlers.onWheel,
              onDoubleClick: transform.toggleZoom,
              onLoad: (
                event: SyntheticEvent<HTMLImageElement>
              ) => {
                const image = event.currentTarget;
                const stage = stageRef.current?.getBoundingClientRect();
                setBounds({
                  viewportWidth: Math.max(1, stage?.width ?? window.innerWidth),
                  viewportHeight: Math.max(
                    1,
                    stage?.height ?? window.innerHeight
                  ),
                  mediaWidth: Math.max(
                    1,
                    image.naturalWidth || image.clientWidth
                  ),
                  mediaHeight: Math.max(
                    1,
                    image.naturalHeight || image.clientHeight
                  )
                });
              }
            } : {})}
          />
        )}
      </div>
    );
  }

  return createPortal(
    <div
      ref={dialogRef}
      className="media-viewer"
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      aria-label={
        current.kind === "image"
          ? "Просмотр изображения"
          : "Просмотр видео"
      }
      data-no-swipe
      onPointerDown={(event) => {
        event.stopPropagation();
      }}
      onWheel={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        className="media-viewer__close"
        type="button"
        data-no-carousel
        aria-label="Закрыть просмотр"
        onClick={close}
      >
        ×
      </button>
      <div
        ref={stageRef}
        className="media-viewer__stage"
        data-testid="media-viewer-stage"
        data-dragging={carousel.dragging ? "true" : "false"}
        data-transitioning={carousel.transitioning ? "true" : "false"}
        data-reduced-motion={carousel.reducedMotion ? "true" : "false"}
        style={style}
        onPointerDown={onStagePointerDown}
        onPointerMove={carousel.handlers.onPointerMove}
        onPointerUp={carousel.handlers.onPointerUp}
        onPointerCancel={carousel.handlers.onPointerCancel}
        onPointerLeave={carousel.handlers.onPointerLeave}
        onLostPointerCapture={carousel.handlers.onLostPointerCapture}
      >
        {renderSlide(safeIndex - 1)}
        {renderSlide(safeIndex)}
        {renderSlide(safeIndex + 1)}
      </div>
      <button
        className="media-viewer__previous"
        type="button"
        data-no-carousel
        aria-label="Предыдущее медиа"
        disabled={safeIndex <= 0}
        onClick={carousel.selectPrevious}
      >
        ‹
      </button>
      <button
        className="media-viewer__next"
        type="button"
        data-no-carousel
        aria-label="Следующее медиа"
        disabled={safeIndex >= items.length - 1}
        onClick={carousel.selectNext}
      >
        ›
      </button>
      {current.kind === "image" && (
        <div className="media-viewer__zoom" data-no-carousel>
          <button
            type="button"
            aria-label="Уменьшить"
            onClick={transform.zoomOut}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Сбросить масштаб"
            onClick={transform.reset}
          >
            {Math.round(transform.transform.scale * 100)}%
          </button>
          <button
            type="button"
            aria-label="Увеличить"
            onClick={transform.zoomIn}
          >
            +
          </button>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {String(safeIndex + 1)} из {String(items.length)}
      </span>
    </div>,
    document.body
  );
}

function useResolvedGallery(
  items: readonly MediaViewerItem[],
  index: number
): ReadonlyMap<string, ResolvedEntry> {
  const cache = useRef(new Map<string, ResolvedEntry>());
  const preloaded = useRef(new Set<string>());
  const nextGenerationId = useRef(0);
  const generation = useRef<MediaResolutionGeneration | null>(null);
  const [version, setVersion] = useState(0);

  for (const item of items) {
    const direct = safeMaxMediaUrl(item.media.sourceUrl);
    if (direct !== null && !cache.current.has(item.id)) {
      cache.current.set(item.id, {
        status: "ready",
        url: direct,
        revoke: false
      });
    }
  }

  useEffect(() => {
    nextGenerationId.current += 1;
    const currentGeneration: MediaResolutionGeneration = {
      id: nextGenerationId.current,
      active: true,
      controller: new AbortController(),
      pending: new Set()
    };
    generation.current = currentGeneration;
    return () => {
      currentGeneration.active = false;
      currentGeneration.controller.abort();
      currentGeneration.pending.clear();
      preloaded.current.clear();
      for (const [itemId, entry] of cache.current) {
        if (entry.status === "ready" && !entry.revoke) {
          continue;
        }
        if (entry.status === "ready") {
          URL.revokeObjectURL(entry.url);
        }
        cache.current.delete(itemId);
      }
      if (generation.current?.id === currentGeneration.id) {
        generation.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const currentGeneration = generation.current;
    if (currentGeneration === null) {
      return;
    }
    const needed = [
      items[index],
      items[index - 1]?.kind === "image" ? items[index - 1] : undefined,
      items[index + 1]?.kind === "image" ? items[index + 1] : undefined
    ].filter((item): item is MediaViewerItem => item !== undefined);
    for (const item of needed) {
      if (
        cache.current.has(item.id) ||
        currentGeneration.pending.has(item.id)
      ) {
        continue;
      }
      currentGeneration.pending.add(item.id);
      void resolveMediaUrl(
        item.media,
        currentGeneration.controller.signal
      )
        .then((entry) => {
          if (!currentGeneration.active) {
            if (entry.revoke) {
              URL.revokeObjectURL(entry.url);
            }
            return;
          }
          cache.current.set(item.id, {
            status: "ready",
            ...entry
          });
          setVersion((value) => value + 1);
        })
        .catch(() => {
          if (currentGeneration.active) {
            cache.current.set(item.id, { status: "failed" });
            setVersion((value) => value + 1);
          }
        })
        .finally(() => {
          currentGeneration.pending.delete(item.id);
        });
    }
  }, [index, items]);

  useEffect(() => {
    const adjacent = [items[index - 1], items[index + 1]];
    for (const item of adjacent) {
      if (item?.kind !== "image") {
        continue;
      }
      const entry = cache.current.get(item.id);
      if (
        entry?.status === "ready" &&
        !preloaded.current.has(item.id)
      ) {
        preloaded.current.add(item.id);
        const image = new Image();
        image.src = entry.url;
      }
    }
  }, [index, items, version]);

  return cache.current;
}

function startsInVideoControls(
  event: ReactPointerEvent,
  video: HTMLVideoElement
): boolean {
  const bounds = video.getBoundingClientRect();
  return bounds.height > 0 &&
    event.clientY >= bounds.bottom - VIDEO_CONTROL_STRIP_PX &&
    event.clientY <= bounds.bottom;
}

function trapTabKey(
  event: globalThis.KeyboardEvent,
  dialog: HTMLElement | null
): void {
  if (dialog === null) {
    return;
  }
  const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not(:disabled), video[controls], [tabindex]:not([tabindex="-1"])'
  ));
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (first === undefined || last === undefined) {
    event.preventDefault();
    dialog.focus();
    return;
  }
  const currentIndex = focusable.indexOf(
    document.activeElement as HTMLElement
  );
  const nextIndex = event.shiftKey
    ? currentIndex <= 0
      ? focusable.length - 1
      : currentIndex - 1
    : currentIndex < 0 || currentIndex >= focusable.length - 1
      ? 0
      : currentIndex + 1;
  event.preventDefault();
  focusable[nextIndex]?.focus();
}
