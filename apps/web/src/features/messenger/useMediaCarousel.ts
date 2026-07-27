import { useEffect, useRef, useState } from "react";

const AXIS_LOCK_PX = 8;
const COMPLETE_DISTANCE_PX = 72;
const FLICK_MIN_DISTANCE_PX = 24;
const FLICK_MIN_VELOCITY = 0.45;
const EDGE_RESISTANCE = 0.28;
const SETTLE_DURATION_MS = 220;

type CarouselPointerTarget = Readonly<{
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  hasPointerCapture?(pointerId: number): boolean;
}>;

export type MediaCarouselPointerEvent = Readonly<{
  pointerId: number;
  clientX: number;
  clientY: number;
  timeStamp: number;
  button: number;
  isPrimary: boolean;
  target: unknown;
  currentTarget: CarouselPointerTarget;
  preventDefault(): void;
}>;

type MediaCarouselOptions = Readonly<{
  index: number;
  count: number;
  viewportWidth: number;
  onSelect(index: number): void;
  enabled?: boolean;
  reducedMotion?: boolean;
}>;

type ActivePointer = {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  startedAt: number;
  axis: "pending" | "horizontal";
  captured: boolean;
  target: CarouselPointerTarget;
};

export type MediaCarouselControls = Readonly<{
  offset: number;
  dragging: boolean;
  transitioning: boolean;
  reducedMotion: boolean;
  handlers: Readonly<{
    onPointerDown(event: MediaCarouselPointerEvent): void;
    onPointerMove(event: MediaCarouselPointerEvent): void;
    onPointerUp(event: MediaCarouselPointerEvent): void;
    onPointerCancel(event: MediaCarouselPointerEvent): void;
    onPointerLeave(event: MediaCarouselPointerEvent): void;
    onLostPointerCapture(event: MediaCarouselPointerEvent): void;
  }>;
  selectPrevious(): void;
  selectNext(): void;
  cancel(): void;
}>;

export function useMediaCarousel({
  index,
  count,
  viewportWidth,
  onSelect,
  enabled = true,
  reducedMotion: reducedMotionOverride
}: MediaCarouselOptions): MediaCarouselControls {
  const active = useRef<ActivePointer | null>(null);
  const settleTimer = useRef<number | null>(null);
  const animationFrame = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const reducedMotion = reducedMotionOverride ?? prefersReducedMotion;
  const enabledRef = useRef(enabled);
  const indexRef = useRef(index);
  const countRef = useRef(count);
  const viewportWidthRef = useRef(viewportWidth);
  const onSelectRef = useRef(onSelect);
  enabledRef.current = enabled;
  indexRef.current = index;
  countRef.current = count;
  viewportWidthRef.current = viewportWidth;
  onSelectRef.current = onSelect;

  useEffect(() => () => {
    clearSettleTimers();
    releaseActivePointer();
  }, []);

  function clearSettleTimers(): void {
    if (settleTimer.current !== null) {
      window.clearTimeout(settleTimer.current);
      settleTimer.current = null;
    }
    if (animationFrame.current !== null) {
      window.cancelAnimationFrame(animationFrame.current);
      animationFrame.current = null;
    }
  }

  function onPointerDown(event: MediaCarouselPointerEvent): void {
    if (
      !enabledRef.current ||
      active.current !== null ||
      event.button !== 0 ||
      !event.isPrimary ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY) ||
      hasCarouselOptOut(event.target)
    ) {
      return;
    }
    clearSettleTimers();
    setTransitioning(false);
    active.current = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      startedAt: finiteTime(event.timeStamp),
      axis: "pending",
      captured: false,
      target: event.currentTarget
    };
  }

  function onPointerMove(event: MediaCarouselPointerEvent): void {
    const pointer = active.current;
    if (
      pointer === null ||
      pointer.id !== event.pointerId ||
      !enabledRef.current ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      return;
    }
    const deltaX = event.clientX - pointer.startX;
    const deltaY = event.clientY - pointer.startY;
    if (pointer.axis === "pending") {
      if (
        Math.abs(deltaX) <= AXIS_LOCK_PX &&
        Math.abs(deltaY) <= AXIS_LOCK_PX
      ) {
        return;
      }
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        cancel();
        return;
      }
      pointer.axis = "horizontal";
      pointer.target = event.currentTarget;
      pointer.captured = capturePointer(
        event.currentTarget,
        event.pointerId
      );
      setDragging(true);
    }
    event.preventDefault();
    pointer.lastX = event.clientX;
    setOffset(resistedOffset(deltaX, indexRef.current, countRef.current));
  }

  function onPointerUp(event: MediaCarouselPointerEvent): void {
    const pointer = active.current;
    if (pointer === null || pointer.id !== event.pointerId) {
      return;
    }
    const deltaX = pointer.lastX - pointer.startX;
    const elapsed = Math.max(
      16,
      finiteTime(event.timeStamp) - pointer.startedAt
    );
    const direction = deltaX < 0 ? 1 : -1;
    const nextIndex = indexRef.current + direction;
    const canSelect = pointer.axis === "horizontal" &&
      nextIndex >= 0 &&
      nextIndex < countRef.current &&
      (
        Math.abs(deltaX) >= COMPLETE_DISTANCE_PX ||
        (
          Math.abs(deltaX) >= FLICK_MIN_DISTANCE_PX &&
          Math.min(2, Math.abs(deltaX) / elapsed) >= FLICK_MIN_VELOCITY
        )
      );
    releaseActivePointer();
    if (!canSelect) {
      settleAt(0);
      return;
    }

    const width = Math.max(1, viewportWidthRef.current);
    const entryOffset = direction > 0
      ? width + deltaX
      : -width + deltaX;
    onSelectRef.current(nextIndex);
    if (reducedMotion) {
      setOffset(0);
      setDragging(false);
      setTransitioning(false);
      return;
    }
    setDragging(false);
    setTransitioning(false);
    setOffset(entryOffset);
    animationFrame.current = window.requestAnimationFrame(() => {
      animationFrame.current = null;
      setTransitioning(true);
      setOffset(0);
      settleTimer.current = window.setTimeout(() => {
        settleTimer.current = null;
        setTransitioning(false);
      }, SETTLE_DURATION_MS);
    });
  }

  function finishWithoutSelection(event: MediaCarouselPointerEvent): void {
    if (active.current?.id !== event.pointerId) {
      return;
    }
    releaseActivePointer();
    settleAt(0);
  }

  function onPointerLeave(event: MediaCarouselPointerEvent): void {
    if (
      active.current?.id === event.pointerId &&
      !active.current.captured
    ) {
      finishWithoutSelection(event);
    }
  }

  function onLostPointerCapture(event: MediaCarouselPointerEvent): void {
    if (active.current?.id !== event.pointerId) {
      return;
    }
    active.current.captured = false;
    active.current = null;
    settleAt(0);
  }

  function settleAt(value: number): void {
    setDragging(false);
    if (reducedMotion) {
      setOffset(value);
      setTransitioning(false);
      return;
    }
    setTransitioning(true);
    setOffset(value);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      setTransitioning(false);
    }, SETTLE_DURATION_MS);
  }

  function releaseActivePointer(): void {
    const pointer = active.current;
    active.current = null;
    if (pointer?.captured !== true) {
      return;
    }
    releasePointer(pointer.target, pointer.id);
  }

  function cancel(): void {
    releaseActivePointer();
    settleAt(0);
  }

  function select(nextIndex: number): void {
    if (
      nextIndex < 0 ||
      nextIndex >= countRef.current ||
      nextIndex === indexRef.current
    ) {
      return;
    }
    onSelectRef.current(nextIndex);
  }

  return {
    offset,
    dragging,
    transitioning,
    reducedMotion,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: finishWithoutSelection,
      onPointerLeave,
      onLostPointerCapture
    },
    selectPrevious() {
      select(indexRef.current - 1);
    },
    selectNext() {
      select(indexRef.current + 1);
    },
    cancel
  };
}

function resistedOffset(
  deltaX: number,
  index: number,
  count: number
): number {
  const atStart = index <= 0 && deltaX > 0;
  const atEnd = index >= count - 1 && deltaX < 0;
  return atStart || atEnd ? deltaX * EDGE_RESISTANCE : deltaX;
}

function hasCarouselOptOut(target: unknown): boolean {
  return target instanceof Element &&
    target.closest("[data-no-carousel]") !== null;
}

function capturePointer(
  target: CarouselPointerTarget,
  pointerId: number
): boolean {
  try {
    target.setPointerCapture?.(pointerId);
    return target.hasPointerCapture?.(pointerId) ?? true;
  } catch {
    return false;
  }
}

function finiteTime(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function useReducedMotion(): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      setMatches(query.matches);
    };
    query.addEventListener("change", update);
    return () => {
      query.removeEventListener("change", update);
    };
  }, []);
  return matches;
}

function releasePointer(
  target: CarouselPointerTarget,
  pointerId: number
): void {
  try {
    if (target.hasPointerCapture?.(pointerId) !== false) {
      target.releasePointerCapture?.(pointerId);
    }
  } catch {
    // Capture can be lost when Telegram deactivates the Mini App.
  }
}
