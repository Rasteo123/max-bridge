import { describe, expect, it } from "vitest";

import {
  BrowserPool,
  type BrowserPoolRecovery
} from "./browser-pool.js";
import {
  HealthMonitor
} from "./health-monitor.js";
import { FakeBrowserFactory } from "./browser-pool.test.js";

describe("HealthMonitor", () => {
  it("restarts the heaviest slot when total memory exceeds the limit", async () => {
    const recoveries: BrowserPoolRecovery[] = [];
    const pool = new BrowserPool({
      factory: new FakeBrowserFactory(),
      onRecovery: (recovery) => {
        recoveries.push(recovery);
      }
    });
    await pool.start();
    await pool.openSession("s_AAAAAAAAAAAAAAAAAAAAAA");
    await pool.openSession("s_BBBBBBBBBBBBBBBBBBBBBB");
    const monitor = new HealthMonitor({
      pool,
      memoryHighBytes: 2_200,
      sample: () => Promise.resolve([
        { slotId: 0, rssBytes: 1_500, healthy: true },
        { slotId: 1, rssBytes: 500, healthy: true },
        { slotId: 2, rssBytes: 500, healthy: true }
      ])
    });

    const result = await monitor.runOnce();

    expect(result.action).toBe("restarted");
    if (result.action === "none") {
      throw new Error("expected a restart");
    }
    expect(result.slotId).toBe(0);
    expect(recoveries[0]?.reason).toBe("memory_pressure");
    expect(recoveries[0]?.affectedHandles).toEqual(
      ["s_AAAAAAAAAAAAAAAAAAAAAA"]
    );
    await pool.close();
  });

  it("reports affected sessions when a health check fails", async () => {
    const pool = new BrowserPool({
      factory: new FakeBrowserFactory()
    });
    await pool.start();
    await pool.openSession("s_AAAAAAAAAAAAAAAAAAAAAA");
    const monitor = new HealthMonitor({
      pool,
      memoryHighBytes: 2_200,
      sample: () => Promise.resolve([
        { slotId: 0, rssBytes: 100, healthy: false },
        { slotId: 1, rssBytes: 100, healthy: true },
        { slotId: 2, rssBytes: 100, healthy: true }
      ])
    });

    const result = await monitor.runOnce();

    expect(result).toMatchObject({
      action: "restarted",
      slotId: 0,
      affectedHandles: ["s_AAAAAAAAAAAAAAAAAAAAAA"]
    });
    await pool.close();
  });

  it("does nothing when the pool is healthy and below the limit", async () => {
    const pool = new BrowserPool({
      factory: new FakeBrowserFactory()
    });
    await pool.start();
    const monitor = new HealthMonitor({
      pool,
      memoryHighBytes: 2_200,
      sample: () => Promise.resolve([
        { slotId: 0, rssBytes: 100, healthy: true },
        { slotId: 1, rssBytes: 100, healthy: true },
        { slotId: 2, rssBytes: 100, healthy: true }
      ])
    });

    await expect(monitor.runOnce()).resolves.toEqual({ action: "none" });
    await pool.close();
  });
});
