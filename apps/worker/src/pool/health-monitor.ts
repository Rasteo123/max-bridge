import {
  type BrowserPool,
  type BrowserPoolRecovery
} from "./browser-pool.js";

export type BrowserHealthSample = Readonly<{
  slotId: number;
  rssBytes: number;
  healthy: boolean;
}>;

export type HealthMonitorOptions = Readonly<{
  pool: BrowserPool;
  memoryHighBytes: number;
  sample: () => Promise<readonly BrowserHealthSample[]>;
}>;

export type HealthMonitorResult =
  | Readonly<{ action: "none" }>
  | Readonly<{
      action: "restarted";
      slotId: number;
      affectedHandles: readonly string[];
    }>;

export class HealthMonitor {
  constructor(private readonly options: HealthMonitorOptions) {}

  async runOnce(): Promise<HealthMonitorResult> {
    const samples = await this.options.sample();
    const unhealthy = samples.find((sample) => !sample.healthy);
    if (unhealthy !== undefined) {
      return toResult(await this.options.pool.restartSlot(
        unhealthy.slotId,
        "health_failure"
      ));
    }
    const totalMemory = samples.reduce(
      (total, sample) => total + sample.rssBytes,
      0
    );
    if (totalMemory > this.options.memoryHighBytes) {
      const heaviest = [...samples].sort(
        (left, right) => right.rssBytes - left.rssBytes
      )[0];
      if (heaviest !== undefined) {
        return toResult(await this.options.pool.restartSlot(
          heaviest.slotId,
          "memory_pressure"
        ));
      }
    }
    return { action: "none" };
  }
}

function toResult(recovery: BrowserPoolRecovery): HealthMonitorResult {
  return {
    action: "restarted",
    slotId: recovery.slotId,
    affectedHandles: recovery.affectedHandles
  };
}
