import { withSecretBuffer } from "@maxbridge/core";

export interface ManagedBrowserContext {
  readonly debugId?: string;
  close(): Promise<void>;
}

export interface BrowserProcess {
  newContext(
    storageState?: Uint8Array
  ): Promise<ManagedBrowserContext>;
  onDisconnected(listener: () => void): void;
  close(): Promise<void>;
}

export interface BrowserFactory {
  launch(slotId: number): Promise<BrowserProcess>;
}

export type BrowserSlotOptions = Readonly<{
  slotId: number;
  capacity: number;
  factory: BrowserFactory;
  onDisconnected: (slotId: number) => void;
}>;

export class BrowserSlot {
  private browser: BrowserProcess | undefined;
  private activeContexts = 0;
  private suppressDisconnect = false;

  constructor(private readonly options: BrowserSlotOptions) {}

  get id(): number {
    return this.options.slotId;
  }

  get load(): number {
    return this.activeContexts;
  }

  get hasCapacity(): boolean {
    return this.activeContexts < this.options.capacity;
  }

  async start(): Promise<void> {
    if (this.browser !== undefined) {
      return;
    }
    const browser = await this.options.factory.launch(this.options.slotId);
    browser.onDisconnected(() => {
      if (!this.suppressDisconnect) {
        this.options.onDisconnected(this.options.slotId);
      }
    });
    this.browser = browser;
  }

  async openContext(
    storageState?: Uint8Array
  ): Promise<ManagedBrowserContext> {
    const browser = this.browser;
    if (browser === undefined || !this.hasCapacity) {
      throw new Error("Browser slot is unavailable");
    }
    this.activeContexts += 1;
    try {
      return storageState === undefined
        ? await browser.newContext()
        : await withSecretBuffer(
            storageState,
            async (secret) => browser.newContext(secret)
          );
    } catch (error: unknown) {
      this.activeContexts = Math.max(0, this.activeContexts - 1);
      throw error;
    }
  }

  contextClosed(): void {
    this.activeContexts = Math.max(0, this.activeContexts - 1);
  }

  resetLoad(): void {
    this.activeContexts = 0;
  }

  async restart(): Promise<void> {
    const previous = this.browser;
    this.browser = undefined;
    this.activeContexts = 0;
    this.suppressDisconnect = true;
    try {
      await previous?.close();
    } finally {
      this.suppressDisconnect = false;
    }
    await this.start();
  }

  async close(): Promise<void> {
    const browser = this.browser;
    this.browser = undefined;
    this.activeContexts = 0;
    this.suppressDisconnect = true;
    try {
      await browser?.close();
    } finally {
      this.suppressDisconnect = false;
    }
  }
}
