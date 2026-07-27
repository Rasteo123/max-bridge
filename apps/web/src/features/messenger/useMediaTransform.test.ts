// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  clampScale,
  clampTranslation,
  pinchScale,
  resetMediaTransform,
  scaleFromWheel,
  useMediaTransform
} from "./useMediaTransform.js";

const bounds = {
  viewportWidth: 300,
  viewportHeight: 400,
  mediaWidth: 300,
  mediaHeight: 200
};

describe("media transform helpers", () => {
  it("clamps scale to the supported range and rejects non-finite values", () => {
    expect(clampScale(0.5)).toBe(1);
    expect(clampScale(8)).toBe(5);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(1);
  });

  it("uses only control-modified vertical wheel movement for zoom", () => {
    expect(scaleFromWheel(2, -100, true)).toBeGreaterThan(2);
    expect(scaleFromWheel(2, 100, true)).toBeLessThan(2);
    expect(scaleFromWheel(2, -100, false)).toBe(2);
    expect(scaleFromWheel(2, Number.NaN, true)).toBe(2);
  });

  it("derives a bounded pinch scale from pointer distance", () => {
    expect(pinchScale(2, 100, 150)).toBe(3);
    expect(pinchScale(2, 0, 150)).toBe(2);
    expect(pinchScale(2, 100, Number.NaN)).toBe(2);
  });

  it("clamps translation to the scaled media overflow", () => {
    expect(clampTranslation({ x: 500, y: -500 }, {
      scale: 2,
      ...bounds
    })).toEqual({ x: 150, y: 0 });
    expect(clampTranslation({ x: 40, y: 40 }, {
      scale: 1,
      ...bounds
    })).toEqual({ x: 0, y: 0 });
    expect(clampTranslation({ x: Number.NaN, y: Number.POSITIVE_INFINITY }, {
      scale: 2,
      ...bounds
    })).toEqual({ x: 0, y: 0 });
  });

  it("does not create blank space when scaled media is smaller than the viewport", () => {
    expect(clampTranslation({ x: 100, y: -100 }, {
      scale: 2,
      viewportWidth: 300,
      viewportHeight: 400,
      mediaWidth: 100,
      mediaHeight: 100
    })).toEqual({ x: 0, y: 0 });
    expect(clampTranslation({ x: 500, y: -500 }, {
      scale: 2,
      viewportWidth: 300,
      viewportHeight: 400,
      mediaWidth: 400,
      mediaHeight: 300
    })).toEqual({ x: 250, y: -100 });
  });

  it("returns a fresh identity transform when reset", () => {
    expect(resetMediaTransform()).toEqual({ scale: 1, x: 0, y: 0 });
    expect(resetMediaTransform()).not.toBe(resetMediaTransform());
  });
});

describe("useMediaTransform", () => {
  it("exposes deterministic zoom, toggle, and reset controls", () => {
    const { result } = renderHook(() => useMediaTransform(bounds));

    act(() => {
      result.current.zoomIn();
    });
    expect(result.current.transform).toEqual({ scale: 1.25, x: 0, y: 0 });

    act(() => {
      result.current.zoomOut();
    });
    expect(result.current.transform).toEqual({ scale: 1, x: 0, y: 0 });

    act(() => {
      result.current.toggleZoom();
    });
    expect(result.current.transform.scale).toBe(2);

    act(() => {
      result.current.toggleZoom();
    });
    expect(result.current.transform).toEqual({ scale: 1, x: 0, y: 0 });

    act(() => {
      result.current.zoomIn();
      result.current.reset();
    });
    expect(result.current.transform).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("zooms for control-wheel and leaves ordinary wheel events alone", () => {
    const { result } = renderHook(() => useMediaTransform(bounds));
    const ordinary = wheelEvent(-100, false);
    const pinch = wheelEvent(-100, true);

    act(() => {
      result.current.handlers.onWheel(ordinary);
    });
    expect(result.current.transform.scale).toBe(1);
    expect(ordinary.preventDefault).not.toHaveBeenCalled();

    act(() => {
      result.current.handlers.onWheel(pinch);
    });
    expect(result.current.transform.scale).toBeGreaterThan(1);
    expect(pinch.preventDefault).toHaveBeenCalledOnce();
  });

  it("consumes every finite nonzero control-wheel gesture at scale limits", () => {
    const { result } = renderHook(() => useMediaTransform(bounds));
    const belowMinimum = wheelEvent(100, true);
    const zeroDelta = wheelEvent(0, true);
    const invalidDelta = wheelEvent(Number.NaN, true);

    act(() => {
      result.current.handlers.onWheel(belowMinimum);
      result.current.handlers.onWheel(zeroDelta);
      result.current.handlers.onWheel(invalidDelta);
    });
    expect(result.current.transform.scale).toBe(1);
    expect(belowMinimum.preventDefault).toHaveBeenCalledOnce();
    expect(zeroDelta.preventDefault).not.toHaveBeenCalled();
    expect(invalidDelta.preventDefault).not.toHaveBeenCalled();

    act(() => {
      for (let index = 0; index < 16; index += 1) {
        result.current.zoomIn();
      }
    });
    expect(result.current.transform.scale).toBe(5);

    const aboveMaximum = wheelEvent(-100, true);
    act(() => {
      result.current.handlers.onWheel(aboveMaximum);
    });
    expect(result.current.transform.scale).toBe(5);
    expect(aboveMaximum.preventDefault).toHaveBeenCalledOnce();
  });

  it("pans one pointer only while zoomed and clamps the translation", () => {
    const { result } = renderHook(() => useMediaTransform(bounds));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent(1, 100, 100));
      result.current.handlers.onPointerMove(pointerEvent(1, 180, 180));
    });
    expect(result.current.transform).toEqual({ scale: 1, x: 0, y: 0 });

    act(() => {
      result.current.toggleZoom();
    });
    act(() => {
      result.current.handlers.onPointerDown(pointerEvent(1, 100, 100));
      result.current.handlers.onPointerMove(pointerEvent(1, 500, -500));
    });
    expect(result.current.transform).toEqual({
      scale: 2,
      x: 150,
      y: 0
    });

    act(() => {
      result.current.handlers.onPointerUp(pointerEvent(1, 500, -500));
    });
  });

  it("tracks two active pointers for pinch and continues panning after release", () => {
    const { result } = renderHook(() => useMediaTransform(bounds));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent(1, 100, 100));
      result.current.handlers.onPointerDown(pointerEvent(2, 200, 100));
      result.current.handlers.onPointerMove(pointerEvent(2, 250, 100));
    });
    expect(result.current.transform.scale).toBe(1.5);

    act(() => {
      result.current.handlers.onPointerUp(pointerEvent(2, 250, 100));
    });
    act(() => {
      result.current.handlers.onPointerMove(pointerEvent(1, 120, 110));
    });
    expect(result.current.transform.x).toBe(20);
    expect(result.current.transform.y).toBe(0);
  });

  it("cancels stale pointer state on reset and does not add global listeners", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { result, unmount } = renderHook(() => useMediaTransform(bounds));

    act(() => {
      result.current.handlers.onPointerDown(pointerEvent(1, 10, 10));
      result.current.handlers.onPointerDown(pointerEvent(2, 110, 10));
      result.current.reset();
      result.current.handlers.onPointerMove(pointerEvent(2, 210, 10));
    });
    expect(result.current.transform).toEqual({ scale: 1, x: 0, y: 0 });

    unmount();
    expect(addSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it("drops an uncaptured pointer when it leaves the media", () => {
    const { result } = renderHook(() => useMediaTransform(bounds));
    const captureFailure = pointerTarget(() => {
      throw new Error("capture unavailable");
    });

    act(() => {
      result.current.handlers.onPointerDown(
        pointerEvent(1, 10, 10, captureFailure)
      );
      result.current.handlers.onPointerLeave(
        pointerEvent(1, 20, 10, captureFailure)
      );
      result.current.handlers.onPointerDown(pointerEvent(2, 100, 10));
      result.current.handlers.onPointerMove(pointerEvent(2, 250, 10));
    });

    expect(result.current.transform).toEqual({ scale: 1, x: 0, y: 0 });
  });

  it("rebases active pointers after pointer capture is lost", () => {
    const { result } = renderHook(() => useMediaTransform(bounds));
    const captured = pointerTarget();

    act(() => {
      result.current.handlers.onPointerDown(
        pointerEvent(1, 10, 10, captured)
      );
      result.current.handlers.onLostPointerCapture(
        pointerEvent(1, 20, 10, captured)
      );
      result.current.handlers.onPointerDown(pointerEvent(2, 100, 10));
      result.current.handlers.onPointerMove(pointerEvent(2, 250, 10));
    });

    expect(result.current.transform).toEqual({ scale: 1, x: 0, y: 0 });
  });
});

function pointerEvent(
  pointerId: number,
  clientX: number,
  clientY: number,
  currentTarget = pointerTarget()
) {
  return {
    pointerId,
    clientX,
    clientY,
    button: 0,
    currentTarget,
    preventDefault: vi.fn()
  };
}

function pointerTarget(
  setPointerCapture: (pointerId: number) => void = vi.fn()
) {
  return {
    setPointerCapture: vi.fn(setPointerCapture),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true)
  };
}

function wheelEvent(deltaY: number, ctrlKey: boolean) {
  return {
    deltaY,
    ctrlKey,
    preventDefault: vi.fn()
  };
}
