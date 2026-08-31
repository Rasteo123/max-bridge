export type NotificationCursorSnapshot = Readonly<Record<string, number>>;

export class NotificationDeduplicator {
  private readonly cursors = new Map<string, number>();
  private readonly recentIds = new Map<string, Set<string>>();

  constructor(initial: NotificationCursorSnapshot = {}) {
    for (const [userLookup, cursor] of Object.entries(initial)) {
      if (Number.isSafeInteger(cursor) && cursor >= 0) {
        this.cursors.set(userLookup, cursor);
      }
    }
  }

  accept(
    userLookup: string,
    sequence: number,
    messageId: string
  ): boolean {
    const cursor = this.cursors.get(userLookup) ?? -1;
    // The sequence counter lives in the worker process and restarts at zero
    // with it, so a value *below* the cursor marks a new worker epoch rather
    // than a replay. Rejecting those silenced every notification until the
    // counter climbed past a cursor the API had kept from the previous run.
    // Only an exact repeat of the last accepted sequence is a duplicate; the
    // messageId check below still catches genuinely repeated messages.
    if (sequence === cursor) {
      return false;
    }
    let ids = this.recentIds.get(userLookup);
    if (ids === undefined) {
      ids = new Set();
      this.recentIds.set(userLookup, ids);
    }
    if (ids.has(messageId)) {
      return false;
    }
    ids.add(messageId);
    while (ids.size > 256) {
      const oldest = ids.values().next().value;
      if (oldest === undefined) {
        break;
      }
      ids.delete(oldest);
    }
    this.cursors.set(userLookup, sequence);
    return true;
  }

  snapshotCursors(): NotificationCursorSnapshot {
    return Object.fromEntries(this.cursors);
  }
}
