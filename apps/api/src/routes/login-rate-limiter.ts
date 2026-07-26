export type LoginRateLimiterOptions = Readonly<{
  maxFailures?: number;
  windowMs?: number;
  lockMs?: number;
  now?: () => number;
}>;

type LoginFailureState = {
  failures: number[];
  lockedUntil: number;
};

export class LoginRateLimiter {
  private readonly states = new Map<string, LoginFailureState>();
  private readonly maxFailures: number;
  private readonly windowMs: number;
  private readonly lockMs: number;
  private readonly now: () => number;

  constructor(options: LoginRateLimiterOptions = {}) {
    this.maxFailures = options.maxFailures ?? 5;
    this.windowMs = options.windowMs ?? 15 * 60_000;
    this.lockMs = options.lockMs ?? 30 * 60_000;
    this.now = options.now ?? Date.now;
  }

  isLocked(userLookup: string): boolean {
    const state = this.states.get(userLookup);
    if (state === undefined) {
      return false;
    }
    const now = this.now();
    if (state.lockedUntil > now) {
      return true;
    }
    if (state.lockedUntil !== 0) {
      this.states.delete(userLookup);
    }
    return false;
  }

  recordFailure(userLookup: string): void {
    const now = this.now();
    const state = this.states.get(userLookup) ?? {
      failures: [],
      lockedUntil: 0
    };
    state.failures = state.failures.filter(
      (timestamp) => timestamp >= now - this.windowMs
    );
    state.failures.push(now);
    if (state.failures.length >= this.maxFailures) {
      state.lockedUntil = now + this.lockMs;
    }
    this.states.set(userLookup, state);
  }

  reset(userLookup: string): void {
    this.states.delete(userLookup);
  }
}
