import { describe, expect, it } from "vitest";

import { BrowserPool } from "../../apps/worker/src/pool/browser-pool.js";
import type {
  BrowserFactory,
  BrowserProcess,
  ManagedBrowserContext
} from "../../apps/worker/src/pool/browser-slot.js";

describe("ten active sessions", () => {
  it("keeps ten users bounded across three Chromium processes", async () => {
    const factory = new LoadFactory();
    const pool = new BrowserPool({ factory });
    await pool.start();

    await Promise.all(Array.from({ length: 10 }, async (_, index) =>
      pool.openSession(`s_${index.toString(36).padStart(22, "B")}`)
    ));

    expect(factory.processes).toBe(3);
    expect(pool.sessionCount).toBe(10);
    expect(pool.slotLoads()).toEqual([4, 3, 3]);
    await pool.close();
  });
});

class LoadFactory implements BrowserFactory {
  processes = 0;

  launch(): Promise<BrowserProcess> {
    this.processes += 1;
    return Promise.resolve({
      newContext: () => Promise.resolve<ManagedBrowserContext>({
        close: () => Promise.resolve()
      }),
      onDisconnected: () => {},
      close: () => Promise.resolve()
    });
  }
}
