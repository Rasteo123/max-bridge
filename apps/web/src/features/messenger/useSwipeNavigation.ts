import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
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
  pointerId: number | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  offset: number;
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
  onTouchStart(event: ReactTouchEvent<HTMLElement>): void;
  onTouchMove(event: ReactTouchEvent<HTMLElement>): void;
  onTouchEnd(event: ReactTouchEvent<HTMLElement>): void;
  onTouchCancel(event: ReactTouchEvent<HTMLElement>): void;
  onWheel(event: ReactWheelEvent<HTMLElement>): void;
  onClickCapture(event: ReactMouseEvent<HTMLElement>): void;
}>;

const DIRECTION_LOCK_PX = 8;
const MIN_FAST_DISTANCE_PX = 28;
const VELOCITY_THRESHOLD_PX_MS = 0.5;
const MAX_OVERSCROLL_RATIO = 1;

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
      (event.pointerType === "mouse" && event.button !== 0) ||
      (
        event.pointerType === "touch" &&
        navigator.maxTouchPoints > 0
      ) ||
      !event.isPrimary ||
      isIgnoredTarget(event.target) ||
      gesture.current !== null
    ) {
      return;
    }
    gesture.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      offset: 0,
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
    current.lastY = event.clientY;
    if (
      current.axis === "pending" &&
      Math.hypot(deltaX, deltaY) >= DIRECTION_LOCK_PX
    ) {
      current.axis = Math.abs(deltaX) > Math.abs(deltaY)
        ? "horizontal"
        : "vertical";
    }
    if (current.axis !== "horizontal") {
      return;
    }
    capturePointer(event.currentTarget, event.pointerId);
    event.preventDefault();
    suppressClick.current = true;
    setDragging(true);
    const width = event.currentTarget.getBoundingClientRect().width ||
      window.innerWidth;
    current.offset = clampOffset(
      pane,
      deltaX,
      width * MAX_OVERSCROLL_RATIO
    );
    setOffset(current.offset);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (current === null || current.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = current.lastX - current.startX;
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
    releasePointer(event.currentTarget, event.pointerId);
    resetGesture();
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
    if (gesture.current?.pointerId === event.pointerId) {
      releasePointer(event.currentTarget, event.pointerId);
      resetGesture();
    }
  }

  function onTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (
      disabled ||
      event.touches.length !== 1 ||
      isIgnoredTarget(event.target) ||
      gesture.current !== null
    ) {
      return;
    }
    const touch = event.touches[0];
    if (touch === undefined) {
      return;
    }
    gesture.current = {
      pointerId: null,
      startX: touch.clientX,
      startY: touch.clientY,
      lastX: touch.clientX,
      lastY: touch.clientY,
      offset: 0,
      startedAt: event.timeStamp,
      axis: "pending"
    };
    suppressClick.current = false;
  }

  function onTouchMove(event: ReactTouchEvent<HTMLElement>) {
    const current = gesture.current;
    const touch = event.touches[0];
    if (
      current === null ||
      current.pointerId !== null ||
      touch === undefined
    ) {
      return;
    }
    updateGesture(
      current,
      touch.clientX,
      touch.clientY,
      event.currentTarget.getBoundingClientRect().width || window.innerWidth
    );
    if (current.axis === "horizontal") {
      event.preventDefault();
      suppressClick.current = true;
      setDragging(true);
      setOffset(current.offset);
    }
  }

  function onTouchEnd(event: ReactTouchEvent<HTMLElement>) {
    const current = gesture.current;
    if (current === null || current.pointerId !== null) {
      return;
    }
    finishGesture(
      current,
      event.timeStamp,
      event.currentTarget.getBoundingClientRect().width || window.innerWidth
    );
    resetGesture();
  }

  function onTouchCancel() {
    if (gesture.current?.pointerId === null) {
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
      "--swipe-offset": `${String(offset)}px`,
      "--swipe-progress": String(swipeProgress(offset))
    } as CSSProperties,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
    onWheel,
    onClickCapture
  };

  function updateGesture(
    current: Gesture,
    clientX: number,
    clientY: number,
    width: number
  ) {
    const deltaX = clientX - current.startX;
    const deltaY = clientY - current.startY;
    current.lastX = clientX;
    current.lastY = clientY;
    if (
      current.axis === "pending" &&
      Math.hypot(deltaX, deltaY) >= DIRECTION_LOCK_PX
    ) {
      current.axis = Math.abs(deltaX) > Math.abs(deltaY)
        ? "horizontal"
        : "vertical";
    }
    if (current.axis === "horizontal") {
      current.offset = clampOffset(
        pane,
        deltaX,
        width * MAX_OVERSCROLL_RATIO
      );
    }
  }

  function finishGesture(
    current: Gesture,
    timeStamp: number,
    width: number
  ) {
    const deltaX = current.lastX - current.startX;
    const duration = Math.max(1, timeStamp - current.startedAt);
    const velocity = Math.abs(deltaX) / duration;
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
  }
}

function clampOffset(
  pane: MessengerPane,
  deltaX: number,
  width: number
): number {
  const limit = Math.max(1, width);
  if (pane === "conversation") {
    return Math.min(limit, Math.max(0, deltaX));
  }
  return Math.max(-limit, Math.min(0, deltaX));
}

function swipeProgress(offset: number): number {
  if (typeof window === "undefined") {
    return 0;
  }
  return Math.min(
    1,
    Math.abs(offset) / Math.max(1, window.innerWidth)
  );
}

function capturePointer(element: HTMLElement, pointerId: number): void {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // Some embedded WebViews expose Pointer Events without capture support.
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // The browser may release capture before pointerup/pointercancel.
  }
}

function isIgnoredTarget(target: EventTarget): boolean {
  return target instanceof Element &&
    target.closest("[data-no-swipe], input, textarea, select") !== null;
}
