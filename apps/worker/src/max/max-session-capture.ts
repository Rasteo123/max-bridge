import type { Page } from "playwright";

export const MAX_SESSION_ACCESSOR_KEY =
  "maxbridge.max-session-accessor.v1";

export async function installMaxSessionCapture(page: Page): Promise<void> {
  await page.addInitScript(captureMaxSessionContext, MAX_SESSION_ACCESSOR_KEY);
}

export function captureMaxSessionContext(accessorKey: string): void {
  const candidates: Array<() => unknown> = [];
  const accessorSymbol = Symbol.for(accessorKey);
  const originalSet = Object.getOwnPropertyDescriptor(
    Map.prototype,
    "set"
  )?.value as typeof Map.prototype.set;

  Object.defineProperty(globalThis, accessorSymbol, {
    configurable: false,
    enumerable: false,
    value: () => {
      for (let index = candidates.length - 1; index >= 0; index -= 1) {
        try {
          const value = candidates[index]?.();
          if (
            value !== null
            && typeof value === "object"
            && "viewer" in value
          ) {
            return value;
          }
        } catch {
          // Ignore stale contexts left behind during MAX navigation.
        }
      }
      return undefined;
    },
    writable: false
  });

  Map.prototype.set = function set(
    key: unknown,
    value: unknown
  ): Map<unknown, unknown> {
    if (
      key !== null
      && typeof key === "object"
      && typeof value === "function"
    ) {
      try {
        const source = Function.prototype.toString.call(value);
        if (
          source.includes("viewer")
          && source.includes("sessionConfig")
          && source.includes("serverConfig")
        ) {
          candidates.push(value as () => unknown);
          Map.prototype.set = originalSet;
        }
      } catch {
        // Preserve normal Map behavior if a callable cannot be inspected.
      }
    }
    return originalSet.call(this, key, value);
  };
}
