import { describe, expect, it } from "vitest";

import { BrowserPool } from "./browser-pool.js";
import { PlaywrightBrowserFactory } from "./playwright-browser-factory.js";

const runBrowserSmoke = process.env["RUN_BROWSER_SMOKE"] === "1";

describe.runIf(runBrowserSmoke)("real Chromium pool smoke", () => {
  it("opens and closes ten isolated contexts in three browsers", async () => {
    const pool = new BrowserPool({
      factory: new PlaywrightBrowserFactory()
    });

    await pool.start();
    try {
      for (let index = 0; index < 10; index += 1) {
        await pool.openSession(
          `s_${index.toString(36).padStart(22, "A")}`
        );
      }
      expect(pool.slotLoads()).toEqual([4, 3, 3]);
      expect(pool.sessionCount).toBe(10);
    } finally {
      await pool.close();
    }
  }, 60_000);
});
