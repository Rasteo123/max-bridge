import { describe, expect, it } from "vitest";

import { BrowserPool } from "../pool/browser-pool.js";
import type {
  BrowserFactory,
  BrowserProcess,
  ManagedBrowserContext
} from "../pool/browser-slot.js";

describe("worker session recovery", () => {
  it("drops only sessions from a crashed Chromium slot", async () => {
    const factory = new CrashFactory();
    const lost: string[][] = [];
    const pool = new BrowserPool({
      factory,
      onSessionsLost: (handles) => {
        lost.push([...handles]);
      }
    });
    await pool.start();
    for (let index = 0; index < 10; index += 1) {
      await pool.openSession(handle(index));
    }
    const affected = pool.handlesForSlot(1);

    factory.browsers[1]?.crash();
    await pool.waitForRecovery();

    expect(lost).toEqual([affected]);
    expect(pool.sessionCount).toBe(10 - affected.length);
    expect(pool.handlesForSlot(0)).not.toHaveLength(0);
    expect(pool.handlesForSlot(2)).not.toHaveLength(0);
    await pool.close();
  });
});

class CrashFactory implements BrowserFactory {
  readonly browsers: CrashBrowser[] = [];

  launch(): Promise<BrowserProcess> {
    const browser = new CrashBrowser();
    this.browsers.push(browser);
    return Promise.resolve(browser);
  }
}

class CrashBrowser implements BrowserProcess {
  private disconnected: (() => void) | undefined;

  newContext(): Promise<ManagedBrowserContext> {
    return Promise.resolve({
      close: () => Promise.resolve()
    });
  }

  onDisconnected(listener: () => void): void {
    this.disconnected = listener;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  crash(): void {
    this.disconnected?.();
  }
}

function handle(index: number): string {
  return `s_${index.toString(36).padStart(22, "A")}`;
}
