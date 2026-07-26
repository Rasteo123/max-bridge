import type { ManagedBrowserContext } from "./browser-slot.js";

export type ManagedSession = Readonly<{
  handle: string;
  slotId: number;
  context: ManagedBrowserContext;
}>;

export class SessionRegistry {
  private readonly sessions = new Map<string, ManagedSession>();

  get size(): number {
    return this.sessions.size;
  }

  add(session: ManagedSession): void {
    if (this.sessions.has(session.handle)) {
      throw new Error("Session handle already exists");
    }
    this.sessions.set(session.handle, session);
  }

  get(handle: string): ManagedSession | undefined {
    return this.sessions.get(handle);
  }

  remove(handle: string): ManagedSession | undefined {
    const session = this.sessions.get(handle);
    this.sessions.delete(handle);
    return session;
  }

  removeSlot(slotId: number): ManagedSession[] {
    const removed: ManagedSession[] = [];
    for (const [handle, session] of this.sessions) {
      if (session.slotId === slotId) {
        this.sessions.delete(handle);
        removed.push(session);
      }
    }
    return removed;
  }

  handlesForSlot(slotId: number): string[] {
    return [...this.sessions.values()]
      .filter((session) => session.slotId === slotId)
      .map((session) => session.handle);
  }

  all(): ManagedSession[] {
    return [...this.sessions.values()];
  }

  clear(): void {
    this.sessions.clear();
  }
}
