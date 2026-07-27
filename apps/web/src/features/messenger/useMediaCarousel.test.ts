// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useMediaCarousel } from "./useMediaCarousel.js";

describe("useMediaCarousel", () => {
  it("follows the pointer and selects previous or next at 72 pixels", () => {
    const onSelect = vi.fn();
    const { result, rerender } = renderHook(
      ({ index }) => useMediaCarousel({
        index,
        count: 3,
        viewportWidth: 320,
        onSelect,
        reducedMotion: true
      }),
      { initialProps: { index: 1 } }
    );

    act(() => {
      result.current.handlers.onPointerDown(pointer(1, 100, 20, 0));
      result.current.handlers.onPointerMove(pointer(1, 172, 22, 100));
    });
    expect(result.current.offset).toBe(72);
    act(() => {
      result.current.handlers.onPointerUp(pointer(1, 172, 22, 120));
    });
    expect(onSelect).toHaveBeenLastCalledWith(0);

    rerender({ index: 1 });
    onSelect.mockClear();
    act(() => {
      result.current.handlers.onPointerDown(pointer(2, 172, 20, 200));
      result.current.handlers.onPointerMove(pointer(2, 100, 22, 300));
      result.current.handlers.onPointerUp(pointer(2, 100, 22, 320));
    });
    expect(onSelect).toHaveBeenLastCalledWith(2);
  });

  it("snaps back after a short drag and resists edge overscroll", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useMediaCarousel({
      index: 0,
      count: 3,
      viewportWidth: 320,
      onSelect,
      reducedMotion: true
    }));

    act(() => {
      result.current.handlers.onPointerDown(pointer(1, 100, 20, 0));
      result.current.handlers.onPointerMove(pointer(1, 132, 20, 100));
    });
    expect(result.current.offset).toBeGreaterThan(0);
    expect(result.current.offset).toBeLessThan(32);
    act(() => {
      result.current.handlers.onPointerUp(pointer(1, 132, 20, 120));
    });
    expect(result.current.offset).toBe(0);
    expect(onSelect).not.toHaveBeenCalled();

    act(() => {
      result.current.handlers.onPointerDown(pointer(2, 100, 20, 200));
      result.current.handlers.onPointerMove(pointer(2, 50, 20, 300));
      result.current.handlers.onPointerUp(pointer(2, 50, 20, 320));
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(result.current.offset).toBe(0);
  });

  it("accepts a bounded fast flick but rejects vertical intent", () => {
    const onSelect = vi.fn();
    const { result } = renderHook(() => useMediaCarousel({
      index: 1,
      count: 3,
      viewportWidth: 320,
      onSelect,
      reducedMotion: true
    }));

    act(() => {
      result.current.handlers.onPointerDown(pointer(1, 100, 20, 0));
      result.current.handlers.onPointerMove(pointer(1, 68, 21, 24));
      result.current.handlers.onPointerUp(pointer(1, 68, 21, 32));
    });
    expect(onSelect).toHaveBeenCalledWith(2);

    onSelect.mockClear();
    act(() => {
      result.current.handlers.onPointerDown(pointer(2, 100, 20, 100));
      result.current.handlers.onPointerMove(pointer(2, 90, 80, 120));
      result.current.handlers.onPointerUp(pointer(2, 20, 100, 140));
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(result.current.offset).toBe(0);
  });

  it("is disabled while a zoomed image owns the horizontal gesture", () => {
    const onSelect = vi.fn();
    const { result, rerender } = renderHook(
      ({ enabled }) => useMediaCarousel({
        index: 1,
        count: 3,
        viewportWidth: 320,
        enabled,
        onSelect,
        reducedMotion: true
      }),
      { initialProps: { enabled: false } }
    );

    act(() => {
      result.current.handlers.onPointerDown(pointer(1, 100, 20, 0));
      result.current.handlers.onPointerMove(pointer(1, 0, 20, 100));
      result.current.handlers.onPointerUp(pointer(1, 0, 20, 120));
    });
    expect(onSelect).not.toHaveBeenCalled();

    rerender({ enabled: true });
    act(() => {
      result.current.handlers.onPointerDown(pointer(2, 100, 20, 200));
      result.current.handlers.onPointerMove(pointer(2, 28, 20, 300));
      result.current.handlers.onPointerUp(pointer(2, 28, 20, 320));
    });
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("shares bounded previous and next actions with keyboard and buttons", () => {
    const onSelect = vi.fn();
    const { result, rerender } = renderHook(
      ({ index }) => useMediaCarousel({
        index,
        count: 3,
        viewportWidth: 320,
        onSelect,
        reducedMotion: true
      }),
      { initialProps: { index: 0 } }
    );

    act(() => {
      result.current.selectPrevious();
      result.current.selectNext();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1);

    rerender({ index: 2 });
    onSelect.mockClear();
    act(() => {
      result.current.selectNext();
      result.current.selectPrevious();
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

function pointer(
  pointerId: number,
  clientX: number,
  clientY: number,
  timeStamp: number
) {
  const currentTarget = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true)
  };
  return {
    pointerId,
    clientX,
    clientY,
    timeStamp,
    button: 0,
    isPrimary: true,
    target: { closest: vi.fn(() => null) },
    currentTarget,
    preventDefault: vi.fn()
  };
}
