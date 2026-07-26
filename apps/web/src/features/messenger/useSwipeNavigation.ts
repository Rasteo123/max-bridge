import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  useRef,
  useState
} from "react";

import type { MessengerPane } from "./types.js";

type SwipeNavigationOptions = Readonly<{
  pane: MessengerPane;
  setPane(pane: MessengerPane): void;
  disabled: boolean;
}>;

type GestureAxis = "pending" | "horizontal" | "vertical";

type Gesture = {
  pointerId: number;
  startX: number;
  startY: number;
  lastX: number;
  startedAt: number;
  axis: GestureAxis;
};

export type SwipeNavigation = Readonly<{
  dragging: boolean;
  trackStyle: CSSProperties;
  onPointerDown(event: ReactPointerEvent<HTMLElement>): void;
  onPointerMove(event: ReactPointerEvent<HTMLElement>): void;
  onPointerUp(event: ReactPointerEvent<HTMLElement>): void;
  onPointerCancel(event: ReactPointerEvent<HTMLElement>): void;
  onWheel(event: ReactWheelEvent<HTMLElement>): void;
  onClickCapture(event: ReactMouseEvent<HTMLElement>): void;
}>;

const EDGE_WIDTH_PX = 32;
const DIRECTION_LOCK_PX = 8;
const MIN_FAST_DISTANCE_PX = 28;
const VELOCITY_THRESHOLD_PX_MS = 0.5;

export function useSwipeNavigation({
  pane,
  setPane,
  disabled
}: SwipeNavigationOptions): SwipeNavigation {
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);

  function onPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (
      disabled ||
      event.button !== 0 ||
      !event.isPrimary ||
      isIgnoredTarget(event.target) ||
      (pane === "conversation" && event.clientX > EDGE_WIDTH_PX)
    ) {
      return;
    }
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      startedAt: event.timeStamp,
      axis: "pending"
    };
    suppressClick.current = false;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    current.lastX = event.clientX;
    if (
      current.axis === "pending" &&
      Math.hypot(deltaX, deltaY) >= DIRECTION_LOCK_PX
    ) {
      current.axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.15
        ? "horizontal"
        : "vertical";
    }
    if (current.axis !== "horizontal") {
      return;
    }
    event.preventDefault();
    suppressClick.current = true;
    setDragging(true);
    setOffset(directionOffset(pane, deltaX));
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - current.startX;
    const duration = Math.max(1, event.timeStamp - current.startedAt);
    const velocity = Math.abs(deltaX) / duration;
    const width = event.currentTarget.getBoundingClientRect().width ||
      window.innerWidth;
    const distanceThreshold = Math.min(
      110,
      Math.max(56, width * 0.18)
    );
    const correctDirection = pane === "conversation"
      ? deltaX > 0
      : deltaX < 0;
    if (
      current.axis === "horizontal" &&
      correctDirection &&
      (
        Math.abs(deltaX) >= distanceThreshold ||
        (
          Math.abs(deltaX) >= MIN_FAST_DISTANCE_PX &&
          velocity >= VELOCITY_THRESHOLD_PX_MS
        )
      )
    ) {
      setPane(pane === "conversation" ? "list" : "conversation");
    }
    resetGesture();
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    if (gesture.current?.pointerId === event.pointerId) {
      resetGesture();
    }
  }

  function onWheel(event: ReactWheelEvent<HTMLElement>) {
    if (
      disabled ||
      Math.abs(event.deltaX) <= Math.abs(event.deltaY) * 1.2 ||
      Math.abs(event.deltaX) < 48
    ) {
      return;
    }
    if (pane === "conversation" && event.deltaX < 0) {
      setPane("list");
    } else if (pane === "list" && event.deltaX > 0) {
      setPane("conversation");
    }
  }

  function onClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (suppressClick.current) {
      event.preventDefault();
      event.stopPropagation();
      suppressClick.current = false;
    }
  }

  function resetGesture() {
    gesture.current = null;
    setOffset(0);
    setDragging(false);
  }

  return {
    dragging,
    trackStyle: {
      "--swipe-offset": `${String(offset)}px`
    } as CSSProperties,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onWheel,
    onClickCapture
  };
}

function directionOffset(
  pane: MessengerPane,
  deltaX: number
): number {
  if (pane === "conversation") {
    return Math.max(0, deltaX);
  }
  return Math.min(0, deltaX);
}

function isIgnoredTarget(target: EventTarget): boolean {
  return target instanceof Element &&
    target.closest("[data-no-swipe], input, textarea, select") !== null;
}
