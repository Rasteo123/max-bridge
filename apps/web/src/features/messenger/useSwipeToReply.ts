import {
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type TouchEvent as ReactTouchEvent,
  useRef,
  useState
} from "react";

export const REPLY_THRESHOLD = 56;
export const REPLY_MAX = 84;
export const AXIS_LOCK_DISTANCE = 8;

type GestureAxis = "pending" | "horizontal" | "vertical";

type ReplyGesture = {
  /** Null for a gesture being followed through touch events. */
  pointerId: number | null;
  pointerType: string;
  element: HTMLElement;
  startX: number;
  startY: number;
  axis: GestureAxis;
  armed: boolean;
  captured: boolean;
  captureAttempted: boolean;
};

type ReplySwipeHandlers = Pick<
  JSX.IntrinsicElements["article"],
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onPointerLeave"
  | "onLostPointerCapture"
  | "onTouchStart"
  | "onTouchMove"
  | "onTouchEnd"
  | "onTouchCancel"
>;

export function useSwipeToReply(options: Readonly<{
  disabled: boolean;
  onReply(): void;
  onArmed?(): void;
}>): Readonly<{
  dragging: boolean;
  armed: boolean;
  style: CSSProperties;
  handlers: ReplySwipeHandlers;
  cancel(): void;
}> {
  const gestureRef = useRef<ReplyGesture | null>(null);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [armed, setArmed] = useState(false);

  function reset(): void {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture?.captured === true && gesture.pointerId !== null) {
      releasePointer(gesture.element, gesture.pointerId);
    }
    setDrag(0);
    setDragging(false);
    setArmed(false);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>): void {
    // Touch is followed through touch events instead: the WebView Telegram
    // embeds on Android does not deliver a usable pointer stream for it.
    if (isTouchPointer(event)) {
      return;
    }
    if (
      gestureRef.current !== null &&
      gestureRef.current.pointerId !== event.pointerId
    ) {
      reset();
      return;
    }
    if (
      options.disabled ||
      gestureRef.current !== null ||
      event.button !== 0 ||
      !event.isPrimary ||
      isIgnoredTarget(event.target)
    ) {
      return;
    }
    gestureRef.current = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      element: event.currentTarget,
      startX: event.clientX,
      startY: event.clientY,
      axis: "pending",
      armed: false,
      captured: false,
      captureAttempted: false
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = gestureRef.current;
    if (
      gesture === null ||
      gesture.pointerId === null ||
      gesture.pointerId !== event.pointerId
    ) {
      return;
    }
    if (!track(gesture, event.clientX, event.clientY)) {
      return;
    }
    if (!gesture.captureAttempted) {
      gesture.captureAttempted = true;
      gesture.captured = capturePointer(
        event.currentTarget,
        event.pointerId
      );
    }
    event.preventDefault();
  }

  /**
   * Advances a gesture towards the reply threshold. Returns whether the
   * gesture has settled on the horizontal axis and is now being dragged.
   */
  function track(
    gesture: ReplyGesture,
    clientX: number,
    clientY: number
  ): boolean {
    const deltaX = clientX - gesture.startX;
    const deltaY = clientY - gesture.startY;
    if (
      gesture.axis === "pending" &&
      Math.hypot(deltaX, deltaY) >= AXIS_LOCK_DISTANCE
    ) {
      gesture.axis = (
        deltaX < 0 &&
        Math.abs(deltaX) > Math.abs(deltaY)
      )
        ? "horizontal"
        : "vertical";
    }
    if (gesture.axis !== "horizontal") {
      return false;
    }
    const nextDrag = Math.max(-REPLY_MAX, Math.min(0, deltaX));
    const nextArmed = Math.abs(nextDrag) >= REPLY_THRESHOLD;
    if (nextArmed && !gesture.armed) {
      options.onArmed?.();
    }
    gesture.armed = nextArmed;
    setDrag(nextDrag);
    setDragging(true);
    setArmed(nextArmed);
    return true;
  }

  function onTouchStart(event: ReactTouchEvent<HTMLElement>): void {
    const touch = event.touches[0];
    if (
      options.disabled ||
      event.touches.length !== 1 ||
      touch === undefined ||
      gestureRef.current !== null ||
      isIgnoredTarget(event.target)
    ) {
      return;
    }
    gestureRef.current = {
      pointerId: null,
      pointerType: "touch",
      element: event.currentTarget,
      startX: touch.clientX,
      startY: touch.clientY,
      axis: "pending",
      armed: false,
      captured: false,
      captureAttempted: false
    };
  }

  function onTouchMove(event: ReactTouchEvent<HTMLElement>): void {
    const gesture = gestureRef.current;
    const touch = event.touches[0];
    if (
      gesture === null ||
      gesture.pointerId !== null ||
      touch === undefined
    ) {
      return;
    }
    track(gesture, touch.clientX, touch.clientY);
  }

  function onTouchEnd(): void {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== null) {
      return;
    }
    const shouldReply = gesture.axis === "horizontal" && gesture.armed;
    reset();
    if (shouldReply) {
      options.onReply();
    }
  }

  function onTouchCancel(): void {
    if (gestureRef.current?.pointerId === null) {
      reset();
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = gestureRef.current;
    if (
      gesture === null ||
      gesture.pointerId === null ||
      gesture.pointerId !== event.pointerId
    ) {
      return;
    }
    const shouldReply = gesture.axis === "horizontal" && gesture.armed;
    reset();
    if (shouldReply) {
      options.onReply();
    }
  }

  function onPointerCancel(event: ReactPointerEvent<HTMLElement>): void {
    if (gestureRef.current?.pointerId === event.pointerId) {
      reset();
    }
  }

  function onPointerLeave(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = gestureRef.current;
    if (
      gesture?.pointerId === event.pointerId &&
      gesture.pointerType === "mouse" &&
      !gesture.captured
    ) {
      reset();
    }
  }

  function onLostPointerCapture(
    event: ReactPointerEvent<HTMLElement>
  ): void {
    if (gestureRef.current?.pointerId === event.pointerId) {
      reset();
    }
  }

  return {
    dragging,
    armed,
    style: {
      "--reply-drag": `${String(drag)}px`
    } as CSSProperties,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onPointerLeave,
      onLostPointerCapture,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel
    },
    cancel: reset
  };
}

function isTouchPointer(event: ReactPointerEvent<HTMLElement>): boolean {
  return event.pointerType === "touch" && navigator.maxTouchPoints > 0;
}

function isIgnoredTarget(target: EventTarget): boolean {
  return target instanceof Element &&
    target.closest("[data-no-swipe]") !== null;
}

function capturePointer(element: HTMLElement, pointerId: number): boolean {
  if (typeof element.setPointerCapture !== "function") {
    return false;
  }
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}

function releasePointer(element: HTMLElement, pointerId: number): void {
  if (typeof element.releasePointerCapture !== "function") {
    return;
  }
  try {
    if (
      typeof element.hasPointerCapture !== "function" ||
      element.hasPointerCapture(pointerId)
    ) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Pointer capture can disappear before the matching terminal event.
  }
}
