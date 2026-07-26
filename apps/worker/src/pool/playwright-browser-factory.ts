import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions
} from "playwright";

import type {
  BrowserFactory,
  BrowserProcess,
  ManagedBrowserContext
} from "./browser-slot.js";

type ObjectStorageState = Exclude<
  BrowserContextOptions["storageState"],
  string | undefined
>;

export class PlaywrightBrowserFactory implements BrowserFactory {
  async launch(): Promise<BrowserProcess> {
    const browser = await chromium.launch({
      headless: true
    });
    return new PlaywrightBrowserProcess(browser);
  }
}

class PlaywrightBrowserProcess implements BrowserProcess {
  constructor(private readonly browser: Browser) {}

  async newContext(
    storageState?: Uint8Array
  ): Promise<ManagedBrowserContext> {
    const context = await this.browser.newContext(
      storageState === undefined
        ? {}
        : { storageState: parseStorageState(storageState) }
    );
    return new PlaywrightManagedContext(context);
  }

  onDisconnected(listener: () => void): void {
    this.browser.on("disconnected", listener);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

export class PlaywrightManagedContext implements ManagedBrowserContext {
  readonly nativeContext: BrowserContext;

  constructor(context: BrowserContext) {
    this.nativeContext = context;
  }

  async close(): Promise<void> {
    await this.nativeContext.close();
  }
}

function parseStorageState(value: Uint8Array): ObjectStorageState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(value)) as unknown;
  } catch {
    throw new TypeError("MAX storage state is invalid");
  }
  if (
    typeof parsed !== "object"
    || parsed === null
    || !("cookies" in parsed)
    || !Array.isArray(parsed.cookies)
    || !("origins" in parsed)
    || !Array.isArray(parsed.origins)
  ) {
    throw new TypeError("MAX storage state is invalid");
  }
  return parsed as ObjectStorageState;
}
