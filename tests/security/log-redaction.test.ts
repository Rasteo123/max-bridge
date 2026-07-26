import { describe, expect, it } from "vitest";

import { secureLoggerOptions } from "../../apps/api/src/plugins/logging.js";

describe("secure logging", () => {
  it("redacts every request body and authentication carrier", () => {
    const options = secureLoggerOptions();
    expect(options).not.toBe(false);
    if (options === false || options === true || options === undefined) {
      throw new Error("Logger options are unavailable");
    }
    const redact: unknown = options.redact;
    if (typeof redact !== "object" || redact === null) {
      throw new Error("Structured redaction is unavailable");
    }
    const record = redact as Record<string, unknown>;
    expect(record["censor"]).toBe("[REDACTED]");
    const paths = record["paths"];
    if (!Array.isArray(paths)) {
      throw new Error("Redaction paths are unavailable");
    }
    for (const required of [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers.set-cookie",
      "req.body",
      "response.body"
    ]) {
      expect(paths).toContain(required);
    }
    expect(JSON.stringify(options)).not.toContain("CANARY_SECRET_VALUE");
  });
});
