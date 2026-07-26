import { describe, expect, it } from "vitest";

import {
  BrowserPool,
  PoolCapacityError
} from "./browser-pool.js";
import type {
  BrowserFactory,
  BrowserProcess,
  ManagedBrowserContext
} from "./browser-slot.js";

describe("BrowserPool", () => {
  it("starts exactly three browser slots", async () => {
    const factory = new FakeBrowserFactory();
    const pool = new BrowserPool({ factory });

    await pool.start();

    expect(factory.browsers).toHaveLength(3);
    expect(pool.slotLoads()).toEqual([0, 0, 0]);
    await pool.close();
  });

  it("places ten sessions in least-loaded slots with max four", async () => {
    const factory = new FakeBrowserFactory();
    const pool = new BrowserPool({ factory });
    await pool.start();

    for (let index = 0; index < 10; index += 1) {
      await pool.openSession(`s_${handlePart(index)}`);
    }

    expect(pool.slotLoads()).toEqual([4, 3, 3]);
    expect(Math.max(...pool.slotLoads())).toBeLessThanOrEqual(4);
    expect(pool.sessionCount).toBe(10);
    await pool.close();
  });

  it("rejects a thirteenth context", async () => {
    const pool = new BrowserPool({
      factory: new FakeBrowserFactory()
    });
    await pool.start();
    for (let index = 0; index < 12; index += 1) {
      await pool.openSession(`s_${handlePart(index)}`);
    }

    await expect(pool.openSession(`s_${handlePart(12)}`))
      .rejects.toThrow(PoolCapacityError);
    await pool.close();
  });

  it("uses a unique context for every session", async () => {
    const pool = new BrowserPool({
      factory: new FakeBrowserFactory()
    });
    await pool.start();

    const first = await pool.openSession(`s_${handlePart(1)}`);
    const second = await pool.openSession(`s_${handlePart(2)}`);

    expect(first.context).not.toBe(second.context);
    await pool.close();
  });

  it("zeros the private storage-state copy after context creation", async () => {
    const factory = new FakeBrowserFactory();
    const pool = new BrowserPool({ factory });
    await pool.start();
    const storageState = new Uint8Array([1, 2, 3, 4]);

    await pool.openSession(`s_${handlePart(1)}`, storageState);

    expect(factory.lastObservedStorageState).toBeDefined();
    expect([...(factory.lastObservedStorageState ?? [])])
      .toEqual([0, 0, 0, 0]);
    expect([...storageState]).toEqual([1, 2, 3, 4]);
    await pool.close();
  });

  it("reports only affected sessions and recreates a crashed browser", async () => {
    const factory = new FakeBrowserFactory();
    const recoveries: string[][] = [];
    const pool = new BrowserPool({
      factory,
      onSessionsLost: (handles) => {
        recoveries.push([...handles]);
      }
    });
    await pool.start();
    for (let index = 0; index < 5; index += 1) {
      await pool.openSession(`s_${handlePart(index)}`);
    }
    const crashedHandles = pool.handlesForSlot(0);

    factory.browsers[0]?.crash();
    await pool.waitForRecovery();

    expect(recoveries).toEqual([crashedHandles]);
    expect(factory.browsers).toHaveLength(4);
    expect(pool.handlesForSlot(0)).toEqual([]);
    expect(pool.sessionCount).toBe(3);
    await pool.close();
  });
});

export class FakeBrowserFactory implements BrowserFactory {
  readonly browsers: FakeBrowser[] = [];
  lastObservedStorageState: Uint8Array | undefined;

  launch(slotId: number): Promise<BrowserProcess> {
    const browser = new FakeBrowser(slotId, (storageState) => {
      this.lastObservedStorageState = storageState;
    });
    this.browsers.push(browser);
    return Promise.resolve(browser);
  }
}

class FakeBrowser implements BrowserProcess {
  readonly contexts: FakeContext[] = [];
  private disconnectListener: (() => void) | undefined;

  constructor(
    readonly slotId: number,
    private readonly observeStorage: (value: Uint8Array) => void
  ) {}

  newContext(storageState?: Uint8Array): Promise<ManagedBrowserContext> {
    if (storageState !== undefined) {
      this.observeStorage(storageState);
    }
    const context = new FakeContext(
      `${String(this.slotId)}:${String(this.contexts.length)}`
    );
    this.contexts.push(context);
    return Promise.resolve(context);
  }

  onDisconnected(listener: () => void): void {
    this.disconnectListener = listener;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  crash(): void {
    this.disconnectListener?.();
  }
}

class FakeContext implements ManagedBrowserContext {
  closed = false;

  constructor(readonly debugId: string) {}

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

function handlePart(index: number): string {
  return index.toString(36).padStart(22, "A");
}
