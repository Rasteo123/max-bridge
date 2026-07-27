import { useRef, useState } from "react";

export const MIN_MEDIA_SCALE = 1;
export const MAX_MEDIA_SCALE = 5;

const MEDIA_ZOOM_STEP = 0.25;
const TOGGLE_MEDIA_SCALE = 2;
const WHEEL_ZOOM_SENSITIVITY = 0.002;

export type MediaPoint = Readonly<{
  x: number;
  y: number;
}>;

export type MediaTransform = Readonly<{
  scale: number;
  x: number;
  y: number;
}>;

export type MediaTransformBounds = Readonly<{
  viewportWidth: number;
  viewportHeight: number;
  mediaWidth: number;
  mediaHeight: number;
}>;

type TransformBounds = MediaTransformBounds & Readonly<{
  scale: number;
}>;

type MediaPointerTarget = Readonly<{
  setPointerCapture?(pointerId: number): void;
  releasePointerCapture?(pointerId: number): void;
  hasPointerCapture?(pointerId: number): boolean;
}>;

export type MediaPointerEvent = Readonly<{
  pointerId: number;
  clientX: number;
  clientY: number;
  button: number;
  currentTarget: MediaPointerTarget;
  preventDefault(): void;
}>;

export type MediaWheelEvent = Readonly<{
  deltaY: number;
  ctrlKey: boolean;
  preventDefault(): void;
}>;

export type MediaTransformControls = Readonly<{
  transform: MediaTransform;
  handlers: Readonly<{
    onPointerDown(event: MediaPointerEvent): void;
    onPointerMove(event: MediaPointerEvent): void;
    onPointerUp(event: MediaPointerEvent): void;
    onPointerCancel(event: MediaPointerEvent): void;
    onPointerLeave(event: MediaPointerEvent): void;
    onLostPointerCapture(event: MediaPointerEvent): void;
    onWheel(event: MediaWheelEvent): void;
  }>;
  zoomIn(): void;
  zoomOut(): void;
  toggleZoom(): void;
  reset(): void;
}>;

type PinchGesture = Readonly<{
  initialDistance: number;
  initialScale: number;
}>;

export function clampScale(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_MEDIA_SCALE;
  }
  return Math.min(MAX_MEDIA_SCALE, Math.max(MIN_MEDIA_SCALE, value));
}

export function scaleFromWheel(
  currentScale: number,
  deltaY: number,
  ctrlKey: boolean
): number {
  const safeScale = clampScale(currentScale);
  if (!ctrlKey || !Number.isFinite(deltaY) || deltaY === 0) {
    return safeScale;
  }
  return clampScale(
    safeScale * Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY)
  );
}

export function pinchScale(
  initialScale: number,
  initialDistance: number,
  currentDistance: number
): number {
  const safeScale = clampScale(initialScale);
  if (
    !Number.isFinite(initialDistance) ||
    !Number.isFinite(currentDistance) ||
    initialDistance <= 0 ||
    currentDistance < 0
  ) {
    return safeScale;
  }
  return clampScale(safeScale * currentDistance / initialDistance);
}

export function clampTranslation(
  translation: MediaPoint,
  bounds: TransformBounds
): MediaPoint {
  const scale = clampScale(bounds.scale);
  const mediaWidth = finiteNonNegative(bounds.mediaWidth);
  const mediaHeight = finiteNonNegative(bounds.mediaHeight);
  const viewportWidth = finiteNonNegative(bounds.viewportWidth);
  const viewportHeight = finiteNonNegative(bounds.viewportHeight);
  if (
    scale <= MIN_MEDIA_SCALE ||
    mediaWidth === 0 ||
    mediaHeight === 0 ||
    viewportWidth === 0 ||
    viewportHeight === 0
  ) {
    return { x: 0, y: 0 };
  }

  const maxX = Math.max(0, (mediaWidth * scale - viewportWidth) / 2);
  const maxY = Math.max(0, (mediaHeight * scale - viewportHeight) / 2);
  return {
    x: clampFinite(translation.x, -maxX, maxX),
    y: clampFinite(translation.y, -maxY, maxY)
  };
}

export function resetMediaTransform(): MediaTransform {
  return { scale: MIN_MEDIA_SCALE, x: 0, y: 0 };
}

export function useMediaTransform(
  bounds: MediaTransformBounds
): MediaTransformControls {
  const activePointers = useRef(new Map<number, MediaPoint>());
  const capturedPointers = useRef(new Map<number, MediaPointerTarget>());
  const pinchGesture = useRef<PinchGesture | null>(null);
  const transformRef = useRef<MediaTransform>(resetMediaTransform());
  const [transform, setTransform] = useState<MediaTransform>(
    transformRef.current
  );

  function commitTransform(next: MediaTransform): void {
    transformRef.current = next;
    setTransform(next);
  }

  function setScale(nextScale: number): void {
    const scale = clampScale(nextScale);
    const translation = clampTranslation(transformRef.current, {
      scale,
      ...bounds
    });
    commitTransform({ scale, ...translation });
  }

  function onPointerDown(event: MediaPointerEvent): void {
    if (
      event.button !== 0 ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      return;
    }
    activePointers.current.set(event.pointerId, pointFromEvent(event));
    if (capturePointer(event.currentTarget, event.pointerId)) {
      capturedPointers.current.set(event.pointerId, event.currentTarget);
    }

    rebasePinch();
  }

  function onPointerMove(event: MediaPointerEvent): void {
    const previous = activePointers.current.get(event.pointerId);
    if (
      previous === undefined ||
      !Number.isFinite(event.clientX) ||
      !Number.isFinite(event.clientY)
    ) {
      return;
    }
    const current = pointFromEvent(event);
    activePointers.current.set(event.pointerId, current);

    if (activePointers.current.size === 2 && pinchGesture.current !== null) {
      const [first, second] = activePointers.current.values();
      if (first === undefined || second === undefined) {
        return;
      }
      event.preventDefault();
      setScale(pinchScale(
        pinchGesture.current.initialScale,
        pinchGesture.current.initialDistance,
        distance(first, second)
      ));
      return;
    }

    if (
      activePointers.current.size !== 1 ||
      transformRef.current.scale <= MIN_MEDIA_SCALE
    ) {
      return;
    }
    event.preventDefault();
    const translation = clampTranslation({
      x: transformRef.current.x + current.x - previous.x,
      y: transformRef.current.y + current.y - previous.y
    }, {
      scale: transformRef.current.scale,
      ...bounds
    });
    commitTransform({
      scale: transformRef.current.scale,
      ...translation
    });
  }

  function finishPointer(event: MediaPointerEvent): void {
    if (!activePointers.current.has(event.pointerId)) {
      return;
    }
    activePointers.current.delete(event.pointerId);
    const capturedTarget = capturedPointers.current.get(event.pointerId);
    capturedPointers.current.delete(event.pointerId);
    if (capturedTarget !== undefined) {
      releasePointer(capturedTarget, event.pointerId);
    }
    rebasePinch();
  }

  function onPointerLeave(event: MediaPointerEvent): void {
    if (
      !activePointers.current.has(event.pointerId) ||
      capturedPointers.current.has(event.pointerId)
    ) {
      return;
    }
    activePointers.current.delete(event.pointerId);
    rebasePinch();
  }

  function onLostPointerCapture(event: MediaPointerEvent): void {
    if (!activePointers.current.has(event.pointerId)) {
      return;
    }
    activePointers.current.delete(event.pointerId);
    capturedPointers.current.delete(event.pointerId);
    rebasePinch();
  }

  function onWheel(event: MediaWheelEvent): void {
    if (
      !event.ctrlKey ||
      !Number.isFinite(event.deltaY) ||
      event.deltaY === 0
    ) {
      return;
    }
    event.preventDefault();
    const scale = scaleFromWheel(
      transformRef.current.scale,
      event.deltaY,
      event.ctrlKey
    );
    if (scale === transformRef.current.scale) {
      return;
    }
    setScale(scale);
  }

  function reset(): void {
    for (const [pointerId, target] of capturedPointers.current) {
      releasePointer(target, pointerId);
    }
    activePointers.current.clear();
    capturedPointers.current.clear();
    pinchGesture.current = null;
    commitTransform(resetMediaTransform());
  }

  function rebasePinch(): void {
    if (activePointers.current.size !== 2) {
      pinchGesture.current = null;
      return;
    }
    const [first, second] = activePointers.current.values();
    if (first === undefined || second === undefined) {
      pinchGesture.current = null;
      return;
    }
    pinchGesture.current = {
      initialDistance: distance(first, second),
      initialScale: transformRef.current.scale
    };
  }

  return {
    transform,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finishPointer,
      onPointerCancel: finishPointer,
      onPointerLeave,
      onLostPointerCapture,
      onWheel
    },
    zoomIn() {
      setScale(transformRef.current.scale + MEDIA_ZOOM_STEP);
    },
    zoomOut() {
      setScale(transformRef.current.scale - MEDIA_ZOOM_STEP);
    },
    toggleZoom() {
      if (transformRef.current.scale > MIN_MEDIA_SCALE) {
        reset();
      } else {
        setScale(TOGGLE_MEDIA_SCALE);
      }
    },
    reset
  };
}

function pointFromEvent(event: MediaPointerEvent): MediaPoint {
  return { x: event.clientX, y: event.clientY };
}

function distance(first: MediaPoint, second: MediaPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function clampFinite(value: number, min: number, max: number): number {
  if (!Number.isFinite(value) || max === 0) {
    return 0;
  }
  return Math.min(max, Math.max(min, value));
}

function capturePointer(
  target: MediaPointerTarget,
  pointerId: number
): boolean {
  if (target.setPointerCapture === undefined) {
    return false;
  }
  try {
    target.setPointerCapture(pointerId);
    return target.hasPointerCapture?.(pointerId) ?? true;
  } catch {
    // Pointer capture is an enhancement and can be unavailable in WebViews.
    return false;
  }
}

function releasePointer(target: MediaPointerTarget, pointerId: number): void {
  try {
    if (
      target.hasPointerCapture === undefined ||
      target.hasPointerCapture(pointerId)
    ) {
      target.releasePointerCapture?.(pointerId);
    }
  } catch {
    // Capture can disappear before a terminal pointer event is delivered.
  }
}
