export type CircuitState = "closed" | "open" | "half_open";

export type CircuitBreakerOptions = Readonly<{
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}>;

export class CircuitOpenError extends Error {
  readonly code = "circuit_open";

  constructor() {
    super("The operation is temporarily unavailable");
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private failures = 0;
  private currentState: CircuitState = "closed";
  private openedAt = 0;
  private probeInFlight = false;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.threshold = Math.max(1, options.failureThreshold ?? 3);
    this.cooldownMs = Math.max(1, options.cooldownMs ?? 30_000);
    this.now = options.now ?? Date.now;
  }

  get state(): CircuitState {
    return this.currentState;
  }

  assertRequestAllowed(): void {
    if (this.currentState === "open") {
      if (this.now() - this.openedAt < this.cooldownMs) {
        throw new CircuitOpenError();
      }
      this.currentState = "half_open";
      this.probeInFlight = false;
    }
    if (this.currentState === "half_open") {
      if (this.probeInFlight) {
        throw new CircuitOpenError();
      }
      this.probeInFlight = true;
    }
  }

  recordSuccess(): void {
    this.failures = 0;
    this.probeInFlight = false;
    this.currentState = "closed";
  }

  recordFailure(): void {
    this.probeInFlight = false;
    this.failures += 1;
    if (
      this.currentState === "half_open" ||
      this.failures >= this.threshold
    ) {
      this.currentState = "open";
      this.openedAt = this.now();
    }
  }
}
