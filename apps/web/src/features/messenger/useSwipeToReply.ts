import {
  type CSSProperties,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState
} from "react";

export const REPLY_THRESHOLD = 56;
export const REPLY_MAX = 84;
export const AXIS_LOCK_DISTANCE = 8;

type GestureAxis = "pending" | "horizontal" | "vertical";

type ReplyGesture = {
  pointerId: number;
  startX: number;
  startY: number;
  axis: GestureAxis;
  armed: boolean;
};

type ReplySwipeHandlers = Pick<
  JSX.IntrinsicElements["article"],
  "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel"
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
    gestureRef.current = null;
    setDrag(0);
    setDragging(false);
    setArmed(false);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLElement>): void {
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
      startX: event.clientX,
      startY: event.clientY,
      axis: "pending",
      armed: false
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return;
    }
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
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
      return;
    }
    event.preventDefault();
    const nextDrag = Math.max(-REPLY_MAX, Math.min(0, deltaX));
    const nextArmed = Math.abs(nextDrag) >= REPLY_THRESHOLD;
    if (nextArmed && !gesture.armed) {
      options.onArmed?.();
    }
    gesture.armed = nextArmed;
    setDrag(nextDrag);
    setDragging(true);
    setArmed(nextArmed);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLElement>): void {
    const gesture = gestureRef.current;
    if (gesture === null || gesture.pointerId !== event.pointerId) {
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
      onPointerCancel
    },
    cancel: reset
  };
}

function isIgnoredTarget(target: EventTarget): boolean {
  return target instanceof Element &&
    target.closest("[data-no-swipe]") !== null;
}
