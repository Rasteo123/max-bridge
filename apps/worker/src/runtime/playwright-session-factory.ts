import type { BridgeEvent } from "@maxbridge/core";

import { MaxWebPageSession } from "../max/max-web-page-session.js";
import type { BrowserPool } from "../pool/browser-pool.js";
import {
  PlaywrightManagedContext
} from "../pool/playwright-browser-factory.js";
import type {
  RuntimeMaxSession,
  RuntimeSessionFactory
} from "./request-handler.js";

export class PlaywrightSessionFactory implements RuntimeSessionFactory {
  constructor(private readonly pool: BrowserPool) {}

  async open(
    handle: string,
    storageState: Uint8Array | undefined,
    onEvents: (events: readonly BridgeEvent[]) => void
  ): Promise<RuntimeMaxSession> {
    const opened = await this.pool.openSession(handle, storageState);
    if (!(opened.context instanceof PlaywrightManagedContext)) {
      await this.pool.closeSession(handle);
      throw new Error("Playwright context is unavailable");
    }
    try {
      const page = await opened.context.nativeContext.newPage();
      const session = new MaxWebPageSession({
        page,
        context: opened.context.nativeContext,
        onEvents
      });
      await session.start();
      return session;
    } catch (error: unknown) {
      await this.pool.closeSession(handle);
      throw error;
    }
  }

  async close(
    handle: string,
    session: RuntimeMaxSession
  ): Promise<void> {
    await session.close().catch(() => undefined);
    await this.pool.closeSession(handle);
  }
}
