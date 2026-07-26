import {
  BrowserSlot,
  type BrowserFactory,
  type ManagedBrowserContext
} from "./browser-slot.js";
import {
  SessionRegistry,
  type ManagedSession
} from "./session-registry.js";

const DEFAULT_SLOT_COUNT = 3;
const DEFAULT_SLOT_CAPACITY = 4;
const SESSION_HANDLE_PATTERN = /^s_[A-Za-z0-9_-]{22,64}$/u;

export type RecoveryReason =
  | "browser_crash"
  | "health_failure"
  | "memory_pressure";

export type BrowserPoolRecovery = Readonly<{
  slotId: number;
  reason: RecoveryReason;
  affectedHandles: readonly string[];
}>;

export type BrowserPoolOptions = Readonly<{
  factory: BrowserFactory;
  slotCount?: number;
  slotCapacity?: number;
  onSessionsLost?: (handles: readonly string[]) => void;
  onRecovery?: (recovery: BrowserPoolRecovery) => void;
}>;

export type OpenedSession = Readonly<{
  slotId: number;
  context: ManagedBrowserContext;
}>;

export class PoolCapacityError extends Error {
  readonly code = "browser_pool_capacity_exceeded";

  constructor() {
    super("Browser pool has no free context slot");
    this.name = "PoolCapacityError";
  }
}

export class BrowserPool {
  private readonly slots: BrowserSlot[];
  private readonly registry = new SessionRegistry();
  private recoveryQueue: Promise<void> = Promise.resolve();
  private shuttingDown = false;

  constructor(private readonly options: BrowserPoolOptions) {
    const slotCount = options.slotCount ?? DEFAULT_SLOT_COUNT;
    const slotCapacity = options.slotCapacity ?? DEFAULT_SLOT_CAPACITY;
    this.slots = Array.from({ length: slotCount }, (_, slotId) =>
      new BrowserSlot({
        slotId,
        capacity: slotCapacity,
        factory: options.factory,
        onDisconnected: (disconnectedSlotId) => {
          this.queueCrashRecovery(disconnectedSlotId);
        }
      })
    );
  }

  get sessionCount(): number {
    return this.registry.size;
  }

  async start(): Promise<void> {
    this.shuttingDown = false;
    await Promise.all(this.slots.map(
      async (slot) => slot.start()
    ));
  }

  async openSession(
    handle: string,
    storageState?: Uint8Array
  ): Promise<OpenedSession> {
    assertSessionHandle(handle);
    if (this.registry.get(handle) !== undefined) {
      throw new Error("Session handle already exists");
    }
    const slot = [...this.slots]
      .filter((candidate) => candidate.hasCapacity)
      .sort((left, right) => left.load - right.load || left.id - right.id)[0];
    if (slot === undefined) {
      throw new PoolCapacityError();
    }
    const context = await slot.openContext(storageState);
    this.registry.add({
      handle,
      slotId: slot.id,
      context
    });
    return { slotId: slot.id, context };
  }

  async closeSession(handle: string): Promise<void> {
    const session = this.registry.remove(handle);
    if (session === undefined) {
      return;
    }
    await session.context.close();
    this.slots[session.slotId]?.contextClosed();
  }

  async restartSlot(
    slotId: number,
    reason: RecoveryReason
  ): Promise<BrowserPoolRecovery> {
    const slot = this.slots[slotId];
    if (slot === undefined) {
      throw new RangeError("Unknown browser slot");
    }
    const affectedSessions = this.registry.removeSlot(slotId);
    const affectedHandles = affectedSessions.map(
      (session) => session.handle
    );
    await Promise.allSettled(affectedSessions.map(
      async (session) => session.context.close()
    ));
    slot.resetLoad();
    await slot.restart();
    const recovery = {
      slotId,
      reason,
      affectedHandles
    } as const;
    this.options.onSessionsLost?.(affectedHandles);
    this.options.onRecovery?.(recovery);
    return recovery;
  }

  handlesForSlot(slotId: number): string[] {
    return this.registry.handlesForSlot(slotId);
  }

  slotLoads(): number[] {
    return this.slots.map((slot) => slot.load);
  }

  waitForRecovery(): Promise<void> {
    return this.recoveryQueue;
  }

  async close(): Promise<void> {
    this.shuttingDown = true;
    const sessions = this.registry.all();
    this.registry.clear();
    await Promise.allSettled(sessions.map(
      async (session) => session.context.close()
    ));
    await Promise.all(this.slots.map(
      async (slot) => slot.close()
    ));
  }

  private queueCrashRecovery(slotId: number): void {
    if (this.shuttingDown) {
      return;
    }
    this.recoveryQueue = this.recoveryQueue.then(async () => {
      await this.restartSlot(slotId, "browser_crash");
    });
  }
}

function assertSessionHandle(handle: string): void {
  if (!SESSION_HANDLE_PATTERN.test(handle)) {
    throw new TypeError("Invalid session handle");
  }
}

export type { ManagedSession };
