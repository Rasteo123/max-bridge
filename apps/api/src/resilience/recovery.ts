import { CircuitBreaker } from "./circuit-breaker.js";

export type RecoverableFault =
  | "worker_crash"
  | "browser_crash"
  | "context_crash"
  | "max_disconnect"
  | "api_restart"
  | "auth_expired"
  | "wire_incompatible"
  | "database_tampered"
  | "send_ambiguous";

export type RecoveryDecision = Readonly<{
  action:
    | "restart_worker"
    | "restart_browser_slot"
    | "recreate_user_session"
    | "reconnect_safe_reads"
    | "client_reconnect"
    | "reauth_required"
    | "compatibility_halt"
    | "shutdown"
    | "retry_requires_user";
  automatic: boolean;
}>;

const decisions: Readonly<Record<RecoverableFault, RecoveryDecision>> = {
  worker_crash: { action: "restart_worker", automatic: true },
  browser_crash: { action: "restart_browser_slot", automatic: true },
  context_crash: { action: "recreate_user_session", automatic: true },
  max_disconnect: { action: "reconnect_safe_reads", automatic: true },
  api_restart: { action: "client_reconnect", automatic: true },
  auth_expired: { action: "reauth_required", automatic: false },
  wire_incompatible: { action: "compatibility_halt", automatic: false },
  database_tampered: { action: "shutdown", automatic: true },
  send_ambiguous: { action: "retry_requires_user", automatic: false }
};

export class RecoveryCoordinator {
  decide(fault: RecoverableFault): RecoveryDecision {
    return decisions[fault];
  }
}

type SafeReadRecoveryOptions = Readonly<{
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (delayMs: number) => Promise<void>;
  breaker?: CircuitBreaker;
}>;

export class SafeReadRecovery {
  private readonly attempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly breaker: CircuitBreaker;

  constructor(options: SafeReadRecoveryOptions = {}) {
    this.attempts = Math.max(1, Math.min(5, options.maxAttempts ?? 3));
    this.baseDelayMs = Math.max(1, options.baseDelayMs ?? 250);
    this.maxDelayMs = Math.max(
      this.baseDelayMs,
      options.maxDelayMs ?? 4_000
    );
    this.sleep = options.sleep ?? defaultSleep;
    this.breaker = options.breaker ?? new CircuitBreaker({
      failureThreshold: 5
    });
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.attempts; attempt += 1) {
      this.breaker.assertRequestAllowed();
      try {
        const result = await operation();
        this.breaker.recordSuccess();
        return result;
      } catch (error: unknown) {
        lastError = error;
        this.breaker.recordFailure();
        if (attempt + 1 < this.attempts) {
          await this.sleep(this.delayFor(attempt));
        }
      }
    }
    throw lastError;
  }

  private delayFor(attempt: number): number {
    return Math.min(
      this.maxDelayMs,
      this.baseDelayMs * (2 ** attempt)
    );
  }
}

async function defaultSleep(delayMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
