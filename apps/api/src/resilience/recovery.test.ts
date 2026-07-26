import { describe, expect, it, vi } from "vitest";

import { CircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";
import {
  RecoveryCoordinator,
  SafeReadRecovery
} from "./recovery.js";

describe("RecoveryCoordinator", () => {
  it.each([
    ["worker_crash", "restart_worker"],
    ["browser_crash", "restart_browser_slot"],
    ["context_crash", "recreate_user_session"],
    ["max_disconnect", "reconnect_safe_reads"],
    ["api_restart", "client_reconnect"],
    ["auth_expired", "reauth_required"],
    ["wire_incompatible", "compatibility_halt"],
    ["database_tampered", "shutdown"],
    ["send_ambiguous", "retry_requires_user"]
  ] as const)("maps %s to a bounded recovery action", (fault, action) => {
    expect(new RecoveryCoordinator().decide(fault).action).toBe(action);
  });

  it("retries safe reads with bounded exponential delays", async () => {
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error("disconnect"))
      .mockRejectedValueOnce(new Error("disconnect"))
      .mockResolvedValue("ok");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const recovery = new SafeReadRecovery({
      sleep,
      baseDelayMs: 100,
      maxAttempts: 3
    });

    await expect(recovery.run(operation)).resolves.toBe("ok");
    expect(sleep).toHaveBeenNthCalledWith(1, 100);
    expect(sleep).toHaveBeenNthCalledWith(2, 200);
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it("opens the circuit after repeated failures and probes after cooldown", () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      failureThreshold: 2,
      cooldownMs: 1_000,
      now: () => now
    });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(() => {
      breaker.assertRequestAllowed();
    }).toThrow(CircuitOpenError);

    now = 1_001;
    expect(() => {
      breaker.assertRequestAllowed();
    }).not.toThrow();
    expect(breaker.state).toBe("half_open");
    breaker.recordSuccess();
    expect(breaker.state).toBe("closed");
  });

  it("never treats an ambiguous send as safe to retry", () => {
    const decision = new RecoveryCoordinator().decide("send_ambiguous");
    expect(decision).toEqual({
      action: "retry_requires_user",
      automatic: false
    });
  });
});
