import { useSyncExternalStore } from "react";

export type BackHandler = () => void;

// Overlays (media viewer, profile, pickers) register here so the Telegram back
// button dismisses the topmost one instead of navigating the pane underneath.
const stack: BackHandler[] = [];
const subscribers = new Set<() => void>();

function notify(): void {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

export function pushBackHandler(handler: BackHandler): () => void {
  stack.push(handler);
  notify();
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const index = stack.lastIndexOf(handler);
    if (index >= 0) {
      stack.splice(index, 1);
    }
    notify();
  };
}

export function runTopBackHandler(): boolean {
  const top = stack[stack.length - 1];
  if (top === undefined) {
    return false;
  }
  top();
  return true;
}

export function backHandlerDepth(): number {
  return stack.length;
}

function subscribe(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}

export function useBackHandlerDepth(): number {
  return useSyncExternalStore(subscribe, backHandlerDepth, backHandlerDepth);
}

export function resetBackHandlers(): void {
  stack.length = 0;
  notify();
}
